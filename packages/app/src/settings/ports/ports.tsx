import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Loader } from "@opencode/ui/loader"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@/shell/notifications/toast"
import {
  createResource,
  createSignal,
  For,
  Show,
  type Component,
  type JSX,
} from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import "@/settings/settings.css"
import "@/settings/usage/usage.css"
import "./ports.css"

type PortsData = Awaited<ReturnType<ReturnType<typeof useServerSDK>["api"]["experimental"]["ports"]["status"]>>
type PortStatus = PortsData["ports"][number]

export function prefetchPorts(sdk: ReturnType<typeof useServerSDK>) {
  if (sdk.connection.status() !== "connected") return
  void sdk.api.experimental.ports
    .status()
    .then(() => undefined)
    .catch(() => undefined)
}

export const SettingsPorts: Component<{ headerAction?: JSX.Element }> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()

  const connected = () => sdk.connection.status() === "connected"

  const [ports, portsActions] = createResource(
    () => connected(),
    async (active): Promise<PortsData | undefined> => {
      if (!active) return undefined
      return sdk.api.experimental.ports.status().catch(() => undefined)
    },
  )

  const refresh = () => void portsActions.refetch()

  // Unsaved port edits keyed by port id; empty string means "restore the default".
  const [drafts, setDrafts] = createSignal<Partial<Record<PortStatus["id"], string>>>({})

  const draftOf = (id: PortStatus["id"]) => drafts()[id]

  const save = async (row: PortStatus) => {
    const raw = draftOf(row.id)?.trim()
    if (raw === undefined) return
    if (raw === "") {
      await apply(row, { [row.id]: null })
      return
    }
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: language.t("settings.ports.invalid"),
      })
      return
    }
    await apply(row, { [row.id]: value })
  }

  const apply = async (row: PortStatus, values: Record<string, number | null>) => {
    try {
      await sdk.api.experimental.config.update({ ports: values } as never)
      setDrafts((current) => ({ ...current, [row.id]: undefined }))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.saved.title"),
        description: language.t("settings.ports.saved", {
          name: language.t(`settings.ports.row.${row.id}.title`),
        }),
      })
      void refresh()
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    }
  }

  return (
    <div class="settings-tab-body">
      <div class="settings-tab-header settings-tab-header--stacked">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.ports.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.ports.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
      </div>

      <Show
        when={!ports.error}
        fallback={
          <div class="usage-status" role="alert">
            <Icon name="circle-exclamation" size="small" />
            <span>{language.t("settings.ports.error")}</span>
            <Button size="small" variant="ghost-muted" onClick={refresh}>
              {language.t("settings.usage.retry")}
            </Button>
          </div>
        }
      >
        <Show
          when={ports.latest !== undefined}
          fallback={
            <div class="usage-status">
              <Loader class="usage-status-spinner" />
              <span>{language.t("settings.usage.loading")}</span>
            </div>
          }
        >
          <div class="usage-section">
            <div class="usage-section-row">
              <span class="usage-section-title">{language.t("settings.ports.section")}</span>
              <div class="flex items-center gap-2">
                <IconButton
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  aria-label={language.t("common.refresh")}
                  onClick={refresh}
                  icon={<Icon name="reset" size="small" />}
                />
              </div>
            </div>

            <div class="ports-rows">
              <For each={ports.latest?.ports ?? []}>
                {(row) => {
                  const effective = () => row.configured_port ?? row.default_port
                  return (
                    <div class="ports-row">
                      <div class="ports-row-copy">
                        <div class="ports-row-title-wrap">
                          <span class="ports-row-title">{language.t(`settings.ports.row.${row.id}.title`)}</span>
                          <span
                            class={`ports-badge ${row.available ? "ports-badge--available" : "ports-badge--occupied"}`}
                          >
                            {row.available
                              ? language.t("settings.ports.available")
                              : language.t("settings.ports.occupied")}
                          </span>
                        </div>
                        <span class="ports-row-description">
                          {language.t(`settings.ports.row.${row.id}.description`)}
                        </span>
                        <span class="text-11-regular text-v2-text-text-muted">
                          {language.t("settings.ports.effective")}：{effective()}
                          {row.configured_port === null
                            ? ` · ${language.t("settings.ports.default")} ${row.default_port}`
                            : null}
                        </span>
                      </div>

                      <Show
                        when={row.configurable}
                        fallback={
                          <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.ports.fixed")}</span>
                        }
                      >
                        <div class="ports-row-actions">
                          <TextField
                            value={draftOf(row.id) ?? String(effective())}
                            onChange={(value) => setDrafts((current) => ({ ...current, [row.id]: value }))}
                            placeholder={language.t("settings.ports.placeholder")}
                          />
                          <Button
                            size="small"
                            variant="contrast"
                            onClick={() => void save(row)}
                            disabled={draftOf(row.id) === undefined}
                          >
                            {language.t("common.save")}
                          </Button>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  )
}