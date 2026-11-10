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
import { createMemo, createResource, For, Show } from "solid-js"
import "@/settings/settings.css"

type SubagentAccess = "default" | "allow" | "deny"

type SubagentItem = {
  id: string
  name: string
  description: string
  prompt?: string
  native?: boolean
}

type SubagentGroupKey = "builtin" | "antigravity" | "trae" | "other"

const GROUP_ORDER: SubagentGroupKey[] = ["builtin", "antigravity", "trae", "other"]

/** Classifies a subagent by origin so the page can group them. */
function groupOf(id: string): SubagentGroupKey {
  if (id === "general" || id === "explore") return "builtin"
  if (id.startsWith("agy-")) return "antigravity"
  if (id.startsWith("trae")) return "trae"
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

  const [agents, agentsActions] = createResource(
    () => sdk.connection.status() === "connected",
    async (connected) => {
      if (!connected) return [] as SubagentItem[]
      const res = await sdk.api.agent.list().catch(() => undefined)
      if (!res?.data) return [] as SubagentItem[]
      return normalizeAgentList(res.data)
        .filter((item) => item.mode === "subagent" && !item.hidden)
        .map(toItem)
    },
  )

  const [access, accessActions] = createResource(
    () => sdk.connection.status() === "connected",
    async (connected) => {
      if (!connected) return {} as Record<string, SubagentAccess>
      const entries = await sdk.api.config.get().catch(() => [])
      const map: Record<string, SubagentAccess> = {}
      for (const entry of entries) {
        if (entry.type !== "document") continue
        const experimental = (entry.info as { experimental?: { subagent_access?: Record<string, unknown> } })
          ?.experimental
        for (const [id, value] of Object.entries(experimental?.subagent_access ?? {})) {
          if (value === "allow" || value === "deny" || value === "default") map[id] = value
        }
      }
      return map
    },
  )

  const groups = createMemo(() => {
    const items = agents() ?? []
    const buckets: Record<SubagentGroupKey, SubagentItem[]> = { builtin: [], antigravity: [], trae: [], other: [] }
    for (const item of items) buckets[groupOf(item.id)].push(item)
    for (const key of GROUP_ORDER) buckets[key].sort((a, b) => a.id.localeCompare(b.id))
    return buckets
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

  const total = () => (agents() ?? []).length

  return (
    <div class="settings-tab-body">
      <div class="settings-tab-header">
        <h2 class="settings-tab-title">{language.t("settings.subagents.title")}</h2>
        <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.subagents.description")}</span>
      </div>

      <For each={GROUP_ORDER}>
        {(key) => {
          const items = () => groups()[key]
          return (
            <div class="settings-models-group" data-component={`subagents-${key}-section`}>
              <div class="settings-models-group-header">
                <span class="settings-models-group-title">
                  {language.t(`settings.subagents.group.${key}`)}
                </span>
                <span class="text-11-regular text-v2-text-text-muted">{items().length}</span>
              </div>
              <div class="settings-models-group-items">
                <For each={items()}>
                  {(item) => (
                    <div class="settings-models-row">
                      <div class="settings-models-row-copy">
                        <div class="flex items-center gap-2">
                          <span class="settings-models-row-title font-medium">{item.name}</span>
                          <span class="text-10-regular px-1.5 py-0.5 rounded bg-v2-surface-subtle text-v2-text-muted border border-v2-border-subtle">
                            {item.id}
                          </span>
                        </div>
                        <span class="settings-models-row-description">{item.description}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <select
                          class="subagent-access-select text-12-regular bg-v2-surface border border-v2-border rounded px-2 py-1"
                          value={stateOf(item.id)}
                          onChange={(event) => void setAccess(item.id, event.currentTarget.value as SubagentAccess)}
                          aria-label={language.t("settings.subagents.access.label", { id: item.id })}
                        >
                          <option value="default">{language.t("settings.subagents.access.default")}</option>
                          <option value="allow">{language.t("settings.subagents.access.allow")}</option>
                          <option value="deny">{language.t("settings.subagents.access.deny")}</option>
                        </select>
                        <Button size="small" variant="ghost-muted" onClick={() => openPromptEditor(item)}>
                          <Icon name="pencil-line" size="small" />
                          {language.t("settings.subagents.editPrompt")}
                        </Button>
                      </div>
                    </div>
                  )}
                </For>
                <Show when={items().length === 0}>
                  <span class="text-12-regular text-v2-text-text-muted">
                    {language.t("settings.subagents.group.empty")}
                  </span>
                </Show>
              </div>
            </div>
          )
        }}
      </For>

      <Show when={total() === 0}>
        <span class="text-12-regular text-v2-text-text-muted">{language.t("settings.subagents.empty")}</span>
      </Show>
    </div>
  )
}
