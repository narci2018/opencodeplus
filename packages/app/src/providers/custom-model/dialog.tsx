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
  /** When set, the dialog pre-fills fields for editing this provider. */
  editing?: CustomProviderEntry
  onSaved?: () => void
  onClose?: () => void
}

export const CustomModelDialog: Component<CustomModelDialogProps> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()

  const [protocol, setProtocol] = createSignal<CustomModelProtocol>(
    props.editing?.canonical as CustomModelProtocol ?? "openai-compatible",
  )
  const [name, setName] = createSignal(props.editing?.name ?? "")
  const [baseURL, setBaseURL] = createSignal(props.editing?.baseURL ?? "")
  const [apiKey, setApiKey] = createSignal(props.editing?.apiKey ?? "")
  const [modelID, setModelID] = createSignal(
    props.editing?.models ? Object.keys(props.editing.models)[0] ?? "" : "",
  )
  const [saving, setSaving] = createSignal(false)
  const [testing, setTesting] = createSignal(false)
  const [testResult, setTestResult] = createSignal<{ success: boolean; message: string } | undefined>(undefined)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [dialogSize, setDialogSize] = createSignal<{ width: number; height: number } | undefined>(undefined)
  const [resizing, setResizing] = createSignal(false)
  const resizeStart = { x: 0, y: 0, width: 0, height: 0 }

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

  const testConnection = async () => {
    if (testing()) return
    setTesting(true)
    setTestResult(undefined)
    try {
      const preset = PROTOCOL_PRESETS[protocol()]
      const endpointURL = baseURL().trim() || preset.defaultBaseURL || preset.baseURL
      const key = apiKey().trim()

      // Build headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (key) {
        headers.Authorization = `Bearer ${key}`
      }

      // Make a minimal request based on protocol
      let response: Response
      if (protocol() === "google") {
        // Google Gemini: use models endpoint
        response = await fetch(`${endpointURL}/models?key=${key}`, {
          method: "GET",
          headers,
        })
      } else {
        // OpenAI-compatible, Anthropic-compatible, Ollama, OpenRouter: use /models
        response = await fetch(`${endpointURL}/models`, {
          method: "GET",
          headers,
        })
      }

      if (response.ok) {
        setTestResult({ success: true, message: language.t("settings.models.custom.test.success") })
      } else {
        const text = await response.text().catch(() => "")
        setTestResult({
          success: false,
          message: `${response.status} ${response.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`,
        })
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setTestResult({ success: false, message })
    } finally {
      setTesting(false)
    }
  }

  const onResizeMouseDown = (event: MouseEvent) => {
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    const container = handle.parentElement
    if (!container) return
    resizeStart.x = event.clientX
    resizeStart.y = event.clientY
    resizeStart.width = container.offsetWidth
    resizeStart.height = container.offsetHeight
    setResizing(true)

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - resizeStart.x
      const dy = moveEvent.clientY - resizeStart.y
      setDialogSize({
        width: Math.max(480, resizeStart.width + dx),
        height: Math.max(400, resizeStart.height + dy),
      })
    }

    const onMouseUp = () => {
      setResizing(false)
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

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
    <Dialog
      size="x-large"
      variant="settings"
      preventBackdropDismiss={saving()}
      class={dialogSize() ? "custom-model-dialog-resized" : undefined}
    >
      <DialogHeader>
        <DialogTitleGroup
          title={
            props.editing
              ? language.t("settings.models.custom.edit.title")
              : language.t("settings.models.custom.title")
          }
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
        <Button variant="ghost" onClick={() => props.onClose?.()} disabled={saving() || testing()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="neutral" onClick={() => void testConnection()} disabled={!canSave() || testing()}>
          <Show when={testing()} fallback={language.t("settings.models.custom.test.button")}>
            <Loader class="custom-model-dialog-spinner" />
          </Show>
        </Button>
        <Button variant="contrast" onClick={() => void save()} disabled={!canSave() || saving()}>
          <Show when={saving()} fallback={language.t("settings.models.custom.save")}>
            <Loader class="custom-model-dialog-spinner" />
          </Show>
        </Button>
      </DialogFooter>
      <Show when={testResult()}>
        <div
          class="custom-model-dialog-test-result"
          data-success={testResult()?.success ? "" : undefined}
          role="status"
        >
          <Icon name={testResult()?.success ? "circle-check" : "circle-exclamation"} size="small" />
          <span>{testResult()?.message}</span>
        </div>
      </Show>
      <div
        class="custom-model-dialog-resize-handle"
        data-resizing={resizing() ? "" : undefined}
        onMouseDown={onResizeMouseDown}
        aria-label="Resize dialog"
      />
    </Dialog>
  )
}
