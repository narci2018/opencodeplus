import { Button } from "@opencode/ui/button"
import { TextField } from "@opencode/ui/text-field"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { showToast } from "@/shell/notifications/toast"
import { createSignal, type Component, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import type { Config } from "@opencode/schema/config"
import type { CustomProviderEntry } from "@/providers/custom-model/presets"

export type ConfiguredProviderDialogProps = {
  entry: CustomProviderEntry
  onSaved?: () => void
  onClose?: () => void
}

/** Edits the editable fields of an existing config provider without rewriting its id, carrier, protocol, or disabled state. */
export const ConfiguredProviderDialog: Component<ConfiguredProviderDialogProps> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()

  const [name, setName] = createSignal(props.entry.name ?? props.entry.id)
  const [baseURL, setBaseURL] = createSignal(props.entry.baseURL ?? "")
  const [apiKey, setApiKey] = createSignal(props.entry.apiKey ?? "")
  const [modelID, setModelID] = createSignal(
    props.entry.models ? Object.keys(props.entry.models).join(", ") : "",
  )
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const save = async () => {
    if (!name().trim() || saving()) return
    setSaving(true)
    setError(undefined)
    try {
      const modelIDs = modelID().split(",").map((id) => id.trim()).filter(Boolean)
      const settings = baseURL().trim()
        ? { baseURL: baseURL().trim(), ...(apiKey().trim() ? { apiKey: apiKey().trim() } : {}) }
        : undefined
      const patch: Config.ProviderPatch = {
        id: props.entry.id,
        ...(props.entry.package !== undefined ? { package: props.entry.package } : {}),
        ...(props.entry.canonical !== undefined ? { canonical: props.entry.canonical } : {}),
        name: name().trim(),
        ...(settings ? { settings } : {}),
        ...(modelIDs.length > 0
          ? { models: Object.fromEntries(modelIDs.map((id) => [id, { name: id }])) }
          : {}),
        ...(props.entry.disabled !== undefined ? { disabled: props.entry.disabled } : {}),
      }
      await sdk.api.experimental.config.update({ provider: patch })
      data.location.provider.invalidate(undefined)
      data.location.model.invalidate(undefined)
      await Promise.all([data.location.provider.sync(), data.location.model.sync()]).catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.configured.saved.title"),
        description: language.t("settings.providers.configured.saved.description", { name: name().trim() }),
      })
      props.onSaved?.()
      props.onClose?.()
    } catch (cause) {
      const message = formatServerError(cause, language.t)
      setError(message)
      showToast({ variant: "error", title: language.t("common.requestFailed"), description: message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog size="large" variant="settings" preventBackdropDismiss={saving()} resizable maximizable>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.providers.configured.edit.title")}
          description={props.entry.id}
        />
      </DialogHeader>
      <DialogBody style={{ padding: "8px 24px 16px" }} class="settings-provider-edit-body">
        <div class="settings-provider-edit-field">
          <TextField label={language.t("settings.providers.configured.name.label")} value={name()} onChange={setName} />
        </div>
        <div class="settings-provider-edit-field">
          <TextField
            label={language.t("settings.providers.configured.baseURL.label")}
            value={baseURL()}
            onChange={setBaseURL}
            placeholder="https://api.example.com/v1"
          />
        </div>
        <div class="settings-provider-edit-field">
          <TextField
            label={language.t("settings.providers.configured.apiKey.label")}
            value={apiKey()}
            onChange={setApiKey}
          />
        </div>
        <div class="settings-provider-edit-field">
          <TextField
            label={language.t("settings.providers.configured.models.label")}
            value={modelID()}
            onChange={setModelID}
            placeholder="model-a, model-b"
          />
        </div>
        <Show when={error()}>
          <div class="settings-provider-edit-error" role="alert">
            {error()}
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={() => void save()} disabled={!name().trim() || saving()}>
          {language.t("common.save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
