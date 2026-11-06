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
import {
  PROTOCOL_IDS,
  PROTOCOL_PRESETS,
  providerID,
  providerPatch,
  type CustomModelProtocol,
  type CustomProviderEntry,
} from "./presets"
import "@/settings/settings.css"
import "./custom-model.css"

export type CustomModelDialogProps = {
  /** Custom providers already present in the config, for editing and listing. */
  existing: CustomProviderEntry[]
  onSaved?: () => void
  onClose?: () => void
}

export const CustomModelDialog: Component<CustomModelDialogProps> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()

  const [protocol, setProtocol] = createSignal<CustomModelProtocol>("openai-compatible")
  const [name, setName] = createSignal("")
  const [baseURL, setBaseURL] = createSignal("")
  const [apiKey, setApiKey] = createSignal("")
  const [modelID, setModelID] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const preset = createMemo(() => PROTOCOL_PRESETS[protocol()])
  const editing = createMemo(() => props.existing.find((entry) => entry.id === providerID(name())))

  const selectProtocol = (value: CustomModelProtocol | null) => {
    if (!value) return
    setProtocol(value)
    setError(undefined)
    const next = PROTOCOL_PRESETS[value]
    if (next.defaultBaseURL) setBaseURL(next.defaultBaseURL)
    else if (!next.editableBaseURL) setBaseURL(next.baseURL)
  }

  const canSave = createMemo(() => {
    const id = providerID(name())
    if (!id || !modelID().trim()) return false
    const p = preset()
    if (p.apiKey === "required" && !apiKey().trim()) return false
    if (p.editableBaseURL && !baseURL().trim()) return false
    return true
  })

  const save = async () => {
    if (!canSave() || saving()) return
    setSaving(true)
    setError(undefined)
    try {
      await sdk.api.experimental.config.update({
        provider: providerPatch({
          id: providerID(name()),
          name: name(),
          protocol: protocol(),
          baseURL: baseURL(),
          apiKey: apiKey(),
          modelID: modelID(),
        }),
      })
      // The config write reloads the server, so refresh the provider and model catalogs.
      data.location.provider.invalidate(undefined)
      data.location.model.invalidate(undefined)
      await Promise.all([data.location.provider.sync(), data.location.model.sync()]).catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.models.custom.saved.title"),
        description: language.t("settings.models.custom.saved.description", { name: name().trim() }),
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

  const protocolOptions = createMemo(() =>
    PROTOCOL_IDS.map((id) => ({ id, label: language.t(PROTOCOL_PRESETS[id].labelKey) })),
  )

  return (
    <Dialog size="large" variant="settings" preventBackdropDismiss={saving()}>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.models.custom.title")}
          description={language.t("settings.models.custom.description")}
        />
      </DialogHeader>
      <DialogBody class="custom-model-dialog-body">
        <div class="custom-model-dialog-field">
          <label class="custom-model-dialog-label" for="custom-model-protocol">
            {language.t("settings.models.custom.protocol.label")}
          </label>
          <Select
            id="custom-model-protocol"
            options={protocolOptions()}
            value={(item) => item.id}
            label={(item) => item.label}
            current={protocolOptions().find((item) => item.id === protocol())}
            onSelect={(item) => selectProtocol(item?.id ?? null)}
            placeholder={language.t("settings.models.custom.protocol.label")}
            valueClass="truncate"
          />
        </div>

        <div class="custom-model-dialog-field">
          <TextField
            label={language.t("settings.models.custom.name.label")}
            value={name()}
            onChange={(value) => {
              setName(value)
              setError(undefined)
            }}
            placeholder={language.t("settings.models.custom.name.placeholder")}
            autofocus
          />
          <Show when={editing()}>
            <span class="custom-model-dialog-hint">{language.t("settings.models.custom.editing")}</span>
          </Show>
        </div>

        <div class="custom-model-dialog-field">
          <TextField
            label={language.t("settings.models.custom.baseURL.label")}
            value={baseURL()}
            onChange={(value) => {
              setBaseURL(value)
              setError(undefined)
            }}
            placeholder={preset().baseURL}
            disabled={!preset().editableBaseURL}
          />
          <Show when={!preset().editableBaseURL}>
            <span class="custom-model-dialog-hint">{language.t("settings.models.custom.baseURL.fixed")}</span>
          </Show>
        </div>

        <Show when={preset().apiKey !== "none"}>
          <div class="custom-model-dialog-field">
            <TextField
              label={language.t("settings.models.custom.apiKey.label")}
              value={apiKey()}
              onChange={(value) => {
                setApiKey(value)
                setError(undefined)
              }}
              placeholder={language.t("settings.models.custom.apiKey.placeholder")}
              type="password"
              copyable
            />
          </div>
        </Show>

        <div class="custom-model-dialog-field">
          <TextField
            label={language.t("settings.models.custom.modelID.label")}
            value={modelID()}
            onChange={(value) => {
              setModelID(value)
              setError(undefined)
            }}
            placeholder={preset().modelIDPlaceholder}
          />
        </div>

        <Show when={error()}>
          <div class="custom-model-dialog-error" role="alert">
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
          <Show when={saving()} fallback={language.t("settings.models.custom.save")}>
            <Loader class="custom-model-dialog-spinner" />
          </Show>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
