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
import { formatServerError } from "@/runtime/server/errors"
import { useData } from "@/runtime/server/current"

/** The structural config shape the extension dialogs read; the SDK and schema entries satisfy it. */
type ConfigEntryLike = {
  type: string
  info?: {
    mcp?: { servers?: Record<string, unknown> }
    plugins?: unknown
    skills?: unknown
  }
}

export type ExtensionConfig = {
  mcpServers: Record<string, Record<string, unknown>>
  plugins: string[]
  skills: string[]
}

/** The highest-precedence config document is the one `config.update` writes, so manage what it holds. */
export function readExtensionConfig(entries: readonly ConfigEntryLike[]): ExtensionConfig {
  const document = [...entries].reverse().find((entry) => entry.type === "document")
  const info = document && document.type === "document" ? document.info : undefined
  const servers = info?.mcp?.servers ?? {}
  const plugins = Array.isArray(info?.plugins) ? info.plugins.filter((entry): entry is string => typeof entry === "string") : []
  const skills = Array.isArray(info?.skills) ? info.skills.filter((entry): entry is string => typeof entry === "string") : []
  return {
    mcpServers: Object.fromEntries(
      Object.entries(servers).filter((entry): entry is [string, Record<string, unknown>] => typeof entry[1] === "object" && entry[1] !== null),
    ),
    plugins,
    skills,
  }
}

/** "KEY=VALUE" lines to a record; blank lines and lines without a separator are skipped. */
const parseAssignments = (value: string, separator: string): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const line of value.split("\n")) {
    const index = line.indexOf(separator)
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    const item = line.slice(index + separator.length).trim()
    if (key) result[key] = item
  }
  return result
}

/** A record back to "KEY=VALUE" (or "KEY: VALUE") lines for the edit form. */
const formatAssignments = (record: Record<string, string> | undefined, separator: string) =>
  Object.entries(record ?? {})
    .map(([key, item]) => `${key}${separator}${item}`)
    .join("\n")

export type McpServerConfigLike = {
  type: "local" | "remote"
  command?: string[]
  url?: string
  environment?: Record<string, string>
  headers?: Record<string, string>
}

export const McpServerDialog: Component<{
  /** Existing config servers, for the edit-mode conflict check. */
  existing: ExtensionConfig
  /** When set, the dialog pre-fills and edits this server; otherwise it creates one. */
  editing?: { name: string; config: McpServerConfigLike }
  onSaved?: () => void
  onClose?: () => void
}> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()

  const [name, setName] = createSignal(props.editing?.name ?? "")
  const [type, setType] = createSignal<"local" | "remote">(props.editing?.config.type ?? "local")
  const [command, setCommand] = createSignal((props.editing?.config.command ?? []).join(" "))
  const [environment, setEnvironment] = createSignal(formatAssignments(props.editing?.config.environment, "="))
  const [url, setUrl] = createSignal(props.editing?.config.url ?? "")
  const [headers, setHeaders] = createSignal(formatAssignments(props.editing?.config.headers, ": "))
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const canSave = createMemo(() => {
    if (!name().trim()) return false
    if (type() === "local") return command().trim().length > 0
    return url().trim().length > 0
  })

  const buildConfig = () => {
    if (type() === "local")
      return {
        type: "local" as const,
        command: command().trim().split(/\s+/).filter(Boolean),
        ...(environment().trim() ? { environment: parseAssignments(environment(), "=") } : {}),
      }
    return {
      type: "remote" as const,
      url: url().trim(),
      ...(headers().trim() ? { headers: parseAssignments(headers(), ": ") } : {}),
    }
  }

  const refresh = async () => {
    data.location.mcp.server.invalidate(undefined)
    await data.location.mcp.server.sync().catch(() => undefined)
  }

  const save = async () => {
    if (!canSave() || saving()) return
    setSaving(true)
    setError(undefined)
    try {
      await sdk.api.experimental.config.update({ mcp: { name: name().trim(), config: buildConfig() } })
      await refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.saved.title"),
        description: language.t("settings.extensions.saved.description", { name: name().trim() }),
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

  const remove = async () => {
    if (saving() || !props.editing) return
    setSaving(true)
    setError(undefined)
    try {
      await sdk.api.experimental.config.update({ mcp: { name: props.editing.name, remove: true } })
      await refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.removed.title"),
        description: language.t("settings.extensions.removed.description", { name: props.editing.name }),
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

  const typeOptions = createMemo(() => [
    { id: "local" as const, label: language.t("settings.extensions.mcp.type.local") },
    { id: "remote" as const, label: language.t("settings.extensions.mcp.type.remote") },
  ])

  return (
    <Dialog size="large" variant="settings" preventBackdropDismiss={saving()}>
      <DialogHeader>
        <DialogTitleGroup
          title={
            props.editing
              ? language.t("settings.extensions.mcp.edit.title")
              : language.t("settings.extensions.mcp.add.title")
          }
          description={language.t("settings.extensions.mcp.description")}
        />
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        <div class="custom-agent-dialog-field">
          <TextField
            label={language.t("settings.extensions.mcp.name.label")}
            value={name()}
            onChange={(value) => {
              setName(value)
              setError(undefined)
            }}
            placeholder={language.t("settings.extensions.mcp.name.placeholder")}
            autofocus
          />
        </div>

        <div class="custom-agent-dialog-field">
          <label class="custom-agent-dialog-label" for="extension-mcp-type">
            {language.t("settings.extensions.mcp.type.label")}
          </label>
          <Select
            id="extension-mcp-type"
            options={typeOptions()}
            value={(item) => item.id}
            label={(item) => item.label}
            current={typeOptions().find((item) => item.id === type())}
            onSelect={(item) => setType(item?.id ?? "local")}
            valueClass="truncate"
          />
        </div>

        <Show
          when={type() === "local"}
          fallback={
            <>
              <div class="custom-agent-dialog-field">
                <TextField
                  label={language.t("settings.extensions.mcp.url.label")}
                  value={url()}
                  onChange={(value) => {
                    setUrl(value)
                    setError(undefined)
                  }}
                  placeholder="https://mcp.example.com"
                />
              </div>
              <div class="custom-agent-dialog-field">
                <TextField
                  label={language.t("settings.extensions.mcp.headers.label")}
                  value={headers()}
                  onChange={(value) => setHeaders(value)}
                  placeholder={language.t("settings.extensions.mcp.headers.placeholder")}
                />
              </div>
            </>
          }
        >
          <div class="custom-agent-dialog-field">
            <TextField
              label={language.t("settings.extensions.mcp.command.label")}
              value={command()}
              onChange={(value) => {
                setCommand(value)
                setError(undefined)
              }}
              placeholder={language.t("settings.extensions.mcp.command.placeholder")}
            />
            <span class="custom-agent-dialog-hint">{language.t("settings.extensions.mcp.command.hint")}</span>
          </div>
          <div class="custom-agent-dialog-field">
            <TextField
              label={language.t("settings.extensions.mcp.env.label")}
              value={environment()}
              onChange={(value) => setEnvironment(value)}
              placeholder={language.t("settings.extensions.mcp.env.placeholder")}
            />
          </div>
        </Show>

        <Show when={error()}>
          <div class="custom-agent-dialog-error" role="alert">
            <Icon name="circle-exclamation" size="small" />
            <span>{error()}</span>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "flex-end", gap: "10px", width: "100%" }}>
          <Show when={props.editing}>
            <Button variant="danger" onClick={() => void remove()} disabled={saving()} style={{ "margin-right": "auto", "min-width": "64px" }}>
              {language.t("common.delete") ?? "删除"}
            </Button>
          </Show>
          <Button variant="neutral" onClick={() => props.onClose?.()} disabled={saving()} style={{ "min-width": "64px" }}>
            {language.t("common.cancel") ?? "取消"}
          </Button>
          <Button variant="contrast" onClick={() => void save()} disabled={!canSave() || saving()} style={{ "min-width": "64px" }}>
            <Show when={saving()} fallback={props.editing ? (language.t("common.save") ?? "保存") : (language.t("ui.common.confirm") ?? "确认")}>
              <Loader class="custom-agent-dialog-spinner" />
            </Show>
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}

/** A one-field add dialog shared by the plugins and skills sections. */
const SourceAddDialog: Component<{
  title: string
  description: string
  label: string
  placeholder: string
  hint?: string
  save: (value: string) => Promise<void>
  onClose?: () => void
}> = (props) => {
  const language = useLanguage()
  const [value, setValue] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const save = async () => {
    if (saving() || !value().trim()) return
    setSaving(true)
    setError(undefined)
    try {
      await props.save(value().trim())
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
    <Dialog size="large" variant="settings" preventBackdropDismiss={saving()}>
      <DialogHeader>
        <DialogTitleGroup title={props.title} description={props.description} />
      </DialogHeader>
      <DialogBody class="custom-agent-dialog-body" style={{ padding: "8px 24px 16px" }}>
        <div class="custom-agent-dialog-field">
          <TextField
            label={props.label}
            value={value()}
            onChange={(next) => {
              setValue(next)
              setError(undefined)
            }}
            placeholder={props.placeholder}
            autofocus
          />
          <Show when={props.hint}>
            <span class="custom-agent-dialog-hint">{props.hint}</span>
          </Show>
        </div>
        <Show when={error()}>
          <div class="custom-agent-dialog-error" role="alert">
            <Icon name="circle-exclamation" size="small" />
            <span>{error()}</span>
          </div>
        </Show>
      </DialogBody>
      <DialogFooter>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "flex-end", gap: "10px", width: "100%" }}>
          <Button variant="neutral" onClick={() => props.onClose?.()} disabled={saving()} style={{ "min-width": "64px" }}>
            {language.t("common.cancel") ?? "取消"}
          </Button>
          <Button variant="contrast" onClick={() => void save()} disabled={saving() || !value().trim()} style={{ "min-width": "64px" }}>
            <Show when={saving()} fallback={language.t("ui.common.confirm") ?? "确认"}>
              <Loader class="custom-agent-dialog-spinner" />
            </Show>
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}

export type PluginAddDialogProps = {
  onSaved?: () => void
  onClose?: () => void
}

export const PluginAddDialog: Component<PluginAddDialogProps> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()

  const save = async (value: string) => {
    await sdk.api.experimental.config.update({ plugin: { package: value } })
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.extensions.saved.title"),
      description: language.t("settings.extensions.saved.description", { name: value }),
    })
    props.onSaved?.()
  }

  return (
    <SourceAddDialog
      title={language.t("settings.extensions.plugin.add.title")}
      description={language.t("settings.extensions.plugin.description")}
      label={language.t("settings.extensions.plugin.label")}
      placeholder={language.t("settings.extensions.plugin.placeholder")}
      hint={language.t("settings.extensions.plugin.hint")}
      save={save}
      onClose={props.onClose}
    />
  )
}

export type SkillAddDialogProps = {
  onSaved?: () => void
  onClose?: () => void
}

export const SkillAddDialog: Component<SkillAddDialogProps> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()

  const save = async (value: string) => {
    await sdk.api.experimental.config.update({ skill: { source: value } })
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.extensions.saved.title"),
      description: language.t("settings.extensions.saved.description", { name: value }),
    })
    props.onSaved?.()
  }

  return (
    <SourceAddDialog
      title={language.t("settings.extensions.skill.add.title")}
      description={language.t("settings.extensions.skill.description")}
      label={language.t("settings.extensions.skill.label")}
      placeholder={language.t("settings.extensions.skill.placeholder")}
      save={save}
      onClose={props.onClose}
    />
  )
}
