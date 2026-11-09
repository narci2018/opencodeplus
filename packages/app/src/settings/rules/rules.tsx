import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { Select } from "@opencode/ui/select"
import { TextField } from "@opencode/ui/text-field"
import { Switch } from "@opencode/ui/switch"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { showToast } from "@/shell/notifications/toast"
import {
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  type Component,
  type JSX,
} from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import "@/settings/usage/usage.css"
import "./rules.css"

type FileRef = { path: string; content: string | null }

type Scope = "global" | "project"

const encoder = new TextEncoder()

const DEFAULT_PROJECT_AGENTS_TEMPLATE = `# Project Rules & Guidelines

## Overview
Describe the architecture, tech stack, and conventions of this project.

## Code Standards
- Keep functions modular and maintain strict type safety (avoid \`any\`).
- Prefer functional array methods (map, filter) and early returns.
- Maintain documentation integrity and do not remove unrelated comments.

## Testing & Quality
- Write unit tests for core business logic.
- Verify changes with \`bun typecheck\` before committing.
`

const DEFAULT_PROJECT_MEMORY_TEMPLATE = `# Project Memory & Context

## Key Architectural Decisions
- Document critical decisions, database schemas, and conventions here.

## Environment & Constraints
- Specific environment flags, ports, and configuration rules.
`

export type ParsedMemoryItem = {
  id: string
  raw: string
  category: string
  date?: string
  content: string
}

export function parseMemoryItems(rawMarkdown: string | null | undefined): ParsedMemoryItem[] {
  if (!rawMarkdown) return []
  const lines = rawMarkdown.split("\n")
  const items: ParsedMemoryItem[] = []

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith("- ") && !trimmed.startsWith("* ")) return

    const itemText = trimmed.slice(2).trim()
    if (!itemText) return

    let category = "通用记忆"
    let date: string | undefined = undefined
    let content = itemText

    const matchCategory = itemText.match(/^(?:\*\*\[|\[)([^\]]+)(?:\]\*\*|\])\s*(?:\(([^)]+)\))?[:：]?\s*(.*)$/)
    if (matchCategory) {
      category = matchCategory[1]
      date = matchCategory[2]
      content = matchCategory[3] || itemText
    } else {
      const matchBullet = itemText.match(/^([^\s:：]+)[:：]\s*(.*)$/)
      if (matchBullet && matchBullet[1].length < 15) {
        category = matchBullet[1]
        content = matchBullet[2]
      }
    }

    items.push({
      id: `mem-${index}-${items.length}`,
      raw: line,
      category,
      date,
      content,
    })
  })

  return items
}

export type SyntaxIssue = {
  line: number
  level: "error" | "warning" | "info"
  message: string
}

export function validateMarkdown(content: string): SyntaxIssue[] {
  const issues: SyntaxIssue[] = []
  const lines = content.split("\n")
  let inCodeBlock = false
  let codeBlockStartLine = 0
  let codeBlockFence = ""

  lines.forEach((line, index) => {
    const lineNum = index + 1
    const trimmed = line.trim()

    // 1. Code block fences
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      const fence = trimmed.slice(0, 3)
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockStartLine = lineNum
        codeBlockFence = fence
      } else if (trimmed.startsWith(codeBlockFence)) {
        inCodeBlock = false
      }
    }

    if (!inCodeBlock) {
      // 2. Headings missing space after hash (e.g. #Title)
      if (/^#{1,6}[^ \t#\n]/.test(trimmed)) {
        issues.push({
          line: lineNum,
          level: "warning",
          message: `标题符号 '#' 与文字之间缺少空格: "${trimmed.slice(0, 20)}"`,
        })
      }

      // 3. Inline backticks unclosed
      const backticks = (line.match(/(?<!\\)`/g) || []).length
      if (backticks % 2 !== 0) {
        issues.push({
          line: lineNum,
          level: "warning",
          message: `行内代码反引号 \` 未成对闭合`,
        })
      }

      // 4. Broken markdown link syntax
      if (/\[[^\]]+\]\([^)]*$/.test(line) && !line.includes(")")) {
        issues.push({
          line: lineNum,
          level: "error",
          message: `超链接缺少闭合右括号 ')'`,
        })
      }

      // 5. Empty link target
      if (/\[[^\]]+\]\(\s*\)/.test(line)) {
        issues.push({
          line: lineNum,
          level: "info",
          message: `链接目标 URL 为空`,
        })
      }
    }
  })

  if (inCodeBlock) {
    issues.push({
      line: codeBlockStartLine,
      level: "error",
      message: `代码块未闭合，缺少结束标记 ${codeBlockFence}`,
    })
  }

  return issues
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

export function renderMarkdownPreview(raw: string): string {
  const lines = raw.split("\n")
  const out: string[] = []
  let inCode = false
  let codeLang = ""
  let codeBuffer: string[] = []
  let inList = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Code fence
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      if (inCode) {
        out.push(
          `<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeBuffer.join("\n"))}</code></pre>`,
        )
        codeBuffer = []
        inCode = false
        codeLang = ""
      } else {
        if (inList) {
          out.push("</ul>")
          inList = false
        }
        inCode = true
        codeLang = trimmed.slice(3).trim()
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    // Empty line
    if (!trimmed) {
      if (inList) {
        out.push("</ul>")
        inList = false
      }
      continue
    }

    // Headings
    if (trimmed.startsWith("# ")) {
      if (inList) {
        out.push("</ul>")
        inList = false
      }
      out.push(`<h1>${formatInline(trimmed.slice(2))}</h1>`)
      continue
    }
    if (trimmed.startsWith("## ")) {
      if (inList) {
        out.push("</ul>")
        inList = false
      }
      out.push(`<h2>${formatInline(trimmed.slice(3))}</h2>`)
      continue
    }
    if (trimmed.startsWith("### ")) {
      if (inList) {
        out.push("</ul>")
        inList = false
      }
      out.push(`<h3>${formatInline(trimmed.slice(4))}</h3>`)
      continue
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      if (inList) {
        out.push("</ul>")
        inList = false
      }
      out.push(`<blockquote>${formatInline(trimmed.slice(2))}</blockquote>`)
      continue
    }

    // Unordered list
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) {
        out.push("<ul>")
        inList = true
      }
      out.push(`<li>${formatInline(trimmed.slice(2))}</li>`)
      continue
    }

    // Normal paragraph
    if (inList) {
      out.push("</ul>")
      inList = false
    }
    out.push(`<p>${formatInline(line)}</p>`)
  }

  if (inCode) {
    out.push(
      `<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeBuffer.join("\n"))}</code></pre>`,
    )
  }
  if (inList) {
    out.push("</ul>")
  }

  return out.join("\n")
}

function formatInline(text: string): string {
  let s = escapeHtml(text)
  // Inline code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>")
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  // Italic
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>")
  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  return s
}

export const SettingsRules: Component<{ headerAction?: JSX.Element }> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const dialog = useDialog()

  const [rulesScope, setRulesScope] = createSignal<Scope>("global")
  const [memoryScope, setMemoryScope] = createSignal<Scope>("global")
  const [projectID, setProjectID] = createSignal<string | undefined>(undefined)

  const connected = () => sdk.connection.status() === "connected"

  const [bootstrap] = createResource(connected, async () => {
    if (!connected()) return undefined
    return sdk.api.experimental.rules.files().catch(() => undefined)
  })

  const [files, filesActions] = createResource(
    () => [connected(), projectID()] as const,
    async ([active, id]) => {
      if (!active) return undefined
      const directory = (bootstrap.latest?.memory.projects ?? []).find((item) => item.projectID === id)?.directory
      const result = await sdk.api.experimental.rules
        .files(directory ? { location: { directory } } : undefined)
        .catch(() => undefined)
      return result
    },
  )

  const refresh = () => void filesActions.refetch()

  const [ruleOverrides, setRuleOverrides] = createSignal<Partial<{ agents_md: boolean; claude_md: boolean }> | undefined>(
    undefined,
  )
  const [memoryOverrides, setMemoryOverrides] = createSignal<Partial<{ enabled: boolean; distill: boolean }> | undefined>(
    undefined,
  )

  const rulesState = createMemo(() => ({
    agents_md: ruleOverrides()?.agents_md ?? files.latest?.rules.agents_md ?? true,
    claude_md: ruleOverrides()?.claude_md ?? files.latest?.rules.claude_md ?? false,
  }))
  const memoryState = createMemo(() => ({
    enabled: memoryOverrides()?.enabled ?? files.latest?.memory.enabled ?? true,
    distill: memoryOverrides()?.distill ?? files.latest?.memory.distill ?? true,
  }))

  const patch = async (
    patchBody: Record<string, unknown>,
    onOptimistic: () => void,
    onRollback: () => void,
  ) => {
    onOptimistic()
    try {
      await sdk.api.experimental.config.update(patchBody as never)
      setRuleOverrides(undefined)
      setMemoryOverrides(undefined)
      refresh()
    } catch (cause) {
      onRollback()
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    }
  }

  const projects = createMemo(() => bootstrap.latest?.memory.projects ?? [])
  const projectOptions = createMemo(() => projects().map((item) => ({ id: item.projectID, label: item.name })))
  const projectName = (id: string) => projectOptions().find((option) => option.id === id)?.label ?? id

  const scopeProjectID = () => {
    if (projectID() && projects().some((item) => item.projectID === projectID())) return projectID()
    return projects()[0]?.projectID
  }

  const openFileDialog = (
    file: FileRef,
    isCreate: boolean,
    title: string,
    defaultContent?: string,
  ) => {
    void dialog.show(
      () => (
        <FileEditDialog
          title={title}
          path={file.path}
          content={file.content ?? defaultContent ?? ""}
          isCreate={isCreate}
          onSaved={() => refresh()}
          onClose={() => dialog.close()}
        />
      ),
      () => undefined,
    )
  }

  const editInstruction = (source: string) => {
    void dialog.show(
      () => (
        <SourceEditDialog
          source={source}
          onSaved={() => refresh()}
          onClose={() => dialog.close()}
          onEditContent={(filePath) => {
            dialog.close()
            openFileDialog({ path: filePath, content: null }, false, `编辑 ${filePath}`)
          }}
        />
      ),
      () => undefined,
    )
  }

  const removeInstruction = async (source: string) => {
    try {
      await sdk.api.experimental.config.update({ instruction: { source, remove: true } })
      refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.removed.title"),
        description: language.t("settings.extensions.removed.description", { name: source }),
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    }
  }

  const openCreateRuleDialog = () => {
    const isGlobal = rulesScope() === "global"
    const baseDir = isGlobal
      ? (files.latest?.globalAgents.path.replace(/[\\\/][^\\\/]+$/, "") ?? "")
      : (projects().find((item) => item.projectID === scopeProjectID())?.directory ?? "")
    const scopeLabel = isGlobal ? "全局" : `项目 (${projectName(scopeProjectID()!)})`

    void dialog.show(
      () => (
        <CreateRuleFileDialog
          baseDir={baseDir}
          scopeLabel={scopeLabel}
          onSaved={() => refresh()}
          onClose={() => dialog.close()}
        />
      ),
      () => undefined,
    )
  }

  const currentMemoryFile = () =>
    memoryScope() === "global" ? files.latest?.memory.global : files.latest?.memory.project

  const currentMemoryItems = createMemo(() => parseMemoryItems(currentMemoryFile()?.content))

  const openCreateMemoryDialog = () => {
    const file = currentMemoryFile()
    if (!file) {
      showToast({
        variant: "error",
        title: "未选择有效项目",
        description: "请先选择一个有效项目，再添加项目记忆",
      })
      return
    }
    const isGlobal = memoryScope() === "global"
    const scopeLabel = isGlobal ? "全局" : `项目 (${projectName(scopeProjectID()!)})`

    void dialog.show(
      () => (
        <CreateMemoryItemDialog
          file={file}
          scopeLabel={scopeLabel}
          onSaved={() => refresh()}
          onClose={() => dialog.close()}
        />
      ),
      () => undefined,
    )
  }

  const removeMemoryItem = async (rawLine: string) => {
    const file = currentMemoryFile()
    if (!file?.content) return
    const lines = file.content.split("\n")
    const nextLines = lines.filter((l) => l.trim() !== rawLine.trim())
    const nextContent = nextLines.join("\n")
    try {
      await sdk.api.experimental.file.write({
        path: file.path,
        payload: encoder.encode(nextContent),
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "记忆条目已删除",
        description: "已从记忆账本中移除该条目",
      })
      refresh()
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    }
  }

  const scopeTabs = (value: Scope, set: (next: Scope) => void) => (
    <div class="usage-range" role="group">
      <Button size="small" variant={value === "global" ? "contrast" : "ghost-muted"} onClick={() => set("global")}>
        {language.t("settings.rules.scope.global")}
      </Button>
      <Button size="small" variant={value === "project" ? "contrast" : "ghost-muted"} onClick={() => set("project")}>
        {language.t("settings.rules.scope.project")}
      </Button>
    </div>
  )

  return (
    <div class="settings-tab-body">
      <div class="settings-tab-header settings-tab-header--stacked">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.rules.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.rules.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
      </div>

      <Show
        when={!files.error}
        fallback={
          <div class="usage-status" role="alert">
            <Icon name="circle-exclamation" size="small" />
            <span>{language.t("settings.rules.error")}</span>
            <Button size="small" variant="ghost-muted" onClick={refresh}>
              {language.t("settings.usage.retry")}
            </Button>
          </div>
        }
      >
        <Show when={!files.loading} fallback={
          <div class="usage-status">
            <Loader class="usage-status-spinner" />
            <span>{language.t("settings.usage.loading")}</span>
          </div>
        }>
          <div class="usage-section">
            <span class="usage-section-title">{language.t("settings.rules.imports")}</span>
            <div class="rules-rows">
              <div class="rules-row">
                <div class="rules-row-copy">
                  <span class="rules-row-title">{language.t("settings.rules.imports.agents.title")}</span>
                  <span class="rules-row-description">{language.t("settings.rules.imports.agents.description")}</span>
                </div>
                <Switch
                  checked={rulesState().agents_md}
                  onChange={(checked) =>
                    void patch(
                      { rules: { agents_md: checked === true } },
                      () => setRuleOverrides({ ...ruleOverrides(), agents_md: checked === true }),
                      () => setRuleOverrides(undefined),
                    )
                  }
                />
              </div>
              <div class="rules-row">
                <div class="rules-row-copy">
                  <span class="rules-row-title">{language.t("settings.rules.imports.claude.title")}</span>
                  <span class="rules-row-description">{language.t("settings.rules.imports.claude.description")}</span>
                </div>
                <Switch
                  checked={rulesState().claude_md}
                  onChange={(checked) =>
                    void patch(
                      { rules: { claude_md: checked === true } },
                      () => setRuleOverrides({ ...ruleOverrides(), claude_md: checked === true }),
                      () => setRuleOverrides(undefined),
                    )
                  }
                />
              </div>
            </div>
          </div>

          <div class="usage-section">
            <div class="usage-section-row">
              <span class="usage-section-title">{language.t("settings.rules.section")}</span>
              <div class="flex items-center gap-2">
                {scopeTabs(rulesScope(), setRulesScope)}
                <Button
                  size="small"
                  variant="contrast"
                  icon="plus"
                  onClick={openCreateRuleDialog}
                >
                  创建规则
                </Button>
                <IconButton
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  aria-label={language.t("common.refresh")}
                  onClick={refresh}
                  icon={<Icon name="reset" size="small" />}
                />
              </div>
            </div>

            {/* Scope Content */}
            <Show
              when={rulesScope() === "global"}
              fallback={
                <Show when={scopeProjectID()} fallback={
                  <div class="usage-status">{language.t("settings.rules.empty.projects")}</div>
                }>
                  <div class="rules-rows">
                    {/* Project Main Rule (AGENTS.md) */}
                    <div class="rules-row">
                      <ProjectSelect
                        projects={projects()}
                        projectID={scopeProjectID()}
                        onSelect={setProjectID}
                      />
                      <div class="rules-row-copy">
                        <div class="rules-row-title-wrap">
                          <span class="rules-row-title">项目 AGENTS.md (核心主规则)</span>
                          <Show
                            when={files.latest?.projectAgents?.content !== null}
                            fallback={<span class="rules-status-badge rules-status-badge--empty">未创建</span>}
                          >
                            <span class="rules-status-badge rules-status-badge--active">已创建</span>
                          </Show>
                        </div>
                        <span class="rules-row-description rules-row-path">
                          {files.latest?.projectAgents?.path ?? "—"}
                        </span>
                      </div>
                      <Show
                        when={files.latest?.projectAgents?.content !== null}
                        fallback={
                          <Button
                            size="small"
                            variant="contrast"
                            icon="plus"
                            onClick={() =>
                              openFileDialog(
                                files.latest!.projectAgents!,
                                true,
                                `创建项目规则 (${projectName(scopeProjectID()!)})`,
                                DEFAULT_PROJECT_AGENTS_TEMPLATE,
                              )
                            }
                          >
                            创建主规则
                          </Button>
                        }
                      >
                        <Button
                          size="small"
                          variant="ghost-muted"
                          onClick={() =>
                            openFileDialog(
                              files.latest!.projectAgents!,
                              false,
                              `编辑项目规则 (${projectName(scopeProjectID()!)})`,
                              DEFAULT_PROJECT_AGENTS_TEMPLATE,
                            )
                          }
                        >
                          <Icon name="pencil-line" size="small" />
                          编辑
                        </Button>
                      </Show>
                    </div>

                    {/* Additional Rules */}
                    <div class="rules-section-sub mt-2">
                      <span class="usage-section-title">
                        独立规则列表
                        <span class="text-11-regular text-v2-text-text-muted ml-1 font-normal">
                          ({(files.latest?.instructions ?? []).length} 条)
                        </span>
                      </span>
                      <Button size="small" variant="ghost-muted" icon="plus" onClick={openCreateRuleDialog}>
                        + 新增独立规则
                      </Button>
                    </div>
                    <Show when={(files.latest?.instructions ?? []).length > 0} fallback={
                      <div class="usage-status">尚未配置独立规则。点击右上角【创建规则】或【+ 新增独立规则】添加规则文件。</div>
                    }>
                      <For each={files.latest?.instructions ?? []}>
                        {(source) => (
                          <div class="rules-row">
                            <div class="rules-row-copy">
                              <div class="rules-row-title-wrap">
                                <span class="rules-row-title truncate">{source.replace(/\\/g, "/").split("/").pop()}</span>
                                <span class="rules-status-badge rules-status-badge--active">独立规则</span>
                              </div>
                              <span class="rules-row-description rules-row-path">{source}</span>
                            </div>
                            <div class="flex items-center gap-1">
                              <Button
                                size="small"
                                variant="ghost-muted"
                                aria-label={language.t("common.edit")}
                                onClick={() => editInstruction(source)}
                              >
                                <Icon name="pencil" size="small" />
                                编辑
                              </Button>
                              <Button
                                size="small"
                                variant="ghost-muted"
                                aria-label={language.t("common.delete")}
                                onClick={() => void removeInstruction(source)}
                              >
                                <Icon name="trash" size="small" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>
              }
            >
              <div class="rules-rows">
                {/* Global Main Rule (AGENTS.md) */}
                <div class="rules-row">
                  <div class="rules-row-copy">
                    <div class="rules-row-title-wrap">
                      <span class="rules-row-title">全局 AGENTS.md (核心主规则)</span>
                      <Show
                        when={files.latest?.globalAgents.content !== null}
                        fallback={<span class="rules-status-badge rules-status-badge--empty">未创建</span>}
                      >
                        <span class="rules-status-badge rules-status-badge--active">已创建</span>
                      </Show>
                    </div>
                    <span class="rules-row-description rules-row-path">
                      {files.latest?.globalAgents.path ?? "—"}
                    </span>
                  </div>
                  <Show
                    when={files.latest?.globalAgents.content !== null}
                    fallback={
                      <Button
                        size="small"
                        variant="contrast"
                        icon="plus"
                        onClick={() =>
                          openFileDialog(
                            files.latest!.globalAgents,
                            true,
                            "创建全局规则 (AGENTS.md)",
                            DEFAULT_PROJECT_AGENTS_TEMPLATE,
                          )
                        }
                      >
                        创建主规则
                      </Button>
                    }
                  >
                    <Button
                      size="small"
                      variant="ghost-muted"
                      onClick={() =>
                        openFileDialog(
                          files.latest!.globalAgents,
                          false,
                          "编辑全局规则 (AGENTS.md)",
                          DEFAULT_PROJECT_AGENTS_TEMPLATE,
                        )
                      }
                    >
                      <Icon name="pencil-line" size="small" />
                      编辑
                    </Button>
                  </Show>
                </div>

                {/* Additional Rules */}
                <div class="rules-section-sub mt-2">
                  <span class="usage-section-title">
                    独立规则列表
                    <span class="text-11-regular text-v2-text-text-muted ml-1 font-normal">
                      ({(files.latest?.instructions ?? []).length} 条)
                    </span>
                  </span>
                  <Button size="small" variant="ghost-muted" icon="plus" onClick={openCreateRuleDialog}>
                    + 新增独立规则
                  </Button>
                </div>
                <Show when={(files.latest?.instructions ?? []).length > 0} fallback={
                  <div class="usage-status">尚未配置独立规则。点击右上角【创建规则】或【+ 新增独立规则】添加规则文件。</div>
                }>
                  <For each={files.latest?.instructions ?? []}>
                    {(source) => (
                      <div class="rules-row">
                        <div class="rules-row-copy">
                          <div class="rules-row-title-wrap">
                            <span class="rules-row-title truncate">{source.replace(/\\/g, "/").split("/").pop()}</span>
                            <span class="rules-status-badge rules-status-badge--active">独立规则</span>
                          </div>
                          <span class="rules-row-description rules-row-path">{source}</span>
                        </div>
                        <div class="flex items-center gap-1">
                          <Button
                            size="small"
                            variant="ghost-muted"
                            aria-label={language.t("common.edit")}
                            onClick={() => editInstruction(source)}
                          >
                            <Icon name="pencil" size="small" />
                            编辑
                          </Button>
                          <Button
                            size="small"
                            variant="ghost-muted"
                            aria-label={language.t("common.delete")}
                            onClick={() => void removeInstruction(source)}
                          >
                            <Icon name="trash" size="small" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>

          <div class="usage-section">
            <div class="usage-section-row">
              <span class="usage-section-title">
                {language.t("settings.rules.memory.section")}
                <span class="rules-beta">Beta</span>
              </span>
              <div class="flex items-center gap-2">
                {scopeTabs(memoryScope(), setMemoryScope)}
                <Button
                  size="small"
                  variant="contrast"
                  icon="plus"
                  onClick={openCreateMemoryDialog}
                >
                  创建记忆
                </Button>
              </div>
            </div>

            <div class="rules-rows">
              <div class="rules-row">
                <div class="rules-row-copy">
                  <span class="rules-row-title">{language.t("settings.rules.memory.toggle.title")}</span>
                  <span class="rules-row-description">{language.t("settings.rules.memory.toggle.description")}</span>
                </div>
                <Switch
                  checked={memoryState().enabled}
                  onChange={(checked) =>
                    void patch(
                      { memory: { enabled: checked === true } },
                      () => setMemoryOverrides({ ...memoryOverrides(), enabled: checked === true }),
                      () => setMemoryOverrides(undefined),
                    )
                  }
                />
              </div>
              <div class="rules-row">
                <div class="rules-row-copy">
                  <span class="rules-row-title">{language.t("settings.rules.memory.distill.title")}</span>
                  <span class="rules-row-description">{language.t("settings.rules.memory.distill.description")}</span>
                </div>
                <Switch
                  checked={memoryState().distill}
                  disabled={!memoryState().enabled}
                  onChange={(checked) =>
                    void patch(
                      { memory: { distill: checked === true } },
                      () => setMemoryOverrides({ ...memoryOverrides(), distill: checked === true }),
                      () => setMemoryOverrides(undefined),
                    )
                  }
                />
              </div>
            </div>

            {/* Scope Content */}
            <Show
              when={memoryScope() === "global"}
              fallback={
                <Show when={scopeProjectID()} fallback={
                  <div class="usage-status">{language.t("settings.rules.empty.projects")}</div>
                }>
                  <div class="rules-rows">
                    {/* Project Memory Repo (MEMORY.md) */}
                    <div class="rules-row">
                      <ProjectSelect
                        projects={projects()}
                        projectID={scopeProjectID()}
                        onSelect={setProjectID}
                      />
                      <div class="rules-row-copy">
                        <div class="rules-row-title-wrap">
                          <span class="rules-row-title">项目记忆 (MEMORY.md 总账本)</span>
                          <Show
                            when={files.latest?.memory.project?.content !== null}
                            fallback={<span class="rules-status-badge rules-status-badge--empty">未创建</span>}
                          >
                            <span class="rules-status-badge rules-status-badge--active">已创建</span>
                          </Show>
                        </div>
                        <span class="rules-row-description rules-row-path">
                          {files.latest?.memory.project?.path ?? "—"}
                        </span>
                      </div>
                      <Show
                        when={files.latest?.memory.project?.content !== null}
                        fallback={
                          <Button
                            size="small"
                            variant="contrast"
                            icon="plus"
                            onClick={() =>
                              openFileDialog(
                                files.latest!.memory.project!,
                                true,
                                `初始化项目记忆 (${projectName(scopeProjectID()!)})`,
                                DEFAULT_PROJECT_MEMORY_TEMPLATE,
                              )
                            }
                          >
                            初始化账本
                          </Button>
                        }
                      >
                        <Button
                          size="small"
                          variant="ghost-muted"
                          onClick={() =>
                            openFileDialog(
                              files.latest!.memory.project!,
                              false,
                              `编辑项目记忆全文 (${projectName(scopeProjectID()!)})`,
                              DEFAULT_PROJECT_MEMORY_TEMPLATE,
                            )
                          }
                        >
                          <Icon name="pencil-line" size="small" />
                          编辑全文
                        </Button>
                      </Show>
                    </div>

                    {/* Recorded Memory Items */}
                    <div class="rules-section-sub mt-2">
                      <span class="usage-section-title">
                        沉淀的记忆要点
                        <span class="text-11-regular text-v2-text-text-muted ml-1 font-normal">
                          ({currentMemoryItems().length} 条)
                        </span>
                      </span>
                      <Button size="small" variant="ghost-muted" icon="plus" onClick={openCreateMemoryDialog}>
                        + 新增记忆条目
                      </Button>
                    </div>

                    <Show
                      when={currentMemoryItems().length > 0}
                      fallback={
                        <div class="usage-status">暂无沉淀的记忆条目。点击右上角【创建记忆】或【+ 新增记忆条目】录入工作偏好与约定。</div>
                      }
                    >
                      <div class="memory-items-list">
                        <For each={currentMemoryItems()}>
                          {(item) => (
                            <div class="memory-item-card">
                              <div class="memory-item-main">
                                <div class="memory-item-header">
                                  <span class="memory-item-tag">{item.category}</span>
                                  <Show when={item.date}>
                                    <span class="memory-item-date">{item.date}</span>
                                  </Show>
                                </div>
                                <span class="memory-item-content">{item.content}</span>
                              </div>
                              <IconButton
                                type="button"
                                variant="ghost-muted"
                                size="small"
                                aria-label="删除此条记忆"
                                onClick={() => void removeMemoryItem(item.raw)}
                                icon={<Icon name="trash" size="small" />}
                              />
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>
              }
            >
              <div class="rules-rows">
                {/* Global Memory Repo (MEMORY.md) */}
                <div class="rules-row">
                  <div class="rules-row-copy">
                    <div class="rules-row-title-wrap">
                      <span class="rules-row-title">全局记忆 (MEMORY.md 总账本)</span>
                      <Show
                        when={files.latest?.memory.global.content !== null}
                        fallback={<span class="rules-status-badge rules-status-badge--empty">未创建</span>}
                      >
                        <span class="rules-status-badge rules-status-badge--active">已创建</span>
                      </Show>
                    </div>
                    <span class="rules-row-description rules-row-path">{files.latest?.memory.global.path ?? "—"}</span>
                  </div>
                  <Show
                    when={files.latest?.memory.global.content !== null}
                    fallback={
                      <Button
                        size="small"
                        variant="contrast"
                        icon="plus"
                        onClick={() =>
                          openFileDialog(
                            files.latest!.memory.global,
                            true,
                            "初始化全局记忆 (MEMORY.md)",
                            DEFAULT_PROJECT_MEMORY_TEMPLATE,
                          )
                        }
                      >
                        初始化账本
                      </Button>
                    }
                  >
                    <Button
                      size="small"
                      variant="ghost-muted"
                      onClick={() =>
                        openFileDialog(
                          files.latest!.memory.global,
                          false,
                          "编辑全局记忆全文 (MEMORY.md)",
                          DEFAULT_PROJECT_MEMORY_TEMPLATE,
                        )
                      }
                    >
                      <Icon name="pencil-line" size="small" />
                      编辑全文
                    </Button>
                  </Show>
                </div>

                {/* Recorded Memory Items */}
                <div class="rules-section-sub mt-2">
                  <span class="usage-section-title">
                    沉淀的记忆要点
                    <span class="text-11-regular text-v2-text-text-muted ml-1 font-normal">
                      ({currentMemoryItems().length} 条)
                    </span>
                  </span>
                  <Button size="small" variant="ghost-muted" icon="plus" onClick={openCreateMemoryDialog}>
                    + 新增记忆条目
                  </Button>
                </div>

                <Show
                  when={currentMemoryItems().length > 0}
                  fallback={
                    <div class="usage-status">暂无沉淀的记忆条目。点击右上角【创建记忆】或【+ 新增记忆条目】录入工作偏好与约定。</div>
                  }
                >
                  <div class="memory-items-list">
                    <For each={currentMemoryItems()}>
                      {(item) => (
                        <div class="memory-item-card">
                          <div class="memory-item-main">
                            <div class="memory-item-header">
                              <span class="memory-item-tag">{item.category}</span>
                              <Show when={item.date}>
                                <span class="memory-item-date">{item.date}</span>
                              </Show>
                            </div>
                            <span class="memory-item-content">{item.content}</span>
                          </div>
                          <IconButton
                            type="button"
                            variant="ghost-muted"
                            size="small"
                            aria-label="删除此条记忆"
                            onClick={() => void removeMemoryItem(item.raw)}
                            icon={<Icon name="trash" size="small" />}
                          />
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function ProjectSelect(props: {
  projects: ReadonlyArray<{ projectID: string; name: string }>
  projectID: string | undefined
  onSelect: (projectID: string | undefined) => void
}) {
  const language = useLanguage()
  const options = () => props.projects.map((item) => ({ id: item.projectID, label: item.name }))

  return (
    <Select
      options={options()}
      value={(item) => item.id}
      label={(item) => item.label}
      current={options().find((option) => option.id === props.projectID)}
      onSelect={(item) => props.onSelect(item?.id)}
      class="max-w-56"
      valueClass="truncate"
      aria-label={language.t("settings.workspaces.create.project")}
    />
  )
}

function SourceEditDialog(props: {
  source: string
  onSaved?: () => void
  onClose?: () => void
  onEditContent?: (filePath: string) => void
}) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [value, setValue] = createSignal(props.source)
  const [saving, setSaving] = createSignal(false)

  const save = async () => {
    if (saving() || !value().trim() || value().trim() === props.source) {
      props.onClose?.()
      return
    }
    setSaving(true)
    try {
      await sdk.api.experimental.config.update({ instruction: { source: props.source, remove: true } })
      await sdk.api.experimental.config.update({ instruction: { source: value().trim() } })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.saved.title"),
        description: language.t("settings.extensions.saved.description", { name: value().trim() }),
      })
      props.onSaved?.()
      props.onClose?.()
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    } finally {
      setSaving(false)
    }
  }

  const isLocalFile = () => props.source.endsWith(".md") || props.source.includes("/") || props.source.includes("\\")

  return (
    <Dialog size="large" variant="settings" preventBackdropDismiss={saving()}>
      <DialogHeader>
        <DialogTitleGroup title="编辑规则指令源" description={props.source} />
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        <TextField
          label="规则路径或 URL"
          value={value()}
          onChange={setValue}
          placeholder="例如：AGENTS.md 或 https://example.com/rules.md"
          autofocus
        />
        <Show when={isLocalFile()}>
          <div class="mt-3 flex items-center justify-between rounded border border-v2-border-subtle p-2 text-11-regular">
            <span class="text-v2-text-muted">此指令源可能为本地规则文件，可直接查看与编辑其 Markdown 内容</span>
            <Button
              size="small"
              variant="ghost-muted"
              onClick={() => props.onEditContent?.(props.source)}
            >
              编辑文件内容
            </Button>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={() => void save()} disabled={saving() || !value().trim()}>
          <Show when={saving()} fallback={language.t("common.save")}>
            <Loader class="custom-agent-dialog-spinner" />
          </Show>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function FileEditDialog(props: {
  title: string
  path: string
  content: string
  isCreate?: boolean
  onSaved?: () => void
  onClose?: () => void
}) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [content, setContent] = createSignal(props.content)
  const [saving, setSaving] = createSignal(false)
  const [viewMode, setViewMode] = createSignal<"edit" | "split" | "preview">("split")
  const [showIssues, setShowIssues] = createSignal(false)

  const issues = createMemo(() => validateMarkdown(content()))
  const previewHtml = createMemo(() => renderMarkdownPreview(content()))

  const save = async () => {
    if (saving()) return
    setSaving(true)
    try {
      await sdk.api.experimental.file.write({
        path: props.path,
        payload: encoder.encode(content()),
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: props.isCreate ? "已成功创建" : language.t("settings.extensions.saved.title"),
        description: language.t("settings.extensions.saved.description", { name: props.path }),
      })
      props.onSaved?.()
      props.onClose?.()
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog size="x-large" variant="settings" resizable maximizable preventBackdropDismiss={saving()}>
      <DialogHeader>
        <div class="flex w-full items-center justify-between">
          <DialogTitleGroup title={props.title} description={props.path} />
          <div class="rules-view-tabs mr-6">
            <Button
              size="small"
              variant={viewMode() === "edit" ? "contrast" : "ghost-muted"}
              onClick={() => setViewMode("edit")}
            >
              编辑
            </Button>
            <Button
              size="small"
              variant={viewMode() === "split" ? "contrast" : "ghost-muted"}
              onClick={() => setViewMode("split")}
            >
              分栏
            </Button>
            <Button
              size="small"
              variant={viewMode() === "preview" ? "contrast" : "ghost-muted"}
              onClick={() => setViewMode("preview")}
            >
              预览
            </Button>
          </div>
        </div>
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        {/* Real-time Visual Markdown Syntax Validator Bar */}
        <div
          class={`rules-syntax-bar ${
            issues().length === 0 ? "rules-syntax-bar--valid" : "rules-syntax-bar--warning"
          }`}
        >
          <div class="flex items-center gap-2">
            <Icon
              name={issues().length === 0 ? "circle-check" : "circle-exclamation"}
              size="small"
            />
            <span>
              {issues().length === 0
                ? "✓ Markdown 语法检查通过：未发现语法与格式错误"
                : `⚠ 检测到 ${issues().length} 个 Markdown 语法/格式注意项`}
            </span>
          </div>
          <Show when={issues().length > 0}>
            <Button
              size="small"
              variant="ghost"
              onClick={() => setShowIssues(!showIssues())}
            >
              {showIssues() ? "收起明细" : "查看明细"}
            </Button>
          </Show>
        </div>

        <Show when={showIssues() && issues().length > 0}>
          <div class="rules-syntax-issues mb-3 rounded border border-v2-border bg-v2-surface-subtle p-2">
            <For each={issues()}>
              {(item) => (
                <div class="rules-syntax-issue-item">
                  <span class="rounded bg-v2-surface px-1.5 py-0.5 text-10-regular text-v2-text-muted">
                    第 {item.line} 行
                  </span>
                  <span>{item.message}</span>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* View Mode Switching */}
        <Show when={viewMode() === "edit"}>
          <textarea
            class="custom-agent-dialog-textarea rules-editor"
            value={content()}
            rows={18}
            onInput={(event) => setContent(event.currentTarget.value)}
            spellcheck={false}
          />
        </Show>

        <Show when={viewMode() === "preview"}>
          <div
            class="rules-preview-pane"
            style={{ height: "480px" }}
            innerHTML={previewHtml()}
          />
        </Show>

        <Show when={viewMode() === "split"}>
          <div class="rules-split-container">
            <div class="rules-split-pane">
              <textarea
                class="custom-agent-dialog-textarea rules-editor"
                style={{ height: "100%", "min-height": "100%" }}
                value={content()}
                onInput={(event) => setContent(event.currentTarget.value)}
                spellcheck={false}
              />
            </div>
            <div
              class="rules-split-pane rules-preview-pane"
              innerHTML={previewHtml()}
            />
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={() => void save()} disabled={saving()}>
          <Show when={saving()} fallback={props.isCreate ? "创建" : language.t("common.save")}>
            <Loader class="custom-agent-dialog-spinner" />
          </Show>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function CreateRuleFileDialog(props: {
  baseDir: string
  scopeLabel: string
  onSaved?: () => void
  onClose?: () => void
}) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [filename, setFilename] = createSignal("rules/code-standards.md")
  const [content, setContent] = createSignal(
    `# 规则名称\n\n## 适用范围与要求\n在此处详细说明智能体需要遵循的约束规范。\n\n## 具体准则\n- 准则 1：保持代码整洁与类型安全，严禁随意引入 any。\n- 准则 2：修改代码后必须进行验证与类型检查。\n`,
  )
  const [saving, setSaving] = createSignal(false)
  const [viewMode, setViewMode] = createSignal<"edit" | "split" | "preview">("split")
  const [showIssues, setShowIssues] = createSignal(false)

  const issues = createMemo(() => validateMarkdown(content()))
  const previewHtml = createMemo(() => renderMarkdownPreview(content()))

  const resolvedPath = createMemo(() => {
    const raw = filename().trim().replace(/\\/g, "/")
    if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) return raw
    const base = props.baseDir.replace(/\\/g, "/").replace(/\/+$/, "")
    return base ? `${base}/${raw.replace(/^\/+/, "")}` : raw
  })

  const save = async () => {
    if (saving() || !filename().trim()) return
    setSaving(true)
    try {
      const fullPath = resolvedPath()
      await sdk.api.experimental.file.write({
        path: fullPath,
        payload: encoder.encode(content()),
      })
      await sdk.api.experimental.config.update({
        instruction: { source: fullPath },
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "独立规则已成功创建并启用",
        description: `规则文件 ${fullPath} 已添加至系统指令中`,
      })
      props.onSaved?.()
      props.onClose?.()
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog size="x-large" variant="settings" resizable maximizable preventBackdropDismiss={saving()}>
      <DialogHeader>
        <div class="flex w-full items-center justify-between">
          <DialogTitleGroup
            title={`创建独立规则文件 (${props.scopeLabel})`}
            description="创建独立的规则文件并自动注册到系统上下文指令中"
          />
          <div class="rules-view-tabs mr-8">
            <Button
              size="small"
              variant={viewMode() === "edit" ? "contrast" : "ghost-muted"}
              onClick={() => setViewMode("edit")}
            >
              编辑
            </Button>
            <Button
              size="small"
              variant={viewMode() === "split" ? "contrast" : "ghost-muted"}
              onClick={() => setViewMode("split")}
            >
              分屏对照
            </Button>
            <Button
              size="small"
              variant={viewMode() === "preview" ? "contrast" : "ghost-muted"}
              onClick={() => setViewMode("preview")}
            >
              实时预览
            </Button>
          </div>
        </div>
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        <div class="custom-agent-dialog-field mb-3">
          <TextField
            label="规则文件名 / 相对路径"
            value={filename()}
            onChange={setFilename}
            placeholder="例如：rules/code-standards.md 或 conventions.md"
            autofocus
          />
          <span class="text-11-regular text-v2-text-text-muted font-mono mt-1 break-all">
            目标完整路径：{resolvedPath()}
          </span>
        </div>

        {/* Syntax bar */}
        <div class={`rules-syntax-bar ${issues().length === 0 ? "rules-syntax-bar--valid" : "rules-syntax-bar--warning"}`}>
          <div class="flex items-center gap-2">
            <Icon name={issues().length === 0 ? "circle-check" : "circle-exclamation"} size="small" />
            <span>
              {issues().length === 0 ? "Markdown 格式校验通过，语法规范" : `检测到 ${issues().length} 处 Markdown 语法建议`}
            </span>
          </div>
          <Show when={issues().length > 0}>
            <Button
              size="small"
              variant="ghost"
              onClick={() => setShowIssues(!showIssues())}
            >
              {showIssues() ? "收起明细" : "查看明细"}
            </Button>
          </Show>
        </div>

        <Show when={showIssues() && issues().length > 0}>
          <div class="rules-syntax-issues mb-3 rounded border border-v2-border bg-v2-surface-subtle p-2">
            <For each={issues()}>
              {(item) => (
                <div class="rules-syntax-issue-item">
                  <span class="rounded bg-v2-surface px-1.5 py-0.5 text-10-regular text-v2-text-muted">
                    第 {item.line} 行
                  </span>
                  <span>{item.message}</span>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={viewMode() === "edit"}>
          <textarea
            class="custom-agent-dialog-textarea rules-editor"
            value={content()}
            rows={18}
            onInput={(event) => setContent(event.currentTarget.value)}
            spellcheck={false}
          />
        </Show>

        <Show when={viewMode() === "preview"}>
          <div
            class="rules-preview-pane"
            style={{ height: "480px" }}
            innerHTML={previewHtml()}
          />
        </Show>

        <Show when={viewMode() === "split"}>
          <div class="rules-split-container">
            <div class="rules-split-pane">
              <textarea
                class="custom-agent-dialog-textarea rules-editor"
                style={{ height: "100%", "min-height": "100%" }}
                value={content()}
                onInput={(event) => setContent(event.currentTarget.value)}
                spellcheck={false}
              />
            </div>
            <div
              class="rules-split-pane rules-preview-pane"
              innerHTML={previewHtml()}
            />
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={() => void save()} disabled={saving() || !filename().trim()}>
          <Show when={saving()} fallback="保存并启用规则">
            <Loader class="custom-agent-dialog-spinner" />
          </Show>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function CreateMemoryItemDialog(props: {
  file: FileRef
  scopeLabel: string
  onSaved?: () => void
  onClose?: () => void
}) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [category, setCategory] = createSignal("项目偏好")
  const [content, setContent] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  const categories = [
    { id: "项目偏好", label: "项目偏好" },
    { id: "架构规范", label: "架构规范" },
    { id: "开发约定", label: "开发约定" },
    { id: "环境约束", label: "环境约束" },
    { id: "关键决策", label: "关键决策" },
    { id: "常用指令", label: "常用指令" },
    { id: "其他", label: "其他" },
  ]
  const today = new Date().toISOString().slice(0, 10)

  const previewText = createMemo(() => {
    return `- **[${category()}]** (${today}): ${content().trim() || "（请输入记忆内容...）"}`
  })

  const save = async () => {
    if (saving() || !content().trim()) return
    setSaving(true)
    try {
      const current = props.file.content ?? "# 项目与全局记忆\n\n## 沉淀记忆\n"
      const entry = `\n- **[${category()}]** (${today}): ${content().trim()}\n`
      const nextContent = current + entry
      await sdk.api.experimental.file.write({
        path: props.file.path,
        payload: encoder.encode(nextContent),
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "记忆条目已添加",
        description: `已成功追加至 ${props.scopeLabel} 记忆中`,
      })
      props.onSaved?.()
      props.onClose?.()
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog size="large" variant="settings" preventBackdropDismiss={saving()}>
      <DialogHeader>
        <DialogTitleGroup
          title={`新增记忆条目 (${props.scopeLabel})`}
          description="录入一条偏好、规范或约定，保存后将自动沉淀至 MEMORY.md 账本中"
        />
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        <div class="custom-agent-dialog-field mb-3">
          <label class="text-12-medium text-v2-text-text-base mb-1.5 block">记忆类别 / 标签</label>
          <div class="flex flex-wrap gap-1.5">
            <For each={categories}>
              {(cat) => (
                <Button
                  size="small"
                  variant={category() === cat.id ? "contrast" : "ghost-muted"}
                  onClick={() => setCategory(cat.id)}
                >
                  {cat.label}
                </Button>
              )}
            </For>
          </div>
        </div>

        <div class="custom-agent-dialog-field mb-3">
          <label class="text-12-medium text-v2-text-text-base mb-1.5 block">记忆具体内容</label>
          <textarea
            class="custom-agent-dialog-textarea"
            rows={5}
            value={content()}
            onInput={(e) => setContent(e.currentTarget.value)}
            placeholder="例如：本项目前端统一使用 SolidJS，所有组件放在 src/ 目录下；所有终端命令统一使用 bun 运行，禁止使用 npm/yarn。"
            autofocus
          />
        </div>

        <div class="rounded-lg border border-v2-border bg-v2-surface-subtle p-3 text-12-regular">
          <div class="text-11-medium text-v2-text-text-muted mb-1">预览追加格式：</div>
          <div class="font-mono text-12-regular text-v2-text-text-base">{previewText()}</div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={() => void save()} disabled={saving() || !content().trim()}>
          <Show when={saving()} fallback="保存记忆条目">
            <Loader class="custom-agent-dialog-spinner" />
          </Show>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
