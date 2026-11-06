import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Select } from "@opencode/ui/select"
import { TextField } from "@opencode/ui/text-field"
import { Loader } from "@opencode/ui/loader"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { showToast } from "@/shell/notifications/toast"
import { createMemo, createSignal, Show, type Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { agentID, agentPatch, type CustomAgentEntry, type CustomAgentMode, type CustomAgentModel } from "./presets"
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

  const [name, setName] = createSignal(props.editing?.id ?? "")
  const [description, setDescription] = createSignal(props.editing?.description ?? "")
  const [system, setSystem] = createSignal(props.editing?.system ?? "")
  const [model, setModel] = createSignal(selectionString(props.editing?.model))
  const [mode, setMode] = createSignal<CustomAgentMode>(props.editing?.mode ?? "primary")
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const editing = createMemo(() => props.existing.find((entry) => entry.id === agentID(name())))

  const canSave = createMemo(() => {
    if (!agentID(name())) return false
    if (!name().trim()) return false
    return true
  })

  const save = async () => {
    if (!canSave() || saving()) return
    setSaving(true)
    setError(undefined)
    try {
      const modelValue = parseSelection(model().trim()) ?? undefined
      await sdk.api.experimental.config.update({
        agent: agentPatch({
          id: agentID(name()),
          description: description(),
          system: system(),
          model: modelValue as CustomAgentModel | undefined,
          mode: mode(),
        }),
      })
      // The config write reloads the server, so refresh the agent catalog.
      data.location.agent.invalidate(undefined)
      await data.location.agent.sync().catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.agents.custom.saved.title"),
        description: language.t("settings.agents.custom.saved.description", { name: name().trim() }),
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

  const modeOptions = createMemo(() => [
    { id: "primary" as const, label: language.t("settings.agents.custom.mode.primary") },
    { id: "all" as const, label: language.t("settings.agents.custom.mode.all") },
    { id: "subagent" as const, label: language.t("settings.agents.custom.mode.subagent") },
  ])

  return (
    <Dialog size="x-large" variant="settings" preventBackdropDismiss={saving()} class="custom-agent-dialog">
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
          <Show when={editing()}>
            <span class="custom-agent-dialog-hint">{language.t("settings.agents.custom.editing")}</span>
          </Show>
        </div>

        <div class="custom-agent-dialog-field">
          <TextField
            label={language.t("settings.agents.custom.description.label")}
            value={description()}
            onChange={(value) => {
              setDescription(value)
              setError(undefined)
            }}
            placeholder={language.t("settings.agents.custom.description.placeholder")}
          />
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
            rows={7}
          />
        </div>

        <div class="custom-agent-dialog-field">
          <TextField
            label={language.t("settings.agents.custom.model.label")}
            value={model()}
            onChange={(value) => {
              setModel(value)
              setError(undefined)
            }}
            placeholder={language.t("settings.agents.custom.model.placeholder")}
          />
        </div>

        <div class="custom-agent-dialog-field">
          <label class="custom-agent-dialog-label" for="custom-agent-mode">
            {language.t("settings.agents.custom.mode.label")}
          </label>
          <Select
            id="custom-agent-mode"
            options={modeOptions()}
            value={(item) => item.id}
            label={(item) => item.label}
            current={modeOptions().find((item) => item.id === mode())}
            onSelect={(item) => setMode(item?.id ?? "primary")}
            valueClass="truncate"
          />
        </div>

        <Show when={error()}>
          <div class="custom-agent-dialog-error" role="alert">
            <Icon name="circle-exclamation" size="small" />
            <span>{error()}</span>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving()}>
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
