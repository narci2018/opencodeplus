import { Button } from "@opencode/ui/button"
import { Menu } from "@opencode/ui/menu"
import { Icon } from "@opencode/ui/icon"
import { useDialog } from "@opencode/ui/context/dialog"
import { createSignal, For, onMount, Show, type Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { formatServerError } from "@/runtime/server/errors"
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

  onMount(() => void load())

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

  const open = (existing?: CustomProviderEntry) => {
    void dialog.show(
      () => (
        <CustomModelDialog
          existing={entries()}
          editing={existing}
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
    <Show when={entries().length > 0}>
      <div class="settings-models-group" data-component="custom-models-section">
        <h3 class="settings-models-group-header">
          <div class="settings-models-group-header-copy">
            <Icon name="sparkles" size="small" />
            <span>{language.t("settings.models.custom.section.title")}</span>
          </div>
          <div class="settings-models-group-header-actions">
            <Button size="normal" variant="ghost-muted" icon="plus" onClick={() => open()}>
              {language.t("settings.models.custom.add")}
            </Button>
            <Button size="normal" variant="ghost-muted" onClick={() => void load()}>
              {language.t("common.refresh")}
            </Button>
          </div>
        </h3>
        <div class="settings-models-group-items">
          <For each={entries()}>
            {(entry) => (
              <div class="settings-models-row">
                <div class="settings-models-row-copy">
                  <span class="settings-models-row-title">{entry.name ?? entry.id}</span>
                  <span class="settings-models-row-description">{entry.baseURL ?? ""}</span>
                </div>
                <Menu placement="bottom-end" gutter={6}>
                  <Menu.Trigger as={Button} size="normal" variant="ghost-muted">
                    {language.t("settings.models.custom.section.manage")}
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content>
                      <Menu.Item onSelect={() => open(entry)}>
                        <Icon name="pencil" size="small" />
                        {language.t("common.edit")}
                      </Menu.Item>
                      <Menu.Item onSelect={() => void remove(entry)}>
                        <Icon name="trash" size="small" />
                        {language.t("common.delete")}
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Portal>
                </Menu>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
