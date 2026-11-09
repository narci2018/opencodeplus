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
  BUILTIN_AGENT_TEMPLATES,
  decodeToolSelection,
  generatePrompt,
  isBuiltinAgent,
  parseGeneratedAgent,
  synthesizeAgentFromSeed,
  TOOL_GROUPS,
  type AgentTemplate,
  type CustomAgentEntry,
  type CustomAgentModel,
  type GeneratedAgent,
} from "./presets"
import "@/settings/settings.css"
import "./custom-agent.css"

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

  const [smartGeneratorOpen, setSmartGeneratorOpen] = createSignal(false)

  const canSave = createMemo(() => {
    if (!name().trim() || !effectiveId().trim() || isReservedName() || conflict()) return false
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
    void dialog.push(() => <DialogMcp directory={directory} />, () => undefined)
  }

  const openSmartGenerator = () => {
    setSmartGeneratorOpen(true)
  }

  const applyGenerated = (parsed: GeneratedAgent) => {
    if (parsed.name) setName(parsed.name)
    if (parsed.identifier) setIdentifier(parsed.identifier)
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
      const effectiveDescription =
        whenToCall().trim() || `${name().trim()}：在需要相关专长或任务时由其他智能体与用户调用。`
      const modelValue = parseSelection(model().trim()) ?? undefined
      await sdk.api.experimental.config.update({
        agent: agentPatch({
          id: effectiveId(),
          description: effectiveDescription,
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
      size="x-large"
      variant="settings"
      resizable
      maximizable
      preventBackdropDismiss={saving()}
      class="custom-agent-dialog"
      containerClass="custom-agent-dialog-container"
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
            onClick={openSmartGenerator}
          >
            ✨ 智能生成
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
                <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "margin-top": "6px" }}>
                  <For each={mcps()}>
                    {(server) => {
                      const isFailed = () => server.status.status === "failed"
                      const isConnected = () => server.status.status === "connected"
                      const [reconnecting, setReconnecting] = createSignal(false)

                      const retryConnect = async (e: MouseEvent) => {
                        e.stopPropagation()
                        setReconnecting(true)
                        try {
                          await sdk.api.experimental.mcp.connect({ server: server.name })
                          await data.location.mcp.server.sync(locationRef()).catch(() => undefined)
                          showToast({
                            variant: "success",
                            title: "重试连接",
                            description: `已向 ${server.name} 发起重新连接。`,
                          })
                        } catch (err) {
                          showToast({
                            variant: "error",
                            title: "重试连接失败",
                            description: String(err),
                          })
                        } finally {
                          setReconnecting(false)
                        }
                      }

                      return (
                        <div class="custom-agent-mcp-item-card">
                          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", width: "100%" }}>
                            <Checkbox
                              checked={enabledMcp().has(server.name)}
                              disabled={server.status.status === "pending"}
                              onChange={(checked) => toggleMcpServer(server.name, checked === true)}
                            >
                              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                                <span style={{ "font-weight": "600", "font-size": "13px" }}>{server.name}</span>
                                <Show when={server.name === "computer-use"}>
                                  <span class="custom-agent-mcp-badge">TRAE 桌面自动化工具</span>
                                </Show>
                              </div>
                            </Checkbox>
                            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                              <Show when={isConnected()}>
                                <span style={{ "font-size": "12px", color: "var(--v2-text-feedback-success, #22c55e)" }}>
                                  ● 已连接就绪
                                </span>
                              </Show>
                              <Show when={isFailed()}>
                                <span style={{ "font-size": "12px", color: "var(--v2-text-feedback-error, #ef4444)" }}>
                                  ● 连接失败
                                </span>
                                <Button size="small" variant="ghost-faint" onClick={retryConnect} disabled={reconnecting()}>
                                  <Show when={reconnecting()} fallback={<>重试连接</>}>
                                    <Loader class="custom-agent-dialog-spinner" />
                                  </Show>
                                </Button>
                              </Show>
                            </div>
                          </div>
                          <Show when={isFailed() && server.status.status === "failed" && server.status.error}>
                            <div class="custom-agent-mcp-error-hint">
                              <span>错误原因: {server.status.status === "failed" ? server.status.error : ""}</span>
                            </div>
                          </Show>
                        </div>
                      )
                    }}
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
          <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving()}>
            取消
          </Button>
        </div>
      </DialogFooter>

      {/* Internal AI Smart Generation Modal Overlay */}
      <Show when={smartGeneratorOpen()}>
        <div
          class="custom-agent-generator-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSmartGeneratorOpen(false)
          }}
        >
          <div class="custom-agent-generator-modal">
            <div class="custom-agent-generator-modal-header">
              <div class="custom-agent-generator-modal-title">
                <span>✨ AI 智能生成智能体</span>
              </div>
              <button
                type="button"
                class="custom-agent-generator-modal-close"
                onClick={() => setSmartGeneratorOpen(false)}
                title="关闭"
              >
                <Icon name="xmark" size="small" />
              </button>
            </div>
            <div class="agent-generator-body">
              <AgentGenerateForm
                configuredMcp={mcps().map((server) => server.name)}
                onApply={(generatedAgent) => {
                  applyGenerated(generatedAgent)
                  setSmartGeneratorOpen(false)
                  showToast({
                    variant: "success",
                    icon: "circle-check",
                    title: "✨ 智能体设定已自动填入",
                    description: `已为“${generatedAgent.name || "自定义智能体"}”填入名称、触发场景、完整提示词与工具权限。点击右下角“${props.editing ? "保存" : "创建"}”即可生效！`,
                  })
                }}
                onClose={() => setSmartGeneratorOpen(false)}
              />
            </div>
          </div>
        </div>
      </Show>
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

export const AgentGenerateForm: Component<{
  configuredMcp: readonly string[]
  onApply: (agent: GeneratedAgent) => void
  onClose?: () => void
}> = (props) => {
  const sdk = useServerSDK()
  const [promptInput, setPromptInput] = createSignal("")
  const [selectedTemplate, setSelectedTemplate] = createSignal<AgentTemplate | undefined>(undefined)
  const [generated, setGenerated] = createSignal<GeneratedAgent | undefined>(undefined)
  const [loading, setLoading] = createSignal(false)

  const handleSelectTemplate = (template: AgentTemplate) => {
    setSelectedTemplate(template)
    setGenerated({
      name: template.name,
      identifier: template.identifier,
      whenToCall: template.whenToCall,
      system: template.system,
      tools: template.tools,
      mcpServers: template.mcpServers,
    })
    setPromptInput(template.description)
  }

  const handleGenerate = async () => {
    const text = promptInput().trim()
    if (!text || loading()) return
    setLoading(true)
    try {
      let resultAgent: GeneratedAgent | undefined
      try {
        const res = await sdk.api.experimental.generate.text({
          prompt: generatePrompt(text, props.configuredMcp),
        })
        resultAgent = parseGeneratedAgent(res.text)
      } catch {
        // Fallback to local intelligent synthesizer
      }
      if (!resultAgent) {
        resultAgent = synthesizeAgentFromSeed(text)
      }
      setGenerated(resultAgent)
      setSelectedTemplate(undefined)
      showToast({
        variant: "success",
        title: "✨ 智能生成完成",
        description: `已为“${resultAgent.name || "新智能体"}”生成工业级设定与完整提示词。`,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = () => {
    const current = generated()
    if (current) {
      props.onApply(current)
    }
    props.onClose?.()
  }

  return (
    <>
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <label class="custom-agent-field-label">
          <span>描述需求</span>
          <span style={{ "font-size": "12px", color: "var(--v2-text-text-muted)" }}>
            （输入你的设想，或从下方直接选择工业级专家模板）
          </span>
        </label>
        <textarea
          class="agent-generator-textarea"
          placeholder="例如：一位擅长代码重构与整洁架构的架构师；或者专注于排查 OWASP 漏洞与死锁的专家..."
          value={promptInput()}
          onInput={(e) => setPromptInput(e.currentTarget.value)}
        />
        <div style={{ display: "flex", "justify-content": "flex-end" }}>
          <Button
            size="small"
            variant="contrast"
            disabled={loading() || !promptInput().trim()}
            onClick={() => void handleGenerate()}
          >
            <Show when={loading()} fallback={<>✨ 开始智能生成</>}>
              <Loader class="custom-agent-dialog-spinner" />
              <span style={{ "margin-left": "6px" }}>正在深度生成...</span>
            </Show>
          </Button>
        </div>
      </div>

      {/* 工业级专家模板 */}
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <label class="custom-agent-field-label">
          <span>精选工业级智能体模板</span>
          <span style={{ "font-size": "12px", color: "var(--v2-text-text-muted)" }}>
            （点击即可即时载入完整 Prompt 与专业调用逻辑）
          </span>
        </label>
        <div class="agent-generator-templates-grid">
          <For each={BUILTIN_AGENT_TEMPLATES}>
            {(tpl) => (
              <div
                class={`agent-generator-template-card ${selectedTemplate()?.id === tpl.id ? "active" : ""}`}
                onClick={() => handleSelectTemplate(tpl)}
              >
                <div class="agent-generator-template-header">
                  <span class="agent-generator-template-title">
                    <span>{tpl.icon}</span>
                    <span>{tpl.name}</span>
                  </span>
                  <span class="agent-generator-template-tag">{tpl.tag.split("/")[0].trim()}</span>
                </div>
                <span class="agent-generator-template-desc">{tpl.description}</span>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* 生成预览 */}
      <Show when={generated()}>
        {(res) => (
          <div class="agent-generator-preview-box">
            <div class="agent-generator-preview-title">
              <span>📋 生成预览：</span>
              <span style={{ color: "var(--v2-state-bg-accent)" }}>{res().name}</span>
              <span style={{ "font-size": "11px", color: "var(--v2-text-text-muted)" }}>({res().identifier})</span>
            </div>
            <div style={{ "font-size": "12px", color: "var(--v2-text-text-muted)" }}>
              <strong>触发场景：</strong>{res().whenToCall}
            </div>
            <div class="agent-generator-preview-prompt">{res().system}</div>
          </div>
        )}
      </Show>

      <div class="custom-agent-generator-modal-footer">
        <Button variant="ghost" onClick={props.onClose}>
          取消
        </Button>
        <Button
          variant="contrast"
          disabled={!generated()}
          onClick={handleConfirm}
        >
          应用并填入智能体
        </Button>
      </div>
    </>
  )
}

export const AgentGenerateDialog: Component<{
  configuredMcp: readonly string[]
  onApply: (agent: GeneratedAgent) => void
  onClose?: () => void
}> = (props) => {
  return (
    <Dialog
      size="x-large"
      variant="settings"
      resizable
      maximizable
      class="agent-generator-dialog"
      containerClass="agent-generator-dialog-container"
    >
      <DialogHeader>
        <div class="custom-agent-header-row">
          <div class="custom-agent-breadcrumb">
            <span>✨ AI 智能生成智能体</span>
          </div>
        </div>
      </DialogHeader>

      <DialogBody class="agent-generator-body">
        <AgentGenerateForm
          configuredMcp={props.configuredMcp}
          onApply={props.onApply}
          onClose={props.onClose}
        />
      </DialogBody>
    </Dialog>
  )
}
