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
import { CustomAgentDialog } from "./dialog"
import { readAgentEntries, type CustomAgentEntry } from "./presets"
import "@/settings/settings.css"
import "./custom-agent.css"

export const CustomAgents: Component = () => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()

  const [entries, setEntries] = createSignal<CustomAgentEntry[]>([])

  onMount(() => void load())

  const load = async () => {
    try {
      const list = await sdk.api.config.get().catch(() => [])
      setEntries(readAgentEntries(list))
    } finally {
      // no-op: the list re-renders from `entries`.
    }
  }

  const refresh = async () => {
    await load()
    data.location.agent.invalidate(undefined)
    await data.location.agent.sync().catch(() => undefined)
  }

  const open = (existing?: CustomAgentEntry) => {
    void dialog.show(
      () => (
        <CustomAgentDialog
          existing={entries()}
          editing={existing}
          onSaved={() => void refresh()}
          onClose={() => dialog.close()}
        />
      ),
      () => undefined,
    )
  }

  const remove = async (entry: CustomAgentEntry) => {
    try {
      await sdk.api.experimental.config.update({ agent: { id: entry.id, remove: true } })
      await refresh()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.agents.custom.removed.title"),
        description: language.t("settings.agents.custom.removed.description", { name: entry.id }),
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
    <div class="settings-models-group" data-component="custom-agents-section">
      <div class="settings-models-group-header">
        <span class="settings-models-group-title">{language.t("settings.agents.custom.section.title")}</span>
        <div class="settings-models-group-header-actions">
          <Button size="normal" variant="ghost-muted" icon="plus" onClick={() => open()}>
            {language.t("settings.agents.custom.add")}
          </Button>
        </div>
      </div>
      <Show when={entries().length > 0}>
        <div class="settings-models-group-items">
          <For each={entries()}>
            {(entry) => (
              <div class="settings-models-row">
                <div class="settings-models-row-copy">
                  <span class="settings-models-row-title">{entry.id}</span>
                  <span class="settings-models-row-description">{entry.description ?? entry.id}</span>
                </div>
                <Menu placement="bottom-end" gutter={6}>
                  <Menu.Trigger as={Button} size="normal" variant="ghost-muted">
                    {language.t("settings.agents.custom.section.manage")}
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
      </Show>
    </div>
  )
}
