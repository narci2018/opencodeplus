import { Predicate } from "effect"
import { Component, For, Show, createEffect, createMemo, createResource, type JSX } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { Tabs } from "@opencode/ui/tabs"
import { TruncatedText } from "@opencode/ui/truncated-text"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import { ServerConnection } from "@/runtime/server/registry"
import { useMcpToggle } from "@/providers/connect/mcp"
import { DialogMcp } from "@/providers/connect/mcp-dialog"
import {
  McpServerDialog,
  PluginAddDialog,
  SkillAddDialog,
  readExtensionConfig,
  type McpServerConfigLike,
} from "./extension-config"
import { ExtensionPlugins } from "@/runtime/plugin/extension-plugins"
import { ExternalLink } from "@/runtime/platform/external-link"
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsList } from "@/settings/list"
import type { SettingsView } from "@/settings/surface"
import "@/settings/settings.css"
import "@/shell/search-list.css"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

export const SettingsExtensions: Component<{
  directory?: string
  subtab?: SettingsView["subtab"]
  onSubtab: (value: SettingsView["subtab"]) => void
  headerAction?: JSX.Element
}> = (props) => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()
  const platform = usePlatform()
  // MCP connections are per Location, so read and toggle them where the active session runs, as the TUI does. The
  // names come from the default Location so this page lists only the servers available to all projects.
  const location = () => (props.directory ? { directory: props.directory } : data.location.default())
  const toggleMcp = useMcpToggle(() => props.directory)

  // The synced lists follow mcp.status.changed, so a finished sign-in shows up without a refetch.
  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.mcp.server.sync(data.location.default()).catch(() => undefined)

    if (props.directory) void data.location.mcp.server.sync(location()).catch(() => undefined)
  })

  const mcps = createMemo(() => {
    const active = data.location.mcp.server.list(location())

    return (data.location.mcp.server.list(data.location.default()) ?? [])
      .map((server) => active?.find((item) => item.name === server.name) ?? server)
      .toSorted((a, b) => a.name.localeCompare(b.name))
  })

  const toggle = (name: string) => {
    if (toggleMcp.isPending) return
    toggleMcp.mutate(name)
  }

  const [pluginList, pluginListActions] = createResource(
    () => serverSdk.connection.status() === "connected",
    () =>
      serverSdk.api.plugin
        .list()
        .then((result) => result.data)
        .catch(() => []),
    { initialValue: [] },
  )

  // The config-managed extension entries this page adds, edits, and removes through Config.Patch.
  const [configExts, configExtsActions] = createResource(
    () => serverSdk.connection.status() === "connected",
    async () => readExtensionConfig(await serverSdk.api.config.get().catch(() => [])),
    { initialValue: readExtensionConfig([]) },
  )
  const refreshConfig = () => {
    void configExtsActions.refetch()
    void pluginListActions.refetch()
    void data.location.mcp.server.invalidate(undefined)
    void data.location.mcp.server.sync(data.location.default()).catch(() => undefined)
  }

  const openMcpDialog = (editing?: { name: string; config: McpServerConfigLike }) => {
    void dialog.show(
      () => (
        <McpServerDialog
          existing={configExts.latest ?? { mcpServers: {}, plugins: [], skills: [] }}
          editing={editing}
          onSaved={() => refreshConfig()}
          onClose={() => dialog.close()}
        />
      ),
      () => undefined,
    )
  }

  const removeMcp = async (name: string) => {
    try {
      await serverSdk.api.experimental.config.update({ mcp: { name, remove: true } })
      refreshConfig()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.removed.title"),
        description: language.t("settings.extensions.removed.description", { name }),
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    }
  }

  const removePlugin = async (spec: string) => {
    try {
      await serverSdk.api.experimental.config.update({ plugin: { package: spec, remove: true } })
      refreshConfig()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.removed.title"),
        description: language.t("settings.extensions.removed.description", { name: spec }),
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    }
  }

  const removeSkill = async (source: string) => {
    try {
      await serverSdk.api.experimental.config.update({ skill: { source, remove: true } })
      refreshConfig()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.extensions.removed.title"),
        description: language.t("settings.extensions.removed.description", { name: source }),
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    }
  }

  const openPluginDialog = () => {
    void dialog.show(
      () => <PluginAddDialog onSaved={() => refreshConfig()} onClose={() => dialog.close()} />,
      () => undefined,
    )
  }

  const openSkillDialog = () => {
    void dialog.show(
      () => <SkillAddDialog onSaved={() => refreshConfig()} onClose={() => dialog.close()} />,
      () => undefined,
    )
  }

  // The desktop window runs the GUIs of its own server's plugins, so only that server's rows control them.
  const own = () => !!platform.plugins && ServerConnection.builtin(serverSdk.server)

  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.skill.sync().catch(() => undefined)
  })
  const skills = () => data.location.skill.list() ?? []

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.extensions")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.extensions.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
      </div>

      <div class="settings-tab-body">
        <Tabs
          variant="pill"
          value={props.subtab ?? "mcps"}
          onChange={(value) => {
            if (value === "mcps" || value === "plugins" || value === "skills") props.onSubtab(value)
          }}
          class="settings-extensions-tabs settings-subtabs"
        >
          <Tabs.List>
            <Tabs.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</Tabs.Trigger>
            <Tabs.Trigger value="plugins">{language.t("settings.extensions.tab.plugins")}</Tabs.Trigger>
            <Tabs.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="mcps">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <div class="flex items-center gap-2">
                  <span class="text-13-regular text-v2-text-text-muted">
                    {language.t("settings.extensions.manageConfig")}
                  </span>
                  <Button size="small" variant="ghost-muted" icon="plus" onClick={() => openMcpDialog()}>
                    {language.t("settings.extensions.add.mcp")}
                  </Button>
                </div>
              </div>
              <SettingsList variant="catalog">
                <For each={mcps()}>
                  {(item) => {
                    const busy = () => {
                      const target = toggleMcp.isPending ? toggleMcp.variables : undefined

                      return (Predicate.isString(target) ? target : target?.name) === item.name
                    }

                    // The dot shows the status, as in the MCPs dialog; the words stay for assistive technology.
                    const label = () =>
                      item.status.status === "pending" ? undefined : language.t(statusLabels[item.status.status])

                    // Only servers declared in the config document can be edited or removed here.
                    const configured = configExts.latest?.mcpServers[item.name]

                    return (
                      <div class="settings-extension-row settings-mcp-row" data-status={item.status.status}>
                        <div class="settings-extension-lead">
                          <span class="settings-mcp-status">
                            <span class="mcp-status-dot" data-status={item.status.status} aria-hidden="true" />
                          </span>
                          <TruncatedText text={item.name} class="settings-extension-name" />
                        </div>
                        <div class="settings-extension-trailing">
                          <Show when={configured}>
                            <Button
                              size="small"
                              variant="ghost-muted"
                              class="mcp-status-action"
                              aria-label={language.t("common.edit")}
                              onClick={() =>
                                openMcpDialog({
                                  name: item.name,
                                  config: configured as McpServerConfigLike,
                                })
                              }
                            >
                              <Icon name="pencil-line" size="small" />
                            </Button>
                            <Button
                              size="small"
                              variant="ghost-muted"
                              class="mcp-status-action"
                              aria-label={language.t("common.delete")}
                              disabled={busy()}
                              onClick={() => void removeMcp(item.name)}
                            >
                              <Icon name="trash" size="small" />
                            </Button>
                          </Show>
                          <Show when={item.status.status === "failed"}>
                            <Button
                              size="small"
                              variant="ghost-muted"
                              class="mcp-status-action"
                              aria-label={language.t("dialog.mcp.error.viewLabel", { name: item.name })}
                              onClick={() =>
                                dialog.show(() => <DialogMcp directory={location().directory} server={item.name} />)
                              }
                            >
                              {language.t("dialog.mcp.error.view")}
                            </Button>
                          </Show>
                          <Show
                            when={item.status.status === "needs_auth" && item.integrationID}
                            fallback={
                              <Switch
                                checked={item.status.status !== "disabled"}
                                disabled={item.status.status === "pending" || busy()}
                                description={label()}
                                class="[&_[data-slot=switch-description]]:sr-only"
                                onChange={(enabled) => {
                                  if (toggleMcp.isPending) return
                                  toggleMcp.mutate({ name: item.name, enabled })
                                }}
                              >
                                <span class="sr-only">{item.name}</span>
                              </Switch>
                            }
                          >
                            <Button
                              size="small"
                              variant="ghost-muted"
                              class="mcp-status-action"
                              disabled={busy()}
                              aria-busy={busy()}
                              aria-label={language.t("dialog.mcp.signIn.open", { name: item.name })}
                              onClick={() => toggle(item.name)}
                            >
                              {language.t(busy() ? "dialog.mcp.signingIn" : "dialog.mcp.signIn")}
                            </Button>
                          </Show>
                        </div>
                      </div>
                    )
                  }}
                </For>
              </SettingsList>
            </div>
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <div class="flex items-center gap-2">
                  <span class="text-13-regular text-v2-text-text-muted">
                    {language.t("settings.extensions.manageConfig")}
                  </span>
                  <Button size="small" variant="ghost-muted" icon="plus" onClick={() => openPluginDialog()}>
                    {language.t("settings.extensions.add.plugin")}
                  </Button>
                </div>
              </div>
              <Show when={configExts.latest?.plugins.length}>
                <div class="flex items-center justify-between">
                  <span class="settings-extension-heading text-13-medium">
                    {language.t("settings.extensions.configured")}
                  </span>
                </div>
                <SettingsList variant="catalog">
                  <For each={configExts.latest?.plugins ?? []}>
                    {(spec) => (
                      <div class="settings-extension-row">
                        <div class="settings-extension-lead">
                          <Icon name="cube" class="text-v2-icon-icon-muted shrink-0" />
                          <TruncatedText text={spec} class="settings-extension-name" />
                        </div>
                        <div class="settings-extension-trailing">
                          <Button
                            size="small"
                            variant="ghost-muted"
                            class="mcp-status-action"
                            aria-label={language.t("common.delete")}
                            onClick={() => void removePlugin(spec)}
                          >
                            <Icon name="trash" size="small" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </For>
                </SettingsList>
              </Show>
              <ExtensionPlugins plugins={pluginList.latest ?? []} own={own()} />
            </div>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <div class="settings-section">
              <div class="flex items-center justify-between">
                <span class="settings-extension-heading text-13-medium">
                  {language.t("settings.extensions.availableAll")}
                </span>
                <div class="flex items-center gap-2">
                  <ExternalLink class="settings-extension-link text-13-regular" href="https://opencode.ai/v2/docs/skills">
                    {language.t("settings.extensions.addSkills")}
                  </ExternalLink>
                  <Button size="small" variant="ghost-muted" icon="plus" onClick={() => openSkillDialog()}>
                    {language.t("settings.extensions.add.skill")}
                  </Button>
                </div>
              </div>
              <Show when={configExts.latest?.skills.length}>
                <div class="flex items-center justify-between">
                  <span class="settings-extension-heading text-13-medium">
                    {language.t("settings.extensions.configured")}
                  </span>
                </div>
                <SettingsList variant="catalog">
                  <For each={configExts.latest?.skills ?? []}>
                    {(source) => (
                      <div class="settings-extension-row">
                        <div class="settings-extension-lead">
                          <Icon name="folder" class="text-v2-icon-icon-muted shrink-0" />
                          <TruncatedText text={source} class="settings-extension-name" />
                        </div>
                        <div class="settings-extension-trailing">
                          <Button
                            size="small"
                            variant="ghost-muted"
                            class="mcp-status-action"
                            aria-label={language.t("common.delete")}
                            onClick={() => void removeSkill(source)}
                          >
                            <Icon name="trash" size="small" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </For>
                </SettingsList>
              </Show>
              <SettingsList variant="catalog">
                <For each={skills()}>
                  {(skill) => (
                    <div class="settings-extension-row">
                      <div class="settings-extension-lead">
                        <Icon name="post-skill" class="text-v2-icon-icon-muted shrink-0" />
                        <span class="settings-extension-name truncate">{skill.name}</span>
                      </div>
                    </div>
                  )}
                </For>
              </SettingsList>
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </>
  )
}
