import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Select } from "@opencode/ui/select"
import { TextField } from "@opencode/ui/text-field"
import { Loader } from "@opencode/ui/loader"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { showToast } from "@/shell/notifications/toast"
import { createMemo, createSignal, For, Show, type Component } from "solid-js"
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
  const dialog = useDialog()

  const [protocol, setProtocol] = createSignal<CustomModelProtocol>(
    props.editing?.canonical as CustomModelProtocol ?? "openai-compatible",
  )
  const [name, setName] = createSignal(props.editing?.name ?? "")
  const [baseURL, setBaseURL] = createSignal(props.editing?.baseURL ?? "")
  const [apiKey, setApiKey] = createSignal(props.editing?.apiKey ?? "")
  const [modelID, setModelID] = createSignal(
    props.editing?.models ? Object.keys(props.editing.models).join(", ") : "",
  )
  const [saving, setSaving] = createSignal(false)
  const [testing, setTesting] = createSignal(false)
  const [testResult, setTestResult] = createSignal<{ success: boolean; message: string } | undefined>(undefined)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [fetchingModels, setFetchingModels] = createSignal(false)
  const [fetchError, setFetchError] = createSignal<string | undefined>(undefined)

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

  const canFetchModels = createMemo(() => {
    const p = preset()
    if (p.apiKey === "required" && !apiKey().trim()) return false
    if (p.editableBaseURL && !baseURL().trim()) return false
    return true
  })

  /** Resolves the models-list URL and auth headers for the current protocol. */
  const modelsEndpoint = () => {
    const p = preset()
    const endpointURL = baseURL().trim() || p.defaultBaseURL || p.baseURL
    const key = apiKey().trim()
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    let url: string
    if (protocol() === "google") {
      url = `${endpointURL}/models?key=${encodeURIComponent(key)}`
    } else {
      url = `${endpointURL}/models`
      if (protocol() === "anthropic-compatible") {
        if (key) headers["x-api-key"] = key
        headers["anthropic-version"] = "2023-06-01"
      } else if (key) {
        headers.Authorization = `Bearer ${key}`
      }
    }
    return { url, headers }
  }

  /** Extracts model ids from a protocol-specific models-list response body. */
  const parseModelIDs = (protocol: CustomModelProtocol, body: string): string[] => {
    const json = JSON.parse(body) as Record<string, unknown>
    if (protocol === "google") {
      const models = Array.isArray(json.models) ? json.models : []
      return models
        .map((m) => (typeof m === "object" && m !== null && typeof (m as Record<string, unknown>).name === "string"
          ? ((m as Record<string, string>).name as string).replace(/^models\//, "")
          : ""))
        .filter(Boolean)
    }
    const data = Array.isArray(json.data) ? json.data : []
    return data
      .map((m) => (typeof m === "object" && m !== null && typeof (m as Record<string, string>).id === "string" ? (m as Record<string, string>).id : ""))
      .filter(Boolean)
  }

  const fetchModels = async () => {
    if (fetchingModels() || !canFetchModels()) return
    setFetchingModels(true)
    setFetchError(undefined)
    try {
      const { url, headers } = modelsEndpoint()
      const result = await sdk.api.experimental.network.proxy({ url, method: "GET", headers })
      if (result.status < 200 || result.status >= 300) {
        const body = result.body.slice(0, 200)
        setFetchError(`${result.status} ${result.statusText}${body ? `: ${body}` : ""}`)
        return
      }
      const ids = parseModelIDs(protocol(), result.body)
      if (ids.length === 0) {
        setFetchError(language.t("settings.models.custom.fetch.empty"))
        return
      }
      const sorted = ids.toSorted((a, b) => a.localeCompare(b))
      void dialog.show(
        () => (
          <ModelPickerDialog
            models={sorted}
            selected={modelID()}
            onApply={(ids) => setModelID(ids.join(", "))}
            onClose={() => dialog.close()}
          />
        ),
        () => undefined,
      )
    } catch (cause) {
      setFetchError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setFetchingModels(false)
    }
  }

  const testConnection = async () => {
    if (testing()) return
    setTesting(true)
    setTestResult(undefined)
    try {
      const preset = PROTOCOL_PRESETS[protocol()]
      const endpointURL = baseURL().trim() || preset.defaultBaseURL || preset.baseURL
      const key = apiKey().trim()

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (key) {
        headers.Authorization = `Bearer ${key}`
      }

      const modelsURL = protocol() === "google" ? `${endpointURL}/models?key=${key}` : `${endpointURL}/models`

      const result = await sdk.api.experimental.network.proxy({
        url: modelsURL,
        method: "GET",
        headers,
      })

      if (result.status >= 200 && result.status < 300) {
        setTestResult({ success: true, message: language.t("settings.models.custom.test.success") })
      } else {
        const body = result.body.slice(0, 200)
        setTestResult({
          success: false,
          message: `${result.status} ${result.statusText}${body ? `: ${body}` : ""}`,
        })
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setTestResult({ success: false, message })
    } finally {
      setTesting(false)
    }
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
    <Dialog size="x-large" variant="settings" preventBackdropDismiss={saving()} resizable maximizable>
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
      <DialogBody class="custom-model-dialog-body" style={{ padding: "8px 24px 16px" }}>
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
          <div class="custom-model-dialog-label-row">
            <label class="custom-model-dialog-label" for="custom-model-modelID">
              {language.t("settings.models.custom.modelID.label")}
            </label>
            <Button
              size="small"
              variant="ghost-muted"
              onClick={() => void fetchModels()}
              disabled={fetchingModels() || !canFetchModels()}
            >
              <Show when={fetchingModels()} fallback={language.t("settings.models.custom.fetch.button")}>
                <Loader class="custom-model-dialog-spinner" />
              </Show>
            </Button>
          </div>
          <TextField
            id="custom-model-modelID"
            value={modelID()}
            onChange={(value) => {
              setModelID(value)
              setError(undefined)
            }}
            placeholder={preset().modelIDPlaceholder}
          />
          <Show when={fetchError()}>
            <span class="custom-model-dialog-hint custom-model-dialog-fetch-error">{fetchError()}</span>
          </Show>
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
    </Dialog>
  )
}

function ModelPickerDialog(props: {
  models: string[]
  selected: string
  onApply: (ids: string[]) => void
  onClose?: () => void
}) {
  const language = useLanguage()
  const [query, setQuery] = createSignal("")
  const initialSelected = new Set(props.selected.split(",").map((id) => id.trim()).filter(Boolean))
  const [checked, setChecked] = createSignal<Set<string>>(
    new Set(props.models.filter((model) => initialSelected.has(model))),
  )

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return props.models
    return props.models.filter((model) => model.toLowerCase().includes(q))
  })

  const toggle = (model: string, on: boolean) => {
    setChecked((current) => {
      const next = new Set(current)
      if (on) next.add(model)
      else next.delete(model)
      return next
    })
  }

  const allVisibleChecked = createMemo(() => {
    const list = filtered()
    return list.length > 0 && list.every((model) => checked().has(model))
  })

  const toggleAllVisible = () => {
    const target = !allVisibleChecked()
    setChecked((current) => {
      const next = new Set(current)
      for (const model of filtered()) {
        if (target) next.add(model)
        else next.delete(model)
      }
      return next
    })
  }

  const apply = () => {
    props.onApply?.([...checked()])
    props.onClose?.()
  }

  return (
    <Dialog size="large" variant="settings" resizable maximizable>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.models.custom.fetch.picker.title")}
          description={language.t("settings.models.custom.fetch.count", { count: String(props.models.length) })}
        />
      </DialogHeader>
      <DialogBody class="custom-model-picker-body">
        <TextField
          value={query()}
          onChange={setQuery}
          placeholder={language.t("settings.models.custom.fetch.search.placeholder")}
        />
        <div class="custom-model-picker-actions">
          <Button size="small" variant="ghost-muted" onClick={toggleAllVisible}>
            {allVisibleChecked()
              ? language.t("settings.models.custom.fetch.clearVisible")
              : language.t("settings.models.custom.fetch.selectAll")}
          </Button>
        </div>
        <div class="custom-model-picker-list">
          <For each={filtered()}>
            {(model) => (
              <label class="custom-model-picker-item">
                <input
                  type="checkbox"
                  checked={checked().has(model)}
                  onChange={(event) => toggle(model, event.currentTarget.checked)}
                />
                <span class="custom-model-picker-name">{model}</span>
              </label>
            )}
          </For>
          <Show when={filtered().length === 0}>
            <div class="custom-model-picker-empty">{language.t("settings.models.custom.fetch.search.empty")}</div>
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onClose?.()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" onClick={apply}>
          {language.t("settings.models.custom.fetch.apply")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
