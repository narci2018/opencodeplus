import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { Icon } from "@opencode/ui/icon"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { TextField } from "@opencode/ui/text-field"
import { Loader } from "@opencode/ui/loader"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
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

  const [brief, setBrief] = createSignal("")
  const [name, setName] = createSignal(props.editing?.id ?? "")
  const [callable, setCallable] = createSignal(props.editing ? props.editing.mode !== "primary" : true)
  const [whenToCall, setWhenToCall] = createSignal(props.editing?.description ?? "")
  const [system, setSystem] = createSignal(props.editing?.system ?? "")
  const [model, setModel] = createSignal(selectionString(props.editing?.model))
  const [enabledGroups, setEnabledGroups] = createSignal(
    decodeToolSelection({ permissions: props.editing?.permissions, configuredMcp: [] }).groups,
  )
  const [enabledMcp, setEnabledMcp] = createSignal(new Set<string>())
  const [saving, setSaving] = createSignal(false)
  const [generating, setGenerating] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const editing = createMemo(() => props.existing.find((entry) => entry.id === agentID(name())))

  // MCP connections are per Location, as the extensions page does; the names come from the default Location.
  const locationRef = () => data.location.default()
  createEffect(() => {
    if (sdk.connection.status() !== "connected") return
    void data.location.mcp.server.sync(locationRef()).catch(() => undefined)
  })
  const mcps = createMemo(() =>
    (data.location.mcp.server.list(locationRef()) ?? []).toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  // The model picker lists the provider catalogs; the settings shell may not have loaded them yet.
  createEffect(() => {
    if (sdk.connection.status() !== "connected") return
    const ref = data.location.default()
    void Promise.all([data.location.provider.sync(ref), data.location.model.sync(ref)]).catch(() => undefined)
  })

  // Seed the MCP selection from the stored rules once the server list is known, so editing starts
  // from what the agent already has instead of clobbering it with the form default.
  const [mcpSeeded, setMcpSeeded] = createSignal(false)
  createEffect(() => {
    if (mcpSeeded()) return
    const names = mcps().map((server) => server.name)
    if (names.length === 0) return
    setMcpSeeded(true)
    setEnabledMcp(decodeToolSelection({ permissions: props.editing?.permissions, configuredMcp: names }).mcp)
  })

  const isReservedName = createMemo(() => isBuiltinAgent(agentID(name())))

  const canSave = createMemo(() => {
    if (!name().trim() || isReservedName()) return false
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
    // Stacks on top of this dialog, so the form state survives adding a server.
    const directory = data.location.default().directory
    void dialog.show(() => <DialogMcp directory={directory} />, () => undefined)
  }

  const generate = async () => {
    const description = brief().trim()
    if (generating() || !description) return
    setGenerating(true)
    setError(undefined)
    try {
      const result = await sdk.api.experimental.generate.text({
        prompt: generatePrompt(description, mcps().map((server) => server.name)),
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
    if (parsed.name) setName(parsed.name)
    if (parsed.whenToCall) {
      setCallable(true)
      setWhenToCall(parsed.whenToCall)
    }
    if (parsed.system) setSystem(parsed.system)
    // Only a non-empty tool list rewrites the selection: an empty one would disable everything.
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
          id: agentID(name()),
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
      // The config write reloads the server, so refresh the agent catalog.
      data.location.agent.invalidate(undefined)
      await data.location.agent.sync().catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.agents.custom.saved.title"),
        description: language.t("settings.agents.custom.saved.description", { name: agentID(name()) }),
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

  const modelOptions = createMemo(() => {
    const ref = locationRef()
    const providerList = data.location.provider.list(ref)
    const modelList = data.location.model.list(ref) ?? []
    if (!providerList) return []
    const names = new Map(providerList.map((provider) => [provider.id, provider.name]))
    return modelList
      .filter((model) => model.enabled && model.status !== "deprecated")
      .map((model) => ({
        id: `${model.providerID}/${model.modelID}`,
        label: model.name || model.modelID,
        group: names.get(model.providerID) ?? model.providerID,
      }))
      .toSorted((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
  })

  return (
    <Dialog
      size="x-large"
      variant="settings"
      preventBackdropDismiss={saving() || generating()}
      resizable
      maximizable
      class="custom-agent-dialog"
    >
      <DialogHeader>
        <DialogTitleGroup
          title={
            props.editing
              ? language.t("settings.agents.custom.edit.title")
              : language.t("settings.agents.custom.title")
          }
          description={language.t("settings.agents.custom.description")}
        />
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        <div class="custom-agent-dialog-field">
          <div class="custom-agent-dialog-label-row">
            <label class="custom-agent-dialog-label" for="custom-agent-brief">
              {language.t("settings.agents.custom.brief.label")}
            </label>
            <Button
              size="small"
              variant="ghost-muted"
              onClick={() => void generate()}
              disabled={generating() || !brief().trim()}
            >
              <Show when={generating()} fallback={language.t("settings.agents.custom.generate")}>
                <Loader class="custom-agent-dialog-spinner" />
              </Show>
            </Button>
          </div>
          <textarea
            id="custom-agent-brief"
            class="custom-agent-dialog-textarea"
            value={brief()}
            maxlength={10000}
            onChange={(event) => setBrief(event.currentTarget.value)}
            placeholder={language.t("settings.agents.custom.brief.placeholder")}
            rows={3}
          />
          <span class="custom-agent-dialog-counter">{brief().length}/10000</span>
        </div>

        <div class="custom-agent-dialog-field">
          <TextField
            label={language.t("settings.agents.custom.name.label")}
            value={name()}
            onChange={(value) => {
              setName(value)
              setError(undefined)
            }}
            placeholder={language.t("settings.agents.custom.name.placeholder")}
            autofocus
          />
          <span class="custom-agent-dialog-hint">
            {language.t(
              callable() ? "settings.agents.custom.identifier.hint" : "settings.agents.custom.identifier.off",
              { id: agentID(name()) },
            )}
          </span>
          <Show when={isReservedName()}>
            <span class="text-11-regular text-v2-text-error">
              该名称为内置原生智能体保留标识（build / plan / trae / trae-bao），不能用于自定义智能体。
            </span>
          </Show>
          <Show when={editing()}>
            <span class="custom-agent-dialog-hint">{language.t("settings.agents.custom.editing")}</span>
          </Show>
        </div>

        <div class="custom-agent-dialog-card">
          <Switch
            checked={callable()}
            onChange={(checked) => setCallable(checked === true)}
            description={language.t("settings.agents.custom.callable.description")}
          >
            {language.t("settings.agents.custom.callable.title")}
          </Switch>
          <Show when={callable()}>
            <div class="custom-agent-dialog-field">
              <label class="custom-agent-dialog-label" for="custom-agent-when">
                {language.t("settings.agents.custom.whenToCall.label")}
              </label>
              <textarea
                id="custom-agent-when"
                class="custom-agent-dialog-textarea"
                value={whenToCall()}
                maxlength={5000}
                onChange={(event) => setWhenToCall(event.currentTarget.value)}
                placeholder={language.t("settings.agents.custom.whenToCall.placeholder")}
                rows={3}
              />
              <span class="custom-agent-dialog-counter">{whenToCall().length}/5000</span>
            </div>
          </Show>
        </div>

        <div class="custom-agent-dialog-field">
          <label class="custom-agent-dialog-label" for="custom-agent-system">
            {language.t("settings.agents.custom.system.label")}
          </label>
          <textarea
            id="custom-agent-system"
            class="custom-agent-dialog-textarea"
            value={system()}
            onChange={(event) => {
              setSystem(event.currentTarget.value)
              setError(undefined)
            }}
            placeholder={language.t("settings.agents.custom.system.placeholder")}
            rows={6}
          />
        </div>

        <div class="custom-agent-dialog-field">
          <label class="custom-agent-dialog-label" for="custom-agent-model">
            {language.t("settings.agents.custom.model.label")}
          </label>
          <Select
            id="custom-agent-model"
            options={modelOptions()}
            value={(item) => item.id}
            label={(item) => item.label}
            groupBy={(item) => item.group}
            current={modelOptions().find((item) => item.id === model())}
            onSelect={(item) => setModel(item?.id ?? "")}
            placeholder={language.t("settings.agents.custom.model.default")}
            valueClass="truncate"
          />
        </div>

        <div class="custom-agent-dialog-card">
          <span class="custom-agent-dialog-card-title">{language.t("settings.agents.custom.tools.title")}</span>

          <div class="custom-agent-dialog-card-section">
            <span class="custom-agent-dialog-card-subtitle">{language.t("settings.agents.custom.tools.mcp")}</span>
            <Show
              when={mcps().length > 0}
              fallback={
                <div class="custom-agent-dialog-mcp-empty">
                  <p class="custom-agent-dialog-mcp-explain">{language.t("settings.agents.custom.tools.mcp.explain")}</p>
                  <Button size="small" variant="ghost-muted" icon="plus" onClick={addMcpServer}>
                    {language.t("settings.agents.custom.tools.mcp.add")}
                  </Button>
                </div>
              }
            >
              <div class="custom-agent-dialog-tools">
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
              <Button size="small" variant="ghost-muted" icon="plus" onClick={addMcpServer}>
                {language.t("settings.agents.custom.tools.mcp.add")}
              </Button>
            </Show>
          </div>

          <div class="custom-agent-dialog-card-section">
            <Checkbox
              checked={allGroupsEnabled()}
              onChange={(checked) =>
                setEnabledGroups(checked === true ? new Set(TOOL_GROUPS.map((group) => group.id)) : new Set())
              }
            >
              {language.t("settings.agents.custom.tools.builtin")}
            </Checkbox>
            <div class="custom-agent-dialog-tools">
              <For each={TOOL_GROUPS}>
                {(group) => (
                  <Checkbox
                    checked={enabledGroups().has(group.id)}
                    description={language.t(`settings.agents.custom.tools.builtin.${group.id}.description`)}
                    onChange={(checked) => toggleGroup(group.id, checked === true)}
                  >
                    {language.t(`settings.agents.custom.tools.builtin.${group.id}`)}
                  </Checkbox>
                )}
              </For>
            </div>
          </div>
        </div>

        <Show when={error()}>
          <div class="custom-agent-dialog-error" role="alert">
            <Icon name="circle-exclamation" size="small" />
            <span>{error()}</span>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving() || generating()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={() => void save()} disabled={!canSave() || saving()}>
          <Show when={saving()} fallback={language.t("settings.agents.custom.save")}>
            <Loader class="custom-agent-dialog-spinner" />
          </Show>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Renders a stored model selection as the free-text field value. */
function selectionString(model: CustomAgentEntry["model"]): string {
  if (!model) return ""
  if (typeof model === "string") return model
  return `${model.providerID}/${model.model}${model.variant ? `#${model.variant}` : ""}`
}

/** Parses `provider/model` (optionally `provider/model#variant`) into a config model selection. */
function parseSelection(value: string): string | { providerID: string; model: string; variant?: string } | undefined {
  if (!value) return undefined
  const match = value.match(/^([^/#]+)\/([^#]+?)(?:#([^#]+))?$/)
  if (!match) return undefined
  const [, providerID, model, variant] = match
  if (!providerID || !model) return undefined
  return variant ? { providerID, model, variant } : { providerID, model }
}
