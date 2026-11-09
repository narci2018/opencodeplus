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

  const addInstruction = () => {
    void dialog.show(
      () => (
        <SourceAddDialog
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
                  onClick={() => {
                    if (rulesScope() === "global") {
                      openFileDialog(
                        files.latest!.globalAgents,
                        true,
                        "创建全局规则 (AGENTS.md)",
                        DEFAULT_PROJECT_AGENTS_TEMPLATE,
                      )
                    } else if (files.latest?.projectAgents) {
                      openFileDialog(
                        files.latest.projectAgents,
                        true,
                        `创建项目规则 (${projectName(scopeProjectID()!)})`,
                        DEFAULT_PROJECT_AGENTS_TEMPLATE,
                      )
                    }
                  }}
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
            <Show
              when={rulesScope() === "global"}
              fallback={
                <Show when={scopeProjectID()} fallback={
                  <div class="usage-status">{language.t("settings.rules.empty.projects")}</div>
                }>
                  <div class="rules-rows">
                    <div class="rules-row">
                      <ProjectSelect
                        projects={projects()}
                        projectID={scopeProjectID()}
                        onSelect={setProjectID}
                      />
                      <div class="rules-row-copy">
                        <div class="rules-row-title-wrap">
                          <span class="rules-row-title">{projectName(scopeProjectID()!)}</span>
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
                      <Show when={files.latest?.projectAgents}>
                        {(file) => (
                          <Button
                            size="small"
                            variant="ghost-muted"
                            onClick={() =>
                              openFileDialog(
                                file(),
                                file().content === null,
                                `编辑项目规则 (${projectName(scopeProjectID()!)})`,
                                file().content === null ? DEFAULT_PROJECT_AGENTS_TEMPLATE : undefined,
                              )
                            }
                          >
                            <Icon name="pencil-line" size="small" />
                            编辑
                          </Button>
                        )}
                      </Show>
                    </div>
                  </div>
                </Show>
              }
            >
              <div class="rules-rows">
                <div class="rules-row">
                  <div class="rules-row-copy">
                    <div class="rules-row-title-wrap">
                      <span class="rules-row-title">{language.t("settings.rules.file.globalAgents")}</span>
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
                  <Button
                    size="small"
                    variant="ghost-muted"
                    onClick={() =>
                      openFileDialog(
                        files.latest!.globalAgents,
                        files.latest?.globalAgents.content === null,
                        "编辑全局规则 (AGENTS.md)",
                        files.latest?.globalAgents.content === null ? DEFAULT_PROJECT_AGENTS_TEMPLATE : undefined,
                      )
                    }
                  >
                    <Icon name="pencil-line" size="small" />
                    编辑
                  </Button>
                </div>
              </div>
              <div class="rules-rows">
                <div class="rules-section-sub">
                  <span class="usage-section-title">{language.t("settings.rules.sources")}</span>
                  <Button size="small" variant="ghost-muted" icon="plus" onClick={addInstruction}>
                    {language.t("settings.rules.sources.add")}
                  </Button>
                </div>
                <Show when={(files.latest?.instructions ?? []).length > 0} fallback={
                  <div class="usage-status">{language.t("settings.rules.sources.empty")}</div>
                }>
                  <For each={files.latest?.instructions ?? []}>
                    {(source) => (
                      <div class="rules-row">
                        <div class="rules-row-copy">
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
                  onClick={() => {
                    if (memoryScope() === "global") {
                      openFileDialog(
                        files.latest!.memory.global,
                        true,
                        "创建全局记忆 (MEMORY.md)",
                        DEFAULT_PROJECT_MEMORY_TEMPLATE,
                      )
                    } else if (files.latest?.memory.project) {
                      openFileDialog(
                        files.latest.memory.project,
                        true,
                        `创建项目记忆 (${projectName(scopeProjectID()!)})`,
                        DEFAULT_PROJECT_MEMORY_TEMPLATE,
                      )
                    }
                  }}
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
            <Show
              when={memoryScope() === "global"}
              fallback={
                <Show when={scopeProjectID()} fallback={
                  <div class="usage-status">{language.t("settings.rules.empty.projects")}</div>
                }>
                  <div class="rules-rows">
                    <div class="rules-row">
                      <ProjectSelect
                        projects={projects()}
                        projectID={scopeProjectID()}
                        onSelect={setProjectID}
                      />
                      <div class="rules-row-copy">
                        <div class="rules-row-title-wrap">
                          <span class="rules-row-title">{language.t("settings.rules.memory.project")}</span>
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
                      <Show when={files.latest?.memory.project}>
                        {(file) => (
                          <Button
                            size="small"
                            variant="ghost-muted"
                            onClick={() =>
                              openFileDialog(
                                file(),
                                file().content === null,
                                `编辑项目记忆 (${projectName(scopeProjectID()!)})`,
                                file().content === null ? DEFAULT_PROJECT_MEMORY_TEMPLATE : undefined,
                              )
                            }
                          >
                            <Icon name="pencil-line" size="small" />
                            编辑
                          </Button>
                        )}
                      </Show>
                    </div>
                  </div>
                </Show>
              }
            >
              <div class="rules-rows">
                <div class="rules-row">
                  <div class="rules-row-copy">
                    <div class="rules-row-title-wrap">
                      <span class="rules-row-title">{language.t("settings.rules.memory.global")}</span>
                      <Show
                        when={files.latest?.memory.global.content !== null}
                        fallback={<span class="rules-status-badge rules-status-badge--empty">未创建</span>}
                      >
                        <span class="rules-status-badge rules-status-badge--active">已创建</span>
                      </Show>
                    </div>
                    <span class="rules-row-description rules-row-path">{files.latest?.memory.global.path ?? "—"}</span>
                  </div>
                  <Button
                    size="small"
                    variant="ghost-muted"
                    onClick={() =>
                      openFileDialog(
                        files.latest!.memory.global,
                        files.latest?.memory.global.content === null,
                        "编辑全局记忆 (MEMORY.md)",
                        files.latest?.memory.global.content === null ? DEFAULT_PROJECT_MEMORY_TEMPLATE : undefined,
                      )
                    }
                  >
                    <Icon name="pencil-line" size="small" />
                    编辑
                  </Button>
                </div>
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

function SourceAddDialog(props: { onSaved?: () => void; onClose?: () => void }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [value, setValue] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  const save = async () => {
    if (saving() || !value().trim()) return
    setSaving(true)
    try {
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

  return (
    <Dialog size="large" variant="settings" preventBackdropDismiss={saving()}>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.rules.sources.add.title")}
          description={language.t("settings.rules.sources.add.description")}
        />
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        <TextField
          label={language.t("settings.rules.sources.add.label")}
          value={value()}
          onChange={setValue}
          placeholder={language.t("settings.rules.sources.add.placeholder")}
          autofocus
        />
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
