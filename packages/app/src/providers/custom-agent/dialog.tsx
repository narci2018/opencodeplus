import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { Loader } from "@opencode/ui/loader"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@opencode/ui/dialog"
import { showToast } from "@/shell/notifications/toast"
import { createEffect, createMemo, createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { DialogMcp } from "@/providers/connect/mcp-dialog"
import {
  agentID,
  agentPatch,
  agentPermissions,
  decodeToolSelection,
  generatePrompt,
  isBuiltinAgent,
  parseGeneratedAgent,
  TOOL_GROUPS,
  type CustomAgentEntry,
  type CustomAgentModel,
  type GeneratedAgent,
} from "./presets"
import "@/settings/settings.css"
import "./custom-agent.css"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

export type CustomAgentDialogProps = {
  /** Custom agents already present in the config, for editing and listing. */
  existing: CustomAgentEntry[]
  /** When set, the dialog pre-fills fields for editing this agent. */
  editing?: CustomAgentEntry
  onSaved?: () => void
  onClose?: () => void
}

export const CustomAgentDialog: Component<CustomAgentDialogProps> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()

  const [name, setName] = createSignal(props.editing?.id ?? "")
  const [identifier, setIdentifier] = createSignal(props.editing?.id ?? "")
  const [system, setSystem] = createSignal(props.editing?.system ?? "")
  const [callable, setCallable] = createSignal(props.editing ? props.editing.mode !== "primary" : true)
  const [whenToCall, setWhenToCall] = createSignal(props.editing?.description ?? "")
  const model = () => selectionString(props.editing?.model)
  const [enabledGroups, setEnabledGroups] = createSignal(
    decodeToolSelection({ permissions: props.editing?.permissions, configuredMcp: [] }).groups,
  )
  const [enabledMcp, setEnabledMcp] = createSignal(new Set<string>())
  const [saving, setSaving] = createSignal(false)
  const [generating, setGenerating] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  // Keep identifier synced with name if creating new and user hasn't explicitly diverged
  const [identifierTouched, setIdentifierTouched] = createSignal(!!props.editing)

  const handleNameChange = (val: string) => {
    setName(val)
    if (!identifierTouched() && !props.editing) {
      setIdentifier(agentID(val))
    }
    setError(undefined)
  }

  const handleIdentifierChange = (val: string) => {
    setIdentifierTouched(true)
    setIdentifier(val)
    setError(undefined)
  }

  const effectiveId = createMemo(() => agentID(identifier() || name()))
  const isReservedName = createMemo(() => isBuiltinAgent(effectiveId()))
  const conflict = createMemo(() =>
    props.existing.some((entry) => entry.id === effectiveId() && entry.id !== props.editing?.id),
  )

  // MCP connections
  const locationRef = () => data.location.default()
  createEffect(() => {
    if (sdk.connection.status() !== "connected") return
    void data.location.mcp.server.sync(locationRef()).catch(() => undefined)
  })
  const mcps = createMemo(() =>
    (data.location.mcp.server.list(locationRef()) ?? []).toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  // Seed the MCP selection
  const [mcpSeeded, setMcpSeeded] = createSignal(false)
  createEffect(() => {
    if (mcpSeeded()) return
    const names = mcps().map((server) => server.name)
    if (names.length === 0) return
    setMcpSeeded(true)
    setEnabledMcp(decodeToolSelection({ permissions: props.editing?.permissions, configuredMcp: names }).mcp)
  })

  const canSave = createMemo(() => {
    if (!name().trim() || !effectiveId().trim() || isReservedName() || conflict()) return false
    if (callable() && !whenToCall().trim()) return false
    return true
  })

  const toggleGroup = (group: string, checked: boolean) => {
    setEnabledGroups((current) => {
      const next = new Set(current)
      if (checked) next.add(group)
      else next.delete(group)
      return next
    })
  }

  const toggleMcpServer = (server: string, checked: boolean) => {
    setEnabledMcp((current) => {
      const next = new Set(current)
      if (checked) next.add(server)
      else next.delete(server)
      return next
    })
  }

  const allGroupsEnabled = createMemo(() => enabledGroups().size === TOOL_GROUPS.length)

  const addMcpServer = () => {
    const directory = data.location.default().directory
    void dialog.show(() => <DialogMcp directory={directory} />, () => undefined)
  }

  const generate = async () => {
    const promptSeed = system().trim() || name().trim() || whenToCall().trim()
    if (generating() || !promptSeed) return
    setGenerating(true)
    setError(undefined)
    try {
      const result = await sdk.api.experimental.generate.text({
        prompt: generatePrompt(promptSeed, mcps().map((server) => server.name)),
      })
      const parsed = parseGeneratedAgent(result.text)
      if (!parsed) {
        showToast({
          variant: "error",
          title: language.t("settings.agents.custom.generate.failed.title"),
          description: language.t("settings.agents.custom.generate.failed.description"),
        })
        return
      }
      applyGenerated(parsed)
    } catch (cause) {
      const message = formatServerError(cause, language.t)
      showToast({ variant: "error", title: language.t("common.requestFailed"), description: message })
    } finally {
      setGenerating(false)
    }
  }

  const applyGenerated = (parsed: GeneratedAgent) => {
    if (parsed.name && !name()) setName(parsed.name)
    if (parsed.whenToCall) {
      setCallable(true)
      setWhenToCall(parsed.whenToCall)
    }
    if (parsed.system) setSystem(parsed.system)
    if (parsed.tools && parsed.tools.length > 0) setEnabledGroups(new Set(parsed.tools))
    if (parsed.mcpServers) {
      const known = new Set(mcps().map((server) => server.name))
      setEnabledMcp(new Set(parsed.mcpServers.filter((server) => known.has(server))))
    }
  }

  const save = async () => {
    if (!canSave() || saving()) return
    setSaving(true)
    setError(undefined)
    try {
      const modelValue = parseSelection(model().trim()) ?? undefined
      await sdk.api.experimental.config.update({
        agent: agentPatch({
          id: effectiveId(),
          description: whenToCall(),
          system: system(),
          model: modelValue as CustomAgentModel | undefined,
          mode: callable() ? "all" : "primary",
          permissions: agentPermissions({
            enabledGroups: enabledGroups(),
            enabledMcp: enabledMcp(),
            configuredMcp: mcps().map((server) => server.name),
          }),
        }),
      })
      data.location.agent.invalidate(undefined)
      await data.location.agent.sync().catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: props.editing ? "智能体已更新" : language.t("settings.agents.custom.saved.title"),
        description: `“${effectiveId()}” 配置及提示词已成功保存。`,
      })
      props.onSaved?.()
      props.onClose?.()
    } catch (cause) {
      const message = formatServerError(cause, language.t)
      setError(message)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: message,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      size="large"
      variant="settings"
      preventBackdropDismiss={saving() || generating()}
      class="custom-agent-dialog"
    >
      <DialogHeader>
        <div class="custom-agent-header-row">
          <div class="custom-agent-breadcrumb">
            <span class="custom-agent-breadcrumb-muted">智能体 ❔</span>
            <span>/</span>
            <span>{props.editing ? "编辑智能体" : "创建智能体"}</span>
          </div>
          <Button
            size="small"
            variant="ghost-muted"
            onClick={() => void generate()}
            disabled={generating() || (!system().trim() && !name().trim())}
          >
            <Show when={generating()} fallback={<>✨ 智能生成</>}>
              <Loader class="custom-agent-dialog-spinner" />
            </Show>
          </Button>
        </div>
      </DialogHeader>

      <DialogBody class="custom-agent-dialog-body">
        {/* Top: Avatar + 名称* */}
        <div class="custom-agent-top-row">
          <div class="custom-agent-avatar-box">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="6" width="18" height="15" rx="3" stroke="#8b5cf6" stroke-width="2" />
              <path d="M7 3L9 6H15L17 3L12 5L7 3Z" fill="#ec4899" />
              <circle cx="8.5" cy="12.5" r="1.5" fill="#38bdf8" />
              <circle cx="15.5" cy="12.5" r="1.5" fill="#38bdf8" />
              <path d="M8 17H16" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </div>
          <div class="custom-agent-name-field">
            <label class="custom-agent-field-label">
              <span>名称</span>
              <span class="custom-agent-asterisk">*</span>
            </label>
            <div class="custom-agent-input-wrapper">
              <input
                type="text"
                class="custom-agent-input"
                placeholder="请输入智能体名称"
                maxlength={20}
                value={name()}
                onInput={(e) => handleNameChange(e.currentTarget.value)}
              />
              <span class="custom-agent-input-counter">{name().length}/20</span>
            </div>
            <Show when={isReservedName()}>
              <span class="text-11-regular text-v2-text-error">
                该名称为内置原生智能体保留标识（build / plan / trae / trae-bao），不能用于自定义智能体。
              </span>
            </Show>
            <Show when={conflict()}>
              <span class="text-11-regular text-v2-text-error">已存在同名自定义智能体，请更换名称。</span>
            </Show>
          </div>
        </div>

        {/* 提示词 (System Prompt) */}
        <div class="custom-agent-field">
          <label class="custom-agent-field-label">
            <span>提示词</span>
          </label>
          <div class="custom-agent-prompt-wrapper">
            <textarea
              class="custom-agent-prompt-textarea"
              placeholder="请输入智能体的角色、语气、工作流程、工具偏好及规则规范等。（选填）"
              maxlength={10000}
              rows={6}
              value={system()}
              onInput={(e) => {
                setSystem(e.currentTarget.value)
                setError(undefined)
              }}
            />
            <div class="custom-agent-prompt-footer">
              <span>{system().length}/10000</span>
              <span>⤡</span>
            </div>
          </div>
        </div>

        {/* 可被其他智能体调用 ⓘ */}
        <div class="custom-agent-field">
          <label class="custom-agent-field-label">
            <span>可被其他智能体调用</span>
            <span style={{ "font-size": "12px", color: "var(--v2-text-text-muted)" }}>ⓘ</span>
          </label>
          <div class="custom-agent-card">
            <div class="custom-agent-card-header">
              <div class="custom-agent-card-header-copy">
                <span class="custom-agent-card-title">可被其他智能体调用</span>
                <span class="custom-agent-card-desc">
                  可被内置和自定义智能体调用。
                  <a href="#" onClick={(e) => e.preventDefault()}>
                    帮助文档
                  </a>
                </span>
              </div>
              <Switch checked={callable()} onChange={(checked) => setCallable(checked === true)} />
            </div>

            <Show when={callable()}>
              <div class="custom-agent-card-inner">
                {/* 英文标识名* */}
                <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                  <label class="custom-agent-field-label">
                    <span>英文标识名</span>
                    <span class="custom-agent-asterisk">*</span>
                  </label>
                  <div class="custom-agent-input-wrapper">
                    <input
                      type="text"
                      class="custom-agent-input"
                      placeholder="被调用时的唯一英文标识名称，例如: project-analyzer"
                      maxlength={50}
                      value={identifier()}
                      onInput={(e) => handleIdentifierChange(e.currentTarget.value)}
                    />
                    <span class="custom-agent-input-counter">{identifier().length}/50</span>
                  </div>
                </div>

                {/* 何时调用* */}
                <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                  <label class="custom-agent-field-label">
                    <span>何时调用</span>
                    <span class="custom-agent-asterisk">*</span>
                  </label>
                  <div class="custom-agent-prompt-wrapper">
                    <textarea
                      class="custom-agent-prompt-textarea"
                      placeholder="请描述其他智能体调用该智能体的合适场景和时机"
                      maxlength={5000}
                      rows={3}
                      value={whenToCall()}
                      onInput={(e) => setWhenToCall(e.currentTarget.value)}
                    />
                    <div class="custom-agent-prompt-footer">
                      <span>{whenToCall().length}/5000</span>
                      <span>⤡</span>
                    </div>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </div>

        {/* 工具 ⓘ */}
        <div class="custom-agent-tools-section">
          <label class="custom-agent-field-label">
            <span>工具</span>
            <span style={{ "font-size": "12px", color: "var(--v2-text-text-muted)" }}>ⓘ</span>
          </label>

          {/* 工具 - MCP */}
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <span style={{ "font-size": "12px", "font-weight": "500", color: "var(--v2-text-text-muted)" }}>
              工具 - MCP
            </span>
            <div class="custom-agent-mcp-box">
              <span class="custom-agent-mcp-title">什么是 MCP Servers?</span>
              <p class="custom-agent-mcp-desc">
                Model Context Protocol (MCP) 允许大语言模型访问自定义工具和服务。MCP Servers
                是支持该协议的服务，提供工具和功能来扩展智能体的能力。添加后，智能体会自动调用合适的工具完成任务。
              </p>
              <Show when={mcps().length > 0}>
                <div style={{ display: "flex", "flex-direction": "column", gap: "6px", "margin-top": "6px" }}>
                  <For each={mcps()}>
                    {(server) => (
                      <Checkbox
                        checked={enabledMcp().has(server.name)}
                        disabled={server.status.status === "pending"}
                        description={
                          server.status.status === "pending"
                            ? undefined
                            : language.t(statusLabels[server.status.status])
                        }
                        onChange={(checked) => toggleMcpServer(server.name, checked === true)}
                      >
                        {server.name}
                      </Checkbox>
                    )}
                  </For>
                </div>
              </Show>
              <div>
                <Button size="small" variant="ghost-muted" icon="plus" onClick={addMcpServer}>
                  添加 MCP Servers
                </Button>
              </div>
            </div>
          </div>

          {/* 工具 - 内置 */}
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <div class="custom-agent-builtin-tools">
              <Checkbox
                checked={allGroupsEnabled()}
                onChange={(checked) =>
                  setEnabledGroups(checked === true ? new Set(TOOL_GROUPS.map((group) => group.id)) : new Set())
                }
              >
                <span style={{ "font-weight": "600" }}>工具 - 内置</span>
              </Checkbox>

              <div style={{ display: "flex", "flex-direction": "column", gap: "6px", "margin-top": "4px" }}>
                <For each={TOOL_GROUPS}>
                  {(group) => {
                    const iconName = () => {
                      switch (group.id) {
                        case "read":
                          return "📖 阅读"
                        case "edit":
                          return "📝 编辑"
                        case "shell":
                          return "💻 终端"
                        case "web":
                          return "🌐 联网搜索"
                        case "subagent":
                          return "🤖 子智能体"
                        case "todo":
                          return "📋 任务清单"
                        case "question":
                          return "❓ 提问"
                        default:
                          return group.id
                      }
                    }

                    return (
                      <div class="custom-agent-tool-item">
                        <Checkbox
                          checked={enabledGroups().has(group.id)}
                          onChange={(checked) => toggleGroup(group.id, checked === true)}
                        >
                          <span style={{ "font-size": "13px", "font-weight": "500" }}>{iconName()}</span>
                        </Checkbox>
                        <span class="custom-agent-tool-item-desc">
                          {language.t(`settings.agents.custom.tools.builtin.${group.id}.description`)}
                        </span>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>
          </div>
        </div>

        <Show when={error()}>
          <div class="custom-agent-error-banner" role="alert">
            <Icon name="circle-exclamation" size="small" />
            <span>{error()}</span>
          </div>
        </Show>
      </DialogBody>

      <DialogFooter>
        <div class="custom-agent-dialog-footer" style={{ width: "100%" }}>
          <Button variant="contrast" onClick={() => void save()} disabled={!canSave() || saving()}>
            <Show when={saving()} fallback={props.editing ? "保存" : "创建"}>
              <Loader class="custom-agent-dialog-spinner" />
            </Show>
          </Button>
          <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving() || generating()}>
            取消
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}

function selectionString(model: CustomAgentEntry["model"]): string {
  if (!model) return ""
  if (typeof model === "string") return model
  return `${model.providerID}/${model.model}${model.variant ? `#${model.variant}` : ""}`
}

function parseSelection(value: string): string | { providerID: string; model: string; variant?: string } | undefined {
  if (!value) return undefined
  const match = value.match(/^([^/#]+)\/([^#]+?)(?:#([^#]+))?$/)
  if (!match) return undefined
  const [, providerID, model, variant] = match
  if (!providerID || !model) return undefined
  return variant ? { providerID, model, variant } : { providerID, model }
}
