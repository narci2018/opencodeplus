import { Component, createEffect, createResource, createSignal, Show } from "solid-js"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import { SettingsRow } from "@/settings/row"
import "@/settings/settings.css"

/**
 * The proxy the desktop sends outbound requests through.
 *
 * Model requests leave from the background server, which reads the proxy from its environment, so saving
 * restarts that server and interrupts any run in progress. Only HTTP(S) proxies work here: the runtime has
 * no SOCKS support, so an address like `socks5://127.0.0.1:1080` is rejected instead of silently ignored.
 */
export const NetworkProxySetting: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const [proxy, { refetch: reloadProxy }] = createResource(() => platform.getNetworkProxy?.())
  const [value, setValue] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  createEffect(() => setValue(proxy() ?? ""))

  const save = async () => {
    const input = value().trim()
    const stored = proxy() ?? ""

    if (input === stored) return

    const url = input ? parseProxy(input) : undefined

    if (input && url === undefined) {
      showToast({ title: language.t("settings.general.row.networkProxy.invalid") })

      return
    }

    setSaving(true)

    try {
      await platform.setNetworkProxy?.(url ?? null)
      setValue(url ?? "")
      void reloadProxy()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(
          url === undefined ? "settings.general.row.networkProxy.cleared" : "settings.general.row.networkProxy.applied",
        ),
      })
    } catch (error) {
      setValue(stored)
      showToast({
        title: language.t("settings.general.row.networkProxy.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Show when={platform.setNetworkProxy}>
      <SettingsRow
        title={language.t("settings.general.row.networkProxy.title")}
        description={language.t("settings.general.row.networkProxy.description")}
      >
        <div class="w-full sm:w-[260px]" data-action="settings-network-proxy">
          <TextInput
            type="text"
            appearance="base"
            value={value()}
            onInput={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save()
            }}
            onBlur={save}
            placeholder={language.t("settings.general.row.networkProxy.placeholder")}
            disabled={saving()}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            aria-label={language.t("settings.general.row.networkProxy.title")}
          />
        </div>
      </SettingsRow>
    </Show>
  )
}

/** The proxy address the runtime accepts, or nothing when the input cannot be one. */
function parseProxy(input: string) {
  if (!URL.canParse(input)) return undefined
  const url = new URL(input)

  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined

  if (!url.hostname || url.pathname !== "/" || url.search || url.hash) return undefined

  return url.href
}
