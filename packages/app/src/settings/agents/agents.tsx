import { CustomAgents } from "@/providers/custom-agent"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { normalizeAgentList } from "@/runtime/server/global-sync/utils"
import { showToast } from "@/shell/notifications/toast"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { renderMarkdownPreview, validateMarkdown } from "@/settings/rules/rules"
import "@/settings/rules/rules.css"
import "@/settings/settings.css"

const DEFAULT_PROMPTS: Record<string, string> = {
  build: `你是一个全能的代码与项目工程主智能体（Build）。
你的职责是精准理解用户的工程目标，遵循以下准则工作：
1. 深入阅读代码与上下文证据，绝不凭空假设或臆断代码行为。
2. 保持代码整洁与类型完备，遵循已有代码规范与架构分层。
3. 严格遵循用户指令，执行修改后积极运行类型检查与测试验证。
4. 如遇歧义或高风险操作，主动与用户对齐沟通。`,
  plan: `你是一个需求分析与架构规划智能体（Plan）。
你的职责是探索代码库、分析依赖关系、梳理实现路径、拆解技术方案并制定步骤。
在规划阶段保持只读，不修改核心代码，与用户讨论形成切实可行的落地路线图。`,
  trae: `You are TRAE, an OpenCode orchestrator agent: you plan briefly, then drive code, browser, and desktop tools through Code Mode to finish multi-step work with as few round trips as possible.

## Working rules
1. Restate the goal in one line, then act on tool evidence rather than assumptions; verify between steps.
2. Reuse established tool contracts; never guess parameters.
3. Bound runaway work and maintain strict safety and verification standards.
4. Finish structured work with a JSON summary.`,
  "trae-bao": `你是 TRAE 宝，基于 Trae CN 智能体逆向适配的开发者全能伙伴与专属助手。你与主智能体 TRAE 协同工作，擅长跨项目记忆检索、多任务拆解并行、敏捷开发协作以及结论式汇报。

## 核心职责
1. 双助理模式：全局视野与项目执行并重，在多任务间保持连贯上下文。
2. 多任务拆解与并发：面对复杂需求，自动解耦与模块化拆分。
3. 结论式高效汇报：先给结论和核心依据，后附详细信息与文件路径。
4. 工具驱动与验证：熟练使用工具，所有操作以真实代码证据为准。`,
}

type BuiltinAgentItem = {
  id: string
  name: string
  description: string
  mode: string
  prompt?: string
}

const DEFAULT_BUILTIN_AGENTS: BuiltinAgentItem[] = [
  {
    id: "build",
    name: "Build",
    description: "默认主智能体：根据配置的工作区权限执行工具、读写文件与代码生成。",
    mode: "primary",
    prompt: DEFAULT_PROMPTS.build,
  },
  {
    id: "plan",
    name: "Plan",
    description: "需求规划智能体：探索代码库、梳理实现路径、拆解技术方案并制定步骤。",
    mode: "primary",
    prompt: DEFAULT_PROMPTS.plan,
  },
  {
    id: "trae",
    name: "TRAE",
    description:
      "Trae CN 主智能体：通过 Code Mode 驱动代码、浏览器与桌面自动化工具的编排专家，擅长多步骤全流程任务。",
    mode: "all",
    prompt: DEFAULT_PROMPTS.trae,
  },
  {
    id: "trae-bao",
    name: "TRAE 宝",
    description:
      "Trae CN 开发者伙伴助理：跨会话与跨项目记忆、多任务拆解并行推进、敏捷开发协作者与专属助理。",
    mode: "all",
    prompt: DEFAULT_PROMPTS["trae-bao"],
  },
]

export const SettingsAgents = () => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()

  const [configEntries, configActions] = createResource(
    () => sdk.connection.status() === "connected",
    async (connected) => {
      if (!connected) return []
      return sdk.api.config.get().catch(() => [])
    },
  )

  const [agents, agentsActions] = createResource(
    () => sdk.connection.status() === "connected",
    async (connected) => {
      if (!connected) return { builtin: DEFAULT_BUILTIN_AGENTS, subagents: [] }
      const res = await sdk.api.agent.list().catch(() => undefined)
      if (!res?.data) return { builtin: DEFAULT_BUILTIN_AGENTS, subagents: [] }
      const list = normalizeAgentList(res.data)
      const visible = list.filter((item) => item.native && !item.hidden && item.mode !== "subagent")
      const visibleSubagents = list.filter((item) => item.native && !item.hidden && item.mode === "subagent")
      return {
        builtin:
          visible.length === 0
            ? DEFAULT_BUILTIN_AGENTS
            : visible.map((item) => ({
                id: item.name,
                name: item.displayName || item.name,
                description: item.description ?? "",
                mode: item.mode,
                prompt: item.prompt || DEFAULT_PROMPTS[item.name],
              })),
        subagents: visibleSubagents.map((item) => ({
          id: item.name,
          name: item.displayName || item.name,
          description: item.description ?? "",
          mode: item.mode,
          prompt: item.prompt || DEFAULT_PROMPTS[item.name],
        })),
      }
    },
  )

  const customOverrides = createMemo(() => {
    const map = new Map<string, string>()
    for (const doc of configEntries() ?? []) {
      if (doc.type !== "document") continue
      const docAgents = (doc.info as { agents?: Record<string, { system?: string }> })?.agents ?? {}
      for (const [id, cfg] of Object.entries(docAgents)) {
        if (cfg?.system) map.set(id, cfg.system)
      }
    }
    return map
  })

  const isCustomized = (id: string) => customOverrides().has(id)
  const liveBuiltins = createMemo(() => agents()?.builtin ?? DEFAULT_BUILTIN_AGENTS)
  const liveSubagents = createMemo(() => agents()?.subagents ?? [])

  const openPromptEditor = (agent: BuiltinAgentItem) => {
    const currentPrompt =
      customOverrides().get(agent.id) ??
      agent.prompt ??
      DEFAULT_PROMPTS[agent.id] ??
      ""

    void dialog.show(
      () => (
        <AgentPromptEditDialog
          agent={agent}
          isCustomized={isCustomized(agent.id)}
          initialPrompt={currentPrompt}
          defaultPrompt={DEFAULT_PROMPTS[agent.id] ?? ""}
          onSaved={async () => {
            await Promise.all([agentsActions.refetch(), configActions.refetch()])
            data.location.agent.invalidate(undefined)
            await data.location.agent.sync().catch(() => undefined)
          }}
          onClose={() => dialog.close()}
        />
      ),
      () => undefined,
    )
  }

  return (
    <div class="settings-tab-body">
      <div class="settings-tab-header">
        <h2 class="settings-tab-title">{language.t("settings.agents.title")}</h2>
        <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.agents.description")}</span>
      </div>

      <div class="settings-models-group" data-component="builtin-agents-section">
        <div class="settings-models-group-header">
          <span class="settings-models-group-title">
            {language.t("settings.agents.builtin.title") ?? "内置与原生智能体"}
          </span>
        </div>
        <div class="settings-models-group-items">
          <For each={liveBuiltins()}>
            {(agent) => (
              <div class="settings-models-row">
                <div class="settings-models-row-copy">
                  <div class="flex items-center gap-2">
                    <span class="settings-models-row-title font-medium">{agent.name}</span>
                    <span class="text-10-regular px-1.5 py-0.5 rounded bg-v2-surface-subtle text-v2-text-muted border border-v2-border-subtle">
                      内置
                    </span>
                    <span class="text-10-regular px-1.5 py-0.5 rounded bg-v2-surface-subtle text-v2-text-muted border border-v2-border-subtle">
                      {agent.id}
                    </span>
                    <Show when={isCustomized(agent.id)}>
                      <span class="rules-status-badge rules-status-badge--active">
                        已自定义提示词
                      </span>
                    </Show>
                  </div>
                  <span class="settings-models-row-description">{agent.description}</span>
                </div>
                <div class="flex items-center gap-2">
                  <Button
                    size="small"
                    variant="ghost-muted"
                    onClick={() => openPromptEditor(agent)}
                  >
                    <Icon name="pencil-line" size="small" />
                    编辑提示词
                  </Button>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="settings-models-group" data-component="subagents-section">
        <div class="settings-models-group-header">
          <span class="settings-models-group-title">
            {language.t("settings.agents.subagents.title") ?? "SubAgents（子智能体）"}
          </span>
        </div>
        <div class="settings-models-group-items">
          <For each={liveSubagents()}>
            {(agent) => (
              <div class="settings-models-row">
                <div class="settings-models-row-copy">
                  <div class="flex items-center gap-2">
                    <span class="settings-models-row-title font-medium">{agent.name}</span>
                    <span class="text-10-regular px-1.5 py-0.5 rounded bg-v2-surface-subtle text-v2-text-muted border border-v2-border-subtle">
                      子智能体
                    </span>
                    <span class="text-10-regular px-1.5 py-0.5 rounded bg-v2-surface-subtle text-v2-text-muted border border-v2-border-subtle">
                      {agent.id}
                    </span>
                  </div>
                  <span class="settings-models-row-description">{agent.description}</span>
                </div>
              </div>
            )}
          </For>
          <Show when={liveSubagents().length === 0}>
            <span class="text-12-regular text-v2-text-text-muted">
              {language.t("settings.agents.subagents.empty") ?? "暂无子智能体"}
            </span>
          </Show>
        </div>
      </div>

      <CustomAgents />
    </div>
  )
}

function AgentPromptEditDialog(props: {
  agent: { id: string; name: string; description: string }
  isCustomized: boolean
  initialPrompt: string
  defaultPrompt: string
  onSaved: () => Promise<void>
  onClose: () => void
}) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const [content, setContent] = createSignal(props.initialPrompt)
  const [saving, setSaving] = createSignal(false)
  const [resetting, setResetting] = createSignal(false)
  const [viewMode, setViewMode] = createSignal<"edit" | "split" | "preview">("split")
  const [showIssues, setShowIssues] = createSignal(false)

  const issues = createMemo(() => validateMarkdown(content()))
  const previewHtml = createMemo(() => renderMarkdownPreview(content()))

  const save = async () => {
    if (saving()) return
    setSaving(true)
    try {
      await sdk.api.experimental.config.update({
        agent: {
          id: props.agent.id,
          system: content().trim(),
        },
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "智能体提示词已保存",
        description: `已成功为「${props.agent.name}」配置自定义 System Prompt`,
      })
      await props.onSaved()
      props.onClose()
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

  const resetToDefault = async () => {
    if (resetting() || saving()) return
    setResetting(true)
    try {
      await sdk.api.experimental.config.update({
        agent: {
          id: props.agent.id,
          remove: true,
        },
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "已恢复默认提示词",
        description: `智能体「${props.agent.name}」已重置为官方内置提示词`,
      })
      await props.onSaved()
      props.onClose()
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    } finally {
      setResetting(false)
    }
  }

  return (
    <Dialog size="x-large" variant="settings" resizable maximizable preventBackdropDismiss={saving() || resetting()}>
      <DialogHeader>
        <div class="flex w-full items-center justify-between">
          <DialogTitleGroup
            title={`编辑智能体提示词 - ${props.agent.name}`}
            description={`智能体标识：${props.agent.id} · 支持配置自定义 System Prompt`}
          />
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
                ? "✓ Markdown 语法检查通过：未发现格式问题"
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
        <div class="flex w-full items-center justify-between">
          <div>
            <Show when={props.isCustomized}>
              <Button
                variant="ghost"
                onClick={() => void resetToDefault()}
                disabled={saving() || resetting()}
              >
                <Show when={resetting()} fallback="恢复官方默认提示词">
                  <Loader class="custom-agent-dialog-spinner" />
                </Show>
              </Button>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="ghost" onClick={() => props.onClose()} disabled={saving() || resetting()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="contrast" onClick={() => void save()} disabled={saving() || resetting()}>
              <Show when={saving()} fallback="保存提示词">
                <Loader class="custom-agent-dialog-spinner" />
              </Show>
            </Button>
          </div>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
