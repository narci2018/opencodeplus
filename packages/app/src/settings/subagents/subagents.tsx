import { AgentPromptEditDialog } from "@/settings/agents/agents"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { normalizeAgentList } from "@/runtime/server/global-sync/utils"
import { formatServerError } from "@/runtime/server/errors"
import type { Agent } from "@/runtime/server/types"
import { showToast } from "@/shell/notifications/toast"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Tabs } from "@opencode/ui/tabs"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import "@/settings/settings.css"

type SubagentAccess = "default" | "allow" | "deny"

type SubagentItem = {
  id: string
  name: string
  description: string
  prompt?: string
  native?: boolean
}

type SubagentGroupKey = "builtin" | "antigravity" | "trae" | "claude" | "codex" | "dsh" | "zcode" | "other"

const GROUP_ORDER: SubagentGroupKey[] = ["builtin", "antigravity", "trae", "claude", "codex", "dsh", "zcode", "other"]

/** Classifies a subagent by origin so the page can group and tab them. */
function groupOf(id: string): SubagentGroupKey {
  if (id === "general" || id === "explore" || id === "build" || id === "plan") return "builtin"

  if (id.startsWith("agy-") || id === "agy") return "antigravity"

  if (id.startsWith("trae")) return "trae"

  if (id.startsWith("claude-") || id === "claude") return "claude"

  if (id.startsWith("codex-") || id === "codex") return "codex"

  if (id.startsWith("dsh-") || id === "dsh") return "dsh"

  if (id.startsWith("zcode-") || id === "zcode") return "zcode"

  return "other"
}

function toItem(agent: Agent): SubagentItem {
  return {
    id: agent.name,
    name: agent.displayName || agent.name,
    description: agent.description ?? "",
    prompt: agent.prompt,
    native: agent.native,
  }
}

export const SettingsSubAgents = () => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const dialog = useDialog()

  const [activeTab, setActiveTab] = createSignal<SubagentGroupKey>("builtin")
  const [searchQuery, setSearchQuery] = createSignal("")

  const [agents, agentsActions] = createResource(
    () => sdk.connection.status() === "connected",
    async (connected): Promise<SubagentItem[]> => {
      if (!connected) return []

      const res = await sdk.api.agent.list().catch(() => undefined)

      if (!res?.data) return []

      return normalizeAgentList(res.data)
        .filter((item) => item.mode === "subagent" && !item.hidden)
        .map(toItem)
    },
  )

  const [access, accessActions] = createResource(
    () => sdk.connection.status() === "connected",
    async (connected): Promise<Record<string, SubagentAccess>> => {
      if (!connected) return {}

      const entries = await sdk.api.config.get().catch(() => [])
      const map: Record<string, SubagentAccess> = {}

      for (const entry of entries) {
        if (entry.type !== "document") continue

        // SAFETY: Document entries carry an untyped config info payload; experimental subagent_access is guarded below.
        const experimental = (entry.info as { experimental?: { subagent_access?: Record<string, string | undefined> } })
          ?.experimental

        for (const [id, value] of Object.entries(experimental?.subagent_access ?? {})) {
          if (value === "allow" || value === "deny" || value === "default") map[id] = value
        }
      }

      return map
    },
  )

  const allBuckets = createMemo(() => {
    const items = agents() ?? []

    const buckets: Record<SubagentGroupKey, SubagentItem[]> = {
      builtin: [],
      antigravity: [],
      trae: [],
      claude: [],
      codex: [],
      dsh: [],
      zcode: [],
      other: [],
    }

    for (const item of items) buckets[groupOf(item.id)].push(item)

    for (const key of GROUP_ORDER) buckets[key].sort((a, b) => a.id.localeCompare(b.id))

    return buckets
  })

  const filteredBuckets = createMemo(() => {
    const q = searchQuery().trim().toLowerCase()
    const raw = allBuckets()

    if (!q) return raw

    const filtered: Record<SubagentGroupKey, SubagentItem[]> = {
      builtin: [],
      antigravity: [],
      trae: [],
      claude: [],
      codex: [],
      dsh: [],
      zcode: [],
      other: [],
    }

    for (const key of GROUP_ORDER) {
      filtered[key] = raw[key].filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q),
      )
    }

    return filtered
  })

  const stateOf = (id: string): SubagentAccess => access()?.[id] ?? "default"

  const setAccess = async (id: string, value: SubagentAccess) => {
    try {
      await sdk.api.experimental.config.update({
        experimental: { subagent_access: { [id]: value } },
      })
      await accessActions.refetch()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.subagents.access.saved.title"),
        description: language.t("settings.subagents.access.saved.description", { id }),
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(cause, language.t),
      })
    }
  }

  const openPromptEditor = (item: SubagentItem) => {
    const currentPrompt = item.prompt ?? ""
    void dialog.show(
      () => (
        <AgentPromptEditDialog
          agent={item}
          isCustomized={false}
          initialPrompt={currentPrompt}
          defaultPrompt={currentPrompt}
          onSaved={async () => {
            await Promise.all([agentsActions.refetch(), accessActions.refetch()])
            data.location.agent.invalidate(undefined)
            await data.location.agent.sync().catch(() => undefined)
          }}
          onClose={() => dialog.close()}
        />
      ),
      () => undefined,
    )
  }

  const companionLabel = (key: SubagentGroupKey) => {
    if (key === "builtin") return language.t("settings.subagents.companion.builtin")

    if (key === "antigravity") return language.t("settings.subagents.companion.antigravity")

    if (key === "trae") return language.t("settings.subagents.companion.trae")

    if (key === "claude") return language.t("settings.subagents.companion.claude")

    if (key === "codex") return language.t("settings.subagents.companion.codex")

    if (key === "dsh") return language.t("settings.subagents.companion.dsh")

    if (key === "zcode") return language.t("settings.subagents.companion.zcode")

    return language.t("settings.subagents.companion.other")
  }

  const groupIconName = (key: SubagentGroupKey) => {
    if (key === "builtin") return "box"

    if (key === "antigravity") return "sliders"

    if (key === "trae") return "code"

    if (key === "claude") return "brain"

    if (key === "codex") return "sparkles"

    if (key === "dsh") return "server"

    if (key === "zcode") return "console"

    return "terminal"
  }

  return (
    <div class="settings-tab-body">
      <div class="settings-tab-header">
        <h2 class="settings-tab-title">{language.t("settings.subagents.title")}</h2>
        <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.subagents.description")}</span>
      </div>

      <div class="subagent-tabs-header">
        {/* State explanation banner */}
        <div class="subagent-rule-banner">
          <span class="font-medium text-v2-text-base">{language.t("settings.subagents.rule.title")}:</span>
          <span class="subagent-rule-badge is-default" title={language.t("settings.subagents.rule.default")}>
            <Icon name="lock" size="small" />
            {language.t("settings.subagents.rule.default")}
          </span>
          <span class="subagent-rule-badge is-allow" title={language.t("settings.subagents.rule.allow")}>
            <Icon name="globe" size="small" />
            {language.t("settings.subagents.rule.allow")}
          </span>
          <span class="subagent-rule-badge is-deny" title={language.t("settings.subagents.rule.deny")}>
            <Icon name="circle-xmark" size="small" />
            {language.t("settings.subagents.rule.deny")}
          </span>
        </div>

        {/* Search bar */}
        <div class="subagent-search-bar">
          <Icon name="magnifying-glass" size="small" class="subagent-search-icon" />
          <input
            type="text"
            class="subagent-search-input"
            placeholder={language.t("settings.subagents.search.placeholder")}
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
          <Show when={searchQuery().length > 0}>
            <button
              type="button"
              class="subagent-search-clear"
              aria-label={language.t("settings.subagents.search.clear")}
              onClick={() => setSearchQuery("")}
            >
              <Icon name="close-small" size="small" />
            </button>
          </Show>
        </div>
      </div>

      {/* Tabs navigation */}
      <Tabs
        variant="pill"
        value={activeTab()}
        onChange={(val) => {
          if (
            val === "builtin" ||
            val === "antigravity" ||
            val === "trae" ||
            val === "claude" ||
            val === "codex" ||
            val === "dsh" ||
            val === "other"
          ) {
            setActiveTab(val)
          }
        }}
        class="settings-subtabs"
      >
        <Tabs.List>
          <For each={GROUP_ORDER}>
            {(key) => {
              const count = () => allBuckets()[key].length

              return (
                <Tabs.Trigger value={key}>
                  {language.t(`settings.subagents.group.${key}`)}
                  <span class="subagent-tab-badge">{count()}</span>
                </Tabs.Trigger>
              )
            }}
          </For>
        </Tabs.List>

        <For each={GROUP_ORDER}>
          {(key) => {
            const rawItems = () => allBuckets()[key]
            const items = () => filteredBuckets()[key]
            const isSearching = () => searchQuery().trim().length > 0

            return (
              <Tabs.Content value={key}>
                <div class="subagent-card-list">
                  <For each={items()}>
                    {(item) => {
                      const currentAccess = () => stateOf(item.id)

                      return (
                        <div class="subagent-card" data-component={`subagent-card-${item.id}`}>
                          <div class="subagent-card-header">
                            <div class="subagent-card-lead">
                              <div class="subagent-avatar">
                                <Icon name={groupIconName(key)} size="normal" />
                              </div>
                              <div class="subagent-meta">
                                <div class="subagent-title-row">
                                  <span class="subagent-title">{item.name}</span>
                                  <span class="subagent-id-pill">{item.id}</span>
                                  <span class="subagent-companion-tag">
                                    <Icon name="lock" size="small" />
                                    {companionLabel(key)}
                                  </span>
                                  <Show when={currentAccess() === "default"}>
                                    <span class="subagent-rule-badge is-default">
                                      {language.t("settings.subagents.badge.default")}
                                    </span>
                                  </Show>
                                  <Show when={currentAccess() === "allow"}>
                                    <span class="subagent-rule-badge is-allow">
                                      {language.t("settings.subagents.badge.allow")}
                                    </span>
                                  </Show>
                                  <Show when={currentAccess() === "deny"}>
                                    <span class="subagent-rule-badge is-deny">
                                      {language.t("settings.subagents.badge.deny")}
                                    </span>
                                  </Show>
                                </div>
                                <Show when={item.description}>
                                  <p class="subagent-desc">{item.description}</p>
                                </Show>
                              </div>
                            </div>

                            <div class="subagent-card-actions">
                              {/* 3-State Segmented Control */}
                              <div
                                class="subagent-segmented-control"
                                role="radiogroup"
                                aria-label={language.t("settings.subagents.access.label", { id: item.id })}
                              >
                                <button
                                  type="button"
                                  class="subagent-segment-btn"
                                  classList={{
                                    "is-active": currentAccess() === "default",
                                    "is-default": currentAccess() === "default",
                                  }}
                                  title={language.t("settings.subagents.rule.default")}
                                  onClick={() => void setAccess(item.id, "default")}
                                >
                                  {language.t("settings.subagents.access.default")}
                                </button>
                                <button
                                  type="button"
                                  class="subagent-segment-btn"
                                  classList={{
                                    "is-active": currentAccess() === "allow",
                                    "is-allow": currentAccess() === "allow",
                                  }}
                                  title={language.t("settings.subagents.rule.allow")}
                                  onClick={() => void setAccess(item.id, "allow")}
                                >
                                  {language.t("settings.subagents.access.allow")}
                                </button>
                                <button
                                  type="button"
                                  class="subagent-segment-btn"
                                  classList={{
                                    "is-active": currentAccess() === "deny",
                                    "is-deny": currentAccess() === "deny",
                                  }}
                                  title={language.t("settings.subagents.rule.deny")}
                                  onClick={() => void setAccess(item.id, "deny")}
                                >
                                  {language.t("settings.subagents.access.deny")}
                                </button>
                              </div>

                              <Button size="small" variant="ghost-muted" onClick={() => openPromptEditor(item)}>
                                <Icon name="pencil-line" size="small" />
                                {language.t("settings.subagents.editPrompt")}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    }}
                  </For>

                  {/* Empty state when searching and no match */}
                  <Show when={isSearching() && items().length === 0}>
                    <div class="subagent-guide-card">
                      <Icon name="magnifying-glass" size="large" class="text-v2-icon-icon-muted" />
                      <span class="text-13-medium text-v2-text-base">
                        {language.t("settings.subagents.search.empty")}
                      </span>
                      <Button size="small" variant="outline" onClick={() => setSearchQuery("")}>
                        {language.t("settings.subagents.search.clear")}
                      </Button>
                    </div>
                  </Show>

                  {/* Empty state when no items at all in this group */}
                  <Show when={!isSearching() && rawItems().length === 0}>
                    <Show
                      when={key === "trae"}
                      fallback={
                        <Show
                          when={key === "claude"}
                          fallback={
                            <Show
                              when={key === "codex"}
                              fallback={
                                <Show
                                  when={key === "dsh"}
                                  fallback={
                                    <Show
                                      when={key === "zcode"}
                                      fallback={
                                        <Show
                                          when={key === "other"}
                                          fallback={
                                            <div class="subagent-guide-card">
                                              <span class="text-13-regular text-v2-text-text-muted">
                                                {language.t("settings.subagents.group.empty")}
                                              </span>
                                            </div>
                                          }
                                        >
                                          <div class="subagent-guide-card">
                                            <Icon name="terminal" size="large" class="text-v2-icon-icon-muted" />
                                            <span class="text-13-medium text-v2-text-base">
                                              {language.t("settings.subagents.empty.other.title")}
                                            </span>
                                            <span class="text-12-regular text-v2-text-text-muted">
                                              {language.t("settings.subagents.empty.other.description")}
                                            </span>
                                          </div>
                                        </Show>
                                      }
                                    >
                                      <div class="subagent-guide-card">
                                        <Icon name="console" size="large" class="text-v2-icon-icon-muted" />
                                        <span class="text-13-medium text-v2-text-base">
                                          {language.t("settings.subagents.empty.zcode.title")}
                                        </span>
                                        <span class="text-12-regular text-v2-text-text-muted">
                                          {language.t("settings.subagents.empty.zcode.description")}
                                        </span>
                                      </div>
                                    </Show>
                                  }
                                >
                                  <div class="subagent-guide-card">
                                    <Icon name="server" size="large" class="text-v2-icon-icon-muted" />
                                    <span class="text-13-medium text-v2-text-base">
                                      {language.t("settings.subagents.empty.dsh.title")}
                                    </span>
                                    <span class="text-12-regular text-v2-text-text-muted">
                                      {language.t("settings.subagents.empty.dsh.description")}
                                    </span>
                                  </div>
                                </Show>
                              }
                            >
                              <div class="subagent-guide-card">
                                <Icon name="sparkles" size="large" class="text-v2-icon-icon-muted" />
                                <span class="text-13-medium text-v2-text-base">
                                  {language.t("settings.subagents.empty.codex.title")}
                                </span>
                                <span class="text-12-regular text-v2-text-text-muted">
                                  {language.t("settings.subagents.empty.codex.description")}
                                </span>
                              </div>
                            </Show>
                          }
                        >
                          <div class="subagent-guide-card">
                            <Icon name="brain" size="large" class="text-v2-icon-icon-muted" />
                            <span class="text-13-medium text-v2-text-base">
                              {language.t("settings.subagents.empty.claude.title")}
                            </span>
                            <span class="text-12-regular text-v2-text-text-muted">
                              {language.t("settings.subagents.empty.claude.description")}
                            </span>
                          </div>
                        </Show>
                      }
                    >
                      <div class="subagent-guide-card">
                        <Icon name="code" size="large" class="text-v2-icon-icon-muted" />
                        <span class="text-13-medium text-v2-text-base">
                          {language.t("settings.subagents.empty.trae.title")}
                        </span>
                        <span class="text-12-regular text-v2-text-text-muted">
                          {language.t("settings.subagents.empty.trae.description")}
                        </span>
                        <div class="subagent-code-block">
                          powershell -ExecutionPolicy Bypass -File .\import-trae-agent.ps1
                        </div>
                      </div>
                    </Show>
                  </Show>
                </div>
              </Tabs.Content>
            )
          }}
        </For>
      </Tabs>
    </div>
  )
}

