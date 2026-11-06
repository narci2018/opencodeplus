import { Button } from "@opencode/ui/button"
import { Menu } from "@opencode/ui/menu"
import { Icon } from "@opencode/ui/icon"
import { useDialog } from "@opencode/ui/context/dialog"
import { createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { formatServerError } from "@/runtime/server/errors"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { CustomModelDialog } from "./dialog"
import { readProviderEntries, type CustomProviderEntry } from "./presets"
import "@/settings/settings.css"
import "./custom-model.css"

export const CustomModels: Component = () => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()

  const [entries, setEntries] = createSignal<CustomProviderEntry[]>([])

  const load = async () => {
    try {
      const list = await sdk.api.config.get().catch(() => [])
      setEntries(readProviderEntries(list))
    } finally {
      // no-op: the list re-renders from `entries`.
    }
  }

  const refresh = async () => {
    await load()
    data.location.provider.invalidate(undefined)
    data.location.model.invalidate(undefined)
    await Promise.all([data.location.provider.sync(), data.location.model.sync()]).catch(() => undefined)
  }

  const open = () => {
    void dialog.show(
      () => (
        <CustomModelDialog
          existing={entries()}
          onSaved={() => void refresh()}
          onClose={() => dialog.close()}
        />
      ),
      () => undefined,
    )
  }

  const remove = async (entry: CustomProviderEntry) => {
    try {
      await sdk.api.experimental.config.update({ provider: { id: entry.id, remove: true } })
      await refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.models.custom.removed.title"),
        description: language.t("settings.models.custom.removed.description", { name: entry.name ?? entry.id }),
      })
    } catch (cause) {
      const message = formatServerError(cause, language.t)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: message,
      })
    }
  }

  return (
    <>
      <Button size="normal" variant="neutral" icon="plus" onClick={open}>
        {language.t("settings.models.custom.add")}
      </Button>
      <Show when={entries().length > 0}>
        <div class="settings-section" data-component="custom-models-section">
          <div class="settings-section-header">
            <h3 class="settings-section-title">{language.t("settings.models.custom.section.title")}</h3>
            <Button size="normal" variant="ghost-muted" onClick={() => void load()}>
              {language.t("common.refresh")}
            </Button>
          </div>
          <SettingsList variant="catalog">
            <For each={entries()}>
              {(entry) => (
                <SettingsRow title={entry.name ?? entry.id} description={entry.baseURL ?? ""}>
                  <Menu placement="bottom-end" gutter={6}>
                    <Menu.Trigger as={Button} size="normal" variant="ghost-muted">
                      {language.t("settings.models.custom.section.manage")}
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Content>
                        <Menu.Item onSelect={() => void remove(entry)}>
                          <Icon name="trash" size="small" />
                          {language.t("common.delete")}
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu>
                </SettingsRow>
              )}
            </For>
          </SettingsList>
        </div>
      </Show>
    </>
  )
}
