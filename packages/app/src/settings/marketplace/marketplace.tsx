import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { TextField } from "@opencode/ui/text-field"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { formatServerError } from "@/runtime/server/errors"
import { readExtensionConfig, McpServerDialog } from "../providers/extension-config"
import { MARKETPLACE_CATEGORIES, MARKETPLACE_PLUGINS, type PluginItem } from "./catalog"
import "./marketplace.css"

export function SettingsMarketplace(props: { headerAction?: JSX.Element }) {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useServerSDK()
  const data = useData()

  const [category, setCategory] = createSignal<string>("全部")
  const [search, setSearch] = createSignal<string>("")
  const [loadingMap, setLoadingMap] = createSignal<Record<string, boolean>>({})

  const config = createMemo(() => readExtensionConfig(data.location.config.list() ?? []))

  const isInstalled = (id: string) => {
    return Object.hasOwn(config().mcpServers, id)
  }

  const filteredPlugins = createMemo(() => {
    const currentCat = category()
    const query = search().trim().toLowerCase()

    return MARKETPLACE_PLUGINS.filter((item) => {
      if (currentCat === "常用精选" && !item.featured) return false
      if (currentCat !== "全部" && currentCat !== "常用精选" && item.category !== currentCat) return false
      if (!query) return true
      return (
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.tags.some((t) => t.toLowerCase().includes(query))
      )
    })
  })

  const refreshMcp = async () => {
    data.location.mcp.server.invalidate(undefined)
    data.location.config.invalidate(undefined)
    await data.location.mcp.server.sync().catch(() => undefined)
    await data.location.config.sync().catch(() => undefined)
  }

  const installPlugin = async (plugin: PluginItem) => {
    setLoadingMap((prev) => ({ ...prev, [plugin.id]: true }))
    try {
      await sdk.api.experimental.config.update({
        mcp: {
          name: plugin.id,
          config: plugin.defaultConfig,
        },
      })
      await refreshMcp()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "插件安装成功",
        description: `“${plugin.name}”已成功接入 OpenCode，智能体现在可以直接调用其工具。`,
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: "安装失败",
        description: formatServerError(cause, language.t),
      })
    } finally {
      setLoadingMap((prev) => ({ ...prev, [plugin.id]: false }))
    }
  }

  const uninstallPlugin = async (plugin: PluginItem) => {
    setLoadingMap((prev) => ({ ...prev, [plugin.id]: true }))
    try {
      await sdk.api.experimental.config.update({
        mcp: {
          name: plugin.id,
          remove: true,
        },
      })
      await refreshMcp()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "插件已卸载",
        description: `“${plugin.name}”已从 OpenCode 配置中移除。`,
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: "卸载失败",
        description: formatServerError(cause, language.t),
      })
    } finally {
      setLoadingMap((prev) => ({ ...prev, [plugin.id]: false }))
    }
  }

  const openAddCustomMcp = () => {
    dialog.push(() => (
      <McpServerDialog
        existing={config()}
        onSaved={refreshMcp}
        onClose={() => dialog.close()}
      />
    ))
  }

  return (
    <div class="marketplace-screen">
      <div class="marketplace-header">
        <div class="marketplace-header-main">
          <div class="marketplace-title">{language.t("settings.marketplace.title")}</div>
          <div class="marketplace-description">{language.t("settings.marketplace.description")}</div>
        </div>
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <Button variant="ghost" size="small" onClick={openAddCustomMcp}>
            <Icon name="plus" size="small" />
            <span>添加自定义 MCP</span>
          </Button>
          <Show when={props.headerAction}>{props.headerAction}</Show>
        </div>
      </div>

      <div class="marketplace-controls">
        <div class="marketplace-categories">
          <For each={MARKETPLACE_CATEGORIES}>
            {(cat) => (
              <button
                type="button"
                class="marketplace-category-btn"
                data-active={category() === cat}
                onClick={() => setCategory(cat)}
              >
                {cat}
              </button>
            )}
          </For>
        </div>

        <div class="marketplace-search">
          <TextField
            value={search()}
            onChange={setSearch}
            placeholder="搜索插件、协议或分类…"
            icon="magnifying-glass"
          />
        </div>
      </div>

      <div class="marketplace-grid">
        <For each={filteredPlugins()}>
          {(plugin) => {
            const installed = () => isInstalled(plugin.id)
            const loading = () => !!loadingMap()[plugin.id]

            return (
              <div class="plugin-card">
                <div class="plugin-card-top">
                  <div class="plugin-card-header">
                    <div class="plugin-card-title-group">
                      <div class="plugin-card-icon">
                        <Icon name="mcp" size="small" />
                      </div>
                      <div style={{ display: "flex", "flex-direction": "column" }}>
                        <span class="plugin-card-title">{plugin.name}</span>
                        <span class="plugin-card-author">{plugin.author}</span>
                      </div>
                    </div>
                    <Show when={installed()}>
                      <span class="plugin-status-badge" data-status="installed">
                        已启用
                      </span>
                    </Show>
                  </div>

                  <div class="plugin-card-desc">{plugin.description}</div>

                  <div class="plugin-tags">
                    <For each={plugin.tags}>{(tag) => <span class="plugin-tag">#{tag}</span>}</For>
                  </div>
                </div>

                <div class="plugin-card-bottom">
                  <span class="plugin-version">v{plugin.version}</span>
                  <div class="plugin-actions">
                    <Show
                      when={installed()}
                      fallback={
                        <Button
                          variant="contrast"
                          size="small"
                          disabled={loading()}
                          onClick={() => installPlugin(plugin)}
                        >
                          {loading() ? "安装中…" : "一键安装"}
                        </Button>
                      }
                    >
                      <Button
                        variant="ghost"
                        size="small"
                        disabled={loading()}
                        onClick={() => uninstallPlugin(plugin)}
                      >
                        {loading() ? "处理中…" : "卸载"}
                      </Button>
                    </Show>
                  </div>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
