import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { createMemo, createResource, createSignal, For, Show, type Component, type JSX } from "solid-js"
import type { SessionInfo, SessionMessageInfo, TokenUsageInfo } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useUsageFormat } from "@/usage/format"
import "./usage.css"

type UsageRange = "all" | "7d" | "30d"
type ViewTab = "projects" | "models"
type SortOrder = "asc" | "desc"

const DAY = 24 * 60 * 60 * 1000
const MAX_SESSION_PAGES = 6
const SESSION_BATCH_SIZE = 500
const MESSAGE_PAGES = 100

const rangeFrom = (range: UsageRange): number | undefined => {
  if (range === "7d") return Date.now() - 7 * DAY
  if (range === "30d") return Date.now() - 30 * DAY
  return undefined
}

const tokenTotal = (tokens?: TokenUsageInfo) =>
  tokens ? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write : 0

const zeroTokens = (): TokenUsageInfo => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

/** Compact token counts for table cells: 1234 → `1.2k`, 4560000 → `4.6M`. */
const compact = (value: number) => {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

const modelName = (model: { providerID: string; id: string; variant?: string }) =>
  model.variant ? `${model.id}#${model.variant}` : model.id

export type SettingsUsageProps = {
  headerAction?: JSX.Element
}

const SortHeader: Component<{
  title: string
  active: boolean
  order: SortOrder
  align?: "left" | "right"
  onClick: () => void
}> = (props) => (
  <button
    type="button"
    class="usage-th-sort"
    style={{ "justify-content": props.align === "right" ? "flex-end" : "flex-start" }}
    onClick={props.onClick}
  >
    <span>{props.title}</span>
    <span class="usage-th-icon" data-active={props.active ? "" : undefined}>
      {props.active ? (props.order === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  </button>
)

type ProjectSortKey = "name" | "sessions" | "tokens" | "cost"
type SessionSortKey = "title" | "model" | "tokens" | "cost" | "time"
type ModelSortKey = "model" | "steps" | "input" | "output" | "reasoning" | "cache" | "total" | "perStep" | "cost"

export const SettingsUsage: Component<SettingsUsageProps> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const format = useUsageFormat()
  const dialog = useDialog()

  const [range, setRange] = createSignal<UsageRange>("all")
  const [viewTab, setViewTab] = createSignal<ViewTab>("projects")
  const [selectedProject, setSelectedProject] = createSignal<string | undefined>(undefined)

  const [projectSortKey, setProjectSortKey] = createSignal<ProjectSortKey>("cost")
  const [projectSortOrder, setProjectSortOrder] = createSignal<SortOrder>("desc")

  const [sessionSortKey, setSessionSortKey] = createSignal<SessionSortKey>("cost")
  const [sessionSortOrder, setSessionSortOrder] = createSignal<SortOrder>("desc")

  const [modelSortKey, setModelSortKey] = createSignal<ModelSortKey>("cost")
  const [modelSortOrder, setModelSortOrder] = createSignal<SortOrder>("desc")

  const connected = () => sdk.connection.status() === "connected"

  const [stats, statsActions] = createResource(
    () => [connected(), range()] as const,
    async ([active, current]) => {
      if (!active) return undefined
      const from = rangeFrom(current)
      const result = await sdk.api.experimental.session.stats({
        ...(from !== undefined ? { from } : {}),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      })
      return result
    },
  )

  const [sessions, sessionsActions] = createResource(
    () => [connected(), range()] as const,
    async ([active, current]) => {
      if (!active) return []
      const all: SessionInfo[] = []
      const from = rangeFrom(current)
      let cursor: string | undefined

      for (let page = 0; page < MAX_SESSION_PAGES; page++) {
        const result = await sdk.api.session.list(
          cursor
            ? { limit: SESSION_BATCH_SIZE, cursor }
            : { limit: SESSION_BATCH_SIZE, order: "desc" },
        )
        const batch = result.data
        if (batch.length === 0) break

        if (from !== undefined) {
          const valid = batch.filter((session) => session.time.updated >= from)
          all.push(...valid)
          if (valid.length < batch.length) break
        } else {
          all.push(...batch)
        }

        cursor = result.cursor.next ?? undefined
        if (!cursor) break
      }
      return all
    },
  )

  const [projects] = createResource(connected, async () => {
    if (!connected()) return []
    return sdk.api.project.list().catch(() => [])
  })

  const loading = () => stats.loading || sessions.loading
  const failed = () => stats.error !== undefined || sessions.error !== undefined

  const refetch = () => {
    void statsActions.refetch()
    void sessionsActions.refetch()
  }

  const projectName = (projectID: string) => {
    const project = (projects.latest ?? []).find((item) => item.id === projectID)
    return project?.name || project?.canonical || projectID
  }

  const filteredSessions = createMemo(() => sessions.latest ?? [])

  const projectGroups = createMemo(() => {
    const groups = new Map<
      string,
      { projectID: string; name: string; sessions: number; cost: number; tokens: number; last: number }
    >()
    for (const session of filteredSessions()) {
      const group = groups.get(session.projectID) ?? {
        projectID: session.projectID,
        name: projectName(session.projectID),
        sessions: 0,
        cost: 0,
        tokens: 0,
        last: 0,
      }
      group.sessions += 1
      group.cost += session.cost
      group.tokens += tokenTotal(session.tokens)
      group.last = Math.max(group.last, session.time.updated)
      groups.set(session.projectID, group)
    }
    return [...groups.values()]
  })

  const sortedProjects = createMemo(() => {
    const list = [...projectGroups()]
    const k = projectSortKey()
    const ord = projectSortOrder() === "asc" ? 1 : -1
    return list.sort((a, b) => {
      let diff = 0
      if (k === "name") diff = a.name.localeCompare(b.name)
      else if (k === "sessions") diff = a.sessions - b.sessions
      else if (k === "tokens") diff = a.tokens - b.tokens
      else if (k === "cost") diff = a.cost - b.cost
      return diff * ord
    })
  })

  const sortedSessions = createMemo(() => {
    const project = selectedProject()
    const rows = project ? filteredSessions().filter((s) => s.projectID === project) : filteredSessions()
    const k = sessionSortKey()
    const ord = sessionSortOrder() === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      let diff = 0
      if (k === "title") diff = (a.title || a.id).localeCompare(b.title || b.id)
      else if (k === "model") {
        const mA = a.model ? modelName(a.model) : ""
        const mB = b.model ? modelName(b.model) : ""
        diff = mA.localeCompare(mB)
      } else if (k === "tokens") diff = tokenTotal(a.tokens) - tokenTotal(b.tokens)
      else if (k === "cost") diff = a.cost - b.cost
      else if (k === "time") diff = a.time.updated - b.time.updated
      return diff * ord
    })
  })

  const sortedModels = createMemo(() => {
    const list = [...(stats.latest?.models ?? [])]
    const k = modelSortKey()
    const ord = modelSortOrder() === "asc" ? 1 : -1
    return list.sort((a, b) => {
      let diff = 0
      if (k === "model") diff = modelName(a.model).localeCompare(modelName(b.model))
      else if (k === "steps") diff = a.steps - b.steps
      else if (k === "input") diff = a.tokens.input - b.tokens.input
      else if (k === "output") diff = a.tokens.output - b.tokens.output
      else if (k === "reasoning") diff = a.tokens.reasoning - b.tokens.reasoning
      else if (k === "cache") diff = a.tokens.cache.read + a.tokens.cache.write - (b.tokens.cache.read + b.tokens.cache.write)
      else if (k === "total") diff = tokenTotal(a.tokens) - tokenTotal(b.tokens)
      else if (k === "perStep") {
        const perA = a.steps > 0 ? tokenTotal(a.tokens) / a.steps : 0
        const perB = b.steps > 0 ? tokenTotal(b.tokens) / b.steps : 0
        diff = perA - perB
      } else if (k === "cost") diff = a.cost - b.cost
      return diff * ord
    })
  })

  const toggleProjectSort = (key: ProjectSortKey) => {
    if (projectSortKey() === key) {
      setProjectSortOrder(projectSortOrder() === "asc" ? "desc" : "asc")
    } else {
      setProjectSortKey(key)
      setProjectSortOrder("desc")
    }
  }

  const toggleSessionSort = (key: SessionSortKey) => {
    if (sessionSortKey() === key) {
      setSessionSortOrder(sessionSortOrder() === "asc" ? "desc" : "asc")
    } else {
      setSessionSortKey(key)
      setSessionSortOrder("desc")
    }
  }

  const toggleModelSort = (key: ModelSortKey) => {
    if (modelSortKey() === key) {
      setModelSortOrder(modelSortOrder() === "asc" ? "desc" : "asc")
    } else {
      setModelSortKey(key)
      setModelSortOrder("desc")
    }
  }

  const openSession = (session: SessionInfo) => {
    void dialog.show(
      () => <UsageSessionDialog session={session} projectName={projectName(session.projectID)} />,
      () => undefined,
    )
  }

  const rangeOptions: { id: UsageRange; label: string }[] = [
    { id: "all", label: language.t("settings.usage.range.all") },
    { id: "7d", label: language.t("settings.usage.range.7d") },
    { id: "30d", label: language.t("settings.usage.range.30d") },
  ]

  const totalCost = () => stats.latest?.cost ?? 0

  return (
    <div class="settings-tab-body">
      <div class="settings-tab-header settings-tab-header--stacked">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.usage.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.usage.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
        <div class="usage-range" role="group">
          <For each={rangeOptions}>
            {(option) => (
              <Button
                size="small"
                variant={range() === option.id ? "contrast" : "ghost-muted"}
                onClick={() => setRange(option.id)}
              >
                {option.label}
              </Button>
            )}
          </For>
        </div>
      </div>

      <Show
        when={!failed()}
        fallback={
          <div class="usage-status" role="alert">
            <Icon name="circle-exclamation" size="small" />
            <span>{language.t("settings.usage.error")}</span>
            <Button size="small" variant="ghost-muted" onClick={refetch}>
              {language.t("settings.usage.retry")}
            </Button>
          </div>
        }
      >
        <Show
          when={!loading()}
          fallback={
            <div class="usage-status">
              <Loader class="usage-status-spinner" />
              <span>{language.t("settings.usage.loading")}</span>
            </div>
          }
        >
          {/* Summary Cards */}
          <div class="usage-cards">
            <div class="usage-card">
              <span class="usage-card-label">{language.t("settings.usage.card.cost")}</span>
              <span class="usage-card-value">{format.money(stats.latest?.cost ?? 0)}</span>
            </div>
            <div class="usage-card">
              <span class="usage-card-label">{language.t("settings.usage.card.sessions")}</span>
              <span class="usage-card-value">{stats.latest?.sessions ?? filteredSessions().length}</span>
            </div>
            <div class="usage-card">
              <span class="usage-card-label">{language.t("settings.usage.card.prompts")}</span>
              <span class="usage-card-value">{stats.latest?.prompts ?? 0}</span>
            </div>
            <div class="usage-card">
              <span class="usage-card-label">{language.t("settings.usage.card.steps")}</span>
              <span class="usage-card-value">{stats.latest?.steps ?? 0}</span>
            </div>
            <div class="usage-card">
              <span class="usage-card-label">{language.t("settings.usage.card.activeDays")}</span>
              <span class="usage-card-value">{stats.latest?.activeDays ?? 0}</span>
            </div>
            <div class="usage-card">
              <span class="usage-card-label">{language.t("settings.usage.card.streak")}</span>
              <span class="usage-card-value">{stats.latest?.streak ?? 0}</span>
            </div>
          </div>

          {/* View Tab Selector: By Project vs By Model */}
          <div class="usage-tabs" role="tablist">
            <Button
              size="small"
              variant={viewTab() === "projects" ? "contrast" : "ghost-muted"}
              onClick={() => setViewTab("projects")}
            >
              {language.t("settings.usage.section.projects")}
            </Button>
            <Button
              size="small"
              variant={viewTab() === "models" ? "contrast" : "ghost-muted"}
              onClick={() => setViewTab("models")}
            >
              {language.t("settings.usage.section.models")}
            </Button>
          </div>

          {/* Tab 1: By Project (with sessions sub-group) */}
          <Show when={viewTab() === "projects"}>
            <div class="usage-section">
              <div class="usage-section-row">
                <span class="usage-section-title">{language.t("settings.usage.section.projects")}</span>
                <span class="text-11-regular text-v2-text-text-muted">{projectGroups().length}</span>
              </div>

              {/* Advanced Project Cost Chart */}
              <Show when={projectGroups().length > 1 && totalCost() > 0}>
                <div class="usage-chart-card">
                  <div class="usage-chart-header">
                    <span class="usage-chart-title">{language.t("settings.usage.chart.costShare")}</span>
                  </div>
                  <div class="usage-bar-list">
                    <For each={sortedProjects().slice(0, 5)}>
                      {(p) => {
                        const pct = totalCost() > 0 ? Math.min(100, Math.round((p.cost / totalCost()) * 100)) : 0
                        return (
                          <div class="usage-bar-row">
                            <div class="usage-bar-info">
                              <span class="usage-bar-info-label" title={p.name}>{p.name}</span>
                              <span class="usage-bar-info-value">{format.money(p.cost)} ({pct}%)</span>
                            </div>
                            <div class="usage-bar-track">
                              <div class="usage-bar-fill" style={{ width: `${Math.max(2, pct)}%` }} />
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Projects Table */}
              <Show
                when={projectGroups().length > 0}
                fallback={<div class="usage-status">{language.t("settings.usage.empty")}</div>}
              >
                <div class="usage-table" data-columns="4">
                  <div class="usage-table-head">
                    <SortHeader
                      title={language.t("settings.usage.column.project")}
                      active={projectSortKey() === "name"}
                      order={projectSortOrder()}
                      onClick={() => toggleProjectSort("name")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.column.sessions")}
                      active={projectSortKey() === "sessions"}
                      order={projectSortOrder()}
                      align="right"
                      onClick={() => toggleProjectSort("sessions")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.tokens.total")}
                      active={projectSortKey() === "tokens"}
                      order={projectSortOrder()}
                      align="right"
                      onClick={() => toggleProjectSort("tokens")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.card.cost")}
                      active={projectSortKey() === "cost"}
                      order={projectSortOrder()}
                      align="right"
                      onClick={() => toggleProjectSort("cost")}
                    />
                  </div>
                  <For each={sortedProjects()}>
                    {(group) => (
                      <button
                        type="button"
                        class="usage-table-row usage-table-row--click"
                        data-active={selectedProject() === group.projectID ? "" : undefined}
                        onClick={() =>
                          setSelectedProject(selectedProject() === group.projectID ? undefined : group.projectID)
                        }
                      >
                        <span class="usage-cell-model" title={group.name}>{group.name}</span>
                        <span>{group.sessions}</span>
                        <span>{compact(group.tokens)}</span>
                        <span>{format.money(group.cost)}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              {/* Sessions Sub-group inside Projects view */}
              <div class="usage-section usage-sessions-section">
                <div class="usage-section-row">
                  <div class="flex items-center gap-2">
                    <span class="usage-section-title">{language.t("settings.usage.section.sessions")}</span>
                    <Show when={selectedProject()}>
                      <span class="usage-project-badge">
                        <span>{projectName(selectedProject()!)}</span>
                        <button
                          type="button"
                          class="usage-badge-clear"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedProject(undefined)
                          }}
                          title={language.t("settings.usage.filter.clear")}
                        >
                          ×
                        </button>
                      </span>
                    </Show>
                  </div>
                  <span class="text-11-regular text-v2-text-text-muted">{sortedSessions().length}</span>
                </div>

                <Show
                  when={sortedSessions().length > 0}
                  fallback={<div class="usage-status">{language.t("settings.usage.empty.sessions")}</div>}
                >
                  <div class="usage-table" data-columns="5">
                    <div class="usage-table-head">
                      <SortHeader
                        title={language.t("settings.usage.column.session")}
                        active={sessionSortKey() === "title"}
                        order={sessionSortOrder()}
                        onClick={() => toggleSessionSort("title")}
                      />
                      <SortHeader
                        title={language.t("settings.usage.column.model")}
                        active={sessionSortKey() === "model"}
                        order={sessionSortOrder()}
                        onClick={() => toggleSessionSort("model")}
                      />
                      <SortHeader
                        title={language.t("settings.usage.tokens.total")}
                        active={sessionSortKey() === "tokens"}
                        order={sessionSortOrder()}
                        align="right"
                        onClick={() => toggleSessionSort("tokens")}
                      />
                      <SortHeader
                        title={language.t("settings.usage.card.cost")}
                        active={sessionSortKey() === "cost"}
                        order={sessionSortOrder()}
                        align="right"
                        onClick={() => toggleSessionSort("cost")}
                      />
                      <SortHeader
                        title={language.t("settings.usage.column.lastActive")}
                        active={sessionSortKey() === "time"}
                        order={sessionSortOrder()}
                        align="right"
                        onClick={() => toggleSessionSort("time")}
                      />
                    </div>
                    <For each={sortedSessions()}>
                      {(session) => (
                        <button
                          type="button"
                          class="usage-table-row usage-table-row--click"
                          onClick={() => openSession(session)}
                        >
                          <span class="usage-cell-model" title={session.title ?? session.id}>
                            {session.title || session.id}
                          </span>
                          <span class="usage-cell-model">{session.model ? modelName(session.model) : "—"}</span>
                          <span>{compact(tokenTotal(session.tokens))}</span>
                          <span>{format.money(session.cost)}</span>
                          <span>{format.shortTime(session.time.updated)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          {/* Tab 2: By Model */}
          <Show when={viewTab() === "models"}>
            <div class="usage-section">
              <span class="usage-section-title">{language.t("settings.usage.section.models")}</span>

              {/* Advanced Model Analysis: Cost Share & Token Composition */}
              <Show when={(stats.latest?.models ?? []).length > 0}>
                <div class="usage-chart-grid">
                  {/* Model Cost Share Chart */}
                  <div class="usage-chart-card">
                    <div class="usage-chart-header">
                      <span class="usage-chart-title">{language.t("settings.usage.chart.costShare")}</span>
                    </div>
                    <div class="usage-bar-list">
                      <For each={[...(stats.latest?.models ?? [])].sort((a, b) => b.cost - a.cost).slice(0, 5)}>
                        {(item) => {
                          const pct = totalCost() > 0 ? Math.min(100, Math.round((item.cost / totalCost()) * 100)) : 0
                          return (
                            <div class="usage-bar-row">
                              <div class="usage-bar-info">
                                <span class="usage-bar-info-label" title={modelName(item.model)}>
                                  {modelName(item.model)}
                                </span>
                                <span class="usage-bar-info-value">{format.money(item.cost)} ({pct}%)</span>
                              </div>
                              <div class="usage-bar-track">
                                <div class="usage-bar-fill" style={{ width: `${Math.max(2, pct)}%` }} />
                              </div>
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  </div>

                  {/* Token Composition Breakdown Chart */}
                  <Show when={stats.latest?.tokens}>
                    {(tok) => {
                      const totalTok = tokenTotal(tok())
                      const inPct = totalTok > 0 ? ((tok().input / totalTok) * 100).toFixed(1) : "0"
                      const outPct = totalTok > 0 ? ((tok().output / totalTok) * 100).toFixed(1) : "0"
                      const resPct = totalTok > 0 ? ((tok().reasoning / totalTok) * 100).toFixed(1) : "0"
                      const cacheVal = tok().cache.read + tok().cache.write
                      const cachePct = totalTok > 0 ? ((cacheVal / totalTok) * 100).toFixed(1) : "0"

                      return (
                        <div class="usage-chart-card">
                          <div class="usage-chart-header">
                            <span class="usage-chart-title">{language.t("settings.usage.chart.tokenComposition")}</span>
                            <span class="text-11-regular text-v2-text-text-muted">{compact(totalTok)}</span>
                          </div>
                          <div class="usage-token-stacked-bar">
                            <div class="usage-token-segment usage-token-segment--input" style={{ width: `${inPct}%` }} />
                            <div class="usage-token-segment usage-token-segment--output" style={{ width: `${outPct}%` }} />
                            <div class="usage-token-segment usage-token-segment--reasoning" style={{ width: `${resPct}%` }} />
                            <div class="usage-token-segment usage-token-segment--cache" style={{ width: `${cachePct}%` }} />
                          </div>
                          <div class="usage-token-legend">
                            <div class="usage-legend-item">
                              <span class="usage-legend-label">
                                <span class="usage-legend-dot usage-legend-dot--input" />
                                {language.t("settings.usage.tokens.input")}
                              </span>
                              <span class="usage-legend-value">{compact(tok().input)} ({inPct}%)</span>
                            </div>
                            <div class="usage-legend-item">
                              <span class="usage-legend-label">
                                <span class="usage-legend-dot usage-legend-dot--output" />
                                {language.t("settings.usage.tokens.output")}
                              </span>
                              <span class="usage-legend-value">{compact(tok().output)} ({outPct}%)</span>
                            </div>
                            <div class="usage-legend-item">
                              <span class="usage-legend-label">
                                <span class="usage-legend-dot usage-legend-dot--reasoning" />
                                {language.t("settings.usage.tokens.reasoning")}
                              </span>
                              <span class="usage-legend-value">{compact(tok().reasoning)} ({resPct}%)</span>
                            </div>
                            <div class="usage-legend-item">
                              <span class="usage-legend-label">
                                <span class="usage-legend-dot usage-legend-dot--cache" />
                                {language.t("settings.usage.tokens.cache")}
                              </span>
                              <span class="usage-legend-value">{compact(cacheVal)} ({cachePct}%)</span>
                            </div>
                          </div>
                        </div>
                      )
                    }}
                  </Show>
                </div>
              </Show>

              {/* Models Table with Sortable Numeric Columns */}
              <div class="usage-table" data-columns="9">
                <div class="usage-table-head">
                  <SortHeader
                    title={language.t("settings.usage.column.model")}
                    active={modelSortKey() === "model"}
                    order={modelSortOrder()}
                    onClick={() => toggleModelSort("model")}
                  />
                  <SortHeader
                    title={language.t("settings.usage.column.steps")}
                    active={modelSortKey() === "steps"}
                    order={modelSortOrder()}
                    align="right"
                    onClick={() => toggleModelSort("steps")}
                  />
                  <SortHeader
                    title={language.t("settings.usage.tokens.input")}
                    active={modelSortKey() === "input"}
                    order={modelSortOrder()}
                    align="right"
                    onClick={() => toggleModelSort("input")}
                  />
                  <SortHeader
                    title={language.t("settings.usage.tokens.output")}
                    active={modelSortKey() === "output"}
                    order={modelSortOrder()}
                    align="right"
                    onClick={() => toggleModelSort("output")}
                  />
                  <SortHeader
                    title={language.t("settings.usage.tokens.reasoning")}
                    active={modelSortKey() === "reasoning"}
                    order={modelSortOrder()}
                    align="right"
                    onClick={() => toggleModelSort("reasoning")}
                  />
                  <SortHeader
                    title={language.t("settings.usage.tokens.cache")}
                    active={modelSortKey() === "cache"}
                    order={modelSortOrder()}
                    align="right"
                    onClick={() => toggleModelSort("cache")}
                  />
                  <SortHeader
                    title={language.t("settings.usage.tokens.total")}
                    active={modelSortKey() === "total"}
                    order={modelSortOrder()}
                    align="right"
                    onClick={() => toggleModelSort("total")}
                  />
                  <SortHeader
                    title={language.t("settings.usage.tokens.perStep")}
                    active={modelSortKey() === "perStep"}
                    order={modelSortOrder()}
                    align="right"
                    onClick={() => toggleModelSort("perStep")}
                  />
                  <SortHeader
                    title={language.t("settings.usage.card.cost")}
                    active={modelSortKey() === "cost"}
                    order={modelSortOrder()}
                    align="right"
                    onClick={() => toggleModelSort("cost")}
                  />
                </div>
                <For each={sortedModels()}>
                  {(item) => {
                    const total = tokenTotal(item.tokens)
                    return (
                      <div class="usage-table-row">
                        <span class="usage-cell-model">{modelName(item.model)}</span>
                        <span>{item.steps}</span>
                        <span>{compact(item.tokens.input)}</span>
                        <span>{compact(item.tokens.output)}</span>
                        <span>{compact(item.tokens.reasoning)}</span>
                        <span>{compact(item.tokens.cache.read + item.tokens.cache.write)}</span>
                        <span>{compact(total)}</span>
                        <span>{item.steps > 0 ? compact(Math.round(total / item.steps)) : "—"}</span>
                        <span>{format.money(item.cost)}</span>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}

type MessageRow = {
  time: number
  kind: "assistant" | "compaction"
  model?: string
  tokens?: TokenUsageInfo
  cost?: number
}

const messageRow = (message: SessionMessageInfo): MessageRow | undefined => {
  if (message.type === "assistant")
    return {
      time: message.time.completed ?? message.time.created,
      kind: "assistant",
      model: modelName(message.model),
      tokens: message.tokens,
      cost: message.cost,
    }
  if (message.type === "compaction" && message.status === "completed" && (message.tokens || message.cost !== undefined))
    return {
      time: message.time.created,
      kind: "compaction",
      model: message.model ? modelName(message.model) : undefined,
      tokens: message.tokens,
      cost: message.cost,
    }
  return undefined
}

type DialogModelSortKey = "model" | "steps" | "input" | "output" | "reasoning" | "cache" | "total" | "cost"

const UsageSessionDialog: Component<{ session: SessionInfo; projectName: string }> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const format = useUsageFormat()

  const [dialogModelSortKey, setDialogModelSortKey] = createSignal<DialogModelSortKey>("cost")
  const [dialogModelSortOrder, setDialogModelSortOrder] = createSignal<SortOrder>("desc")

  const [messages] = createResource(async () => {
    const all: SessionMessageInfo[] = []
    let cursor: string | undefined

    for (let page = 0; page < MESSAGE_PAGES; page++) {
      try {
        const result = await sdk.api.message.list(
          cursor
            ? { sessionID: props.session.id, limit: 200, cursor }
            : { sessionID: props.session.id, limit: 200, order: "asc" },
        )
        all.push(...result.data)
        cursor = result.cursor.next ?? undefined
        if (!cursor) break
      } catch (err) {
        if (all.length > 0) break
        throw err
      }
    }
    return all.map(messageRow).filter((row): row is MessageRow => row !== undefined)
  })

  const rows = createMemo(() => messages.latest ?? [])

  const modelTotals = createMemo(() => {
    const totals = new Map<string, { model: string; steps: number; tokens: TokenUsageInfo; cost: number }>()
    for (const row of rows()) {
      const model = row.model ?? "—"
      const total = totals.get(model) ?? { model, steps: 0, tokens: zeroTokens(), cost: 0 }
      total.steps += 1
      if (row.tokens) {
        total.tokens.input += row.tokens.input
        total.tokens.output += row.tokens.output
        total.tokens.reasoning += row.tokens.reasoning
        total.tokens.cache.read += row.tokens.cache.read
        total.tokens.cache.write += row.tokens.cache.write
      }
      total.cost += row.cost ?? 0
      totals.set(model, total)
    }

    const list = [...totals.values()]
    const k = dialogModelSortKey()
    const ord = dialogModelSortOrder() === "asc" ? 1 : -1

    return list.sort((a, b) => {
      let diff = 0
      if (k === "model") diff = a.model.localeCompare(b.model)
      else if (k === "steps") diff = a.steps - b.steps
      else if (k === "input") diff = a.tokens.input - b.tokens.input
      else if (k === "output") diff = a.tokens.output - b.tokens.output
      else if (k === "reasoning") diff = a.tokens.reasoning - b.tokens.reasoning
      else if (k === "cache") diff = a.tokens.cache.read + a.tokens.cache.write - (b.tokens.cache.read + b.tokens.cache.write)
      else if (k === "total") diff = tokenTotal(a.tokens) - tokenTotal(b.tokens)
      else if (k === "cost") diff = a.cost - b.cost
      return diff * ord
    })
  })

  const toggleDialogModelSort = (key: DialogModelSortKey) => {
    if (dialogModelSortKey() === key) {
      setDialogModelSortOrder(dialogModelSortOrder() === "asc" ? "desc" : "asc")
    } else {
      setDialogModelSortKey(key)
      setDialogModelSortOrder("desc")
    }
  }

  return (
    <Dialog size="x-large" variant="settings" resizable maximizable>
      <DialogHeader>
        <DialogTitleGroup
          title={props.session.title || props.session.id}
          description={`${props.projectName} · ${format.money(props.session.cost)} · ${compact(tokenTotal(props.session.tokens))} ${language.t("settings.usage.tokens.total").toLowerCase()}`}
        />
      </DialogHeader>
      <DialogBody class="usage-dialog-body">
        <Show
          when={!messages.error}
          fallback={
            <div class="usage-status" role="alert">
              <Icon name="circle-exclamation" size="small" />
              <span>{language.t("settings.usage.error")}</span>
            </div>
          }
        >
          <Show
            when={!messages.loading}
            fallback={
              <div class="usage-status">
                <Loader class="usage-status-spinner" />
                <span>{language.t("settings.usage.loading")}</span>
              </div>
            }
          >
            <Show
              when={rows().length > 0}
              fallback={<div class="usage-status">{language.t("settings.usage.empty.messages")}</div>}
            >
              <div class="usage-section">
                <span class="usage-section-title">{language.t("settings.usage.section.models")}</span>
                <div class="usage-table" data-columns="8">
                  <div class="usage-table-head">
                    <SortHeader
                      title={language.t("settings.usage.column.model")}
                      active={dialogModelSortKey() === "model"}
                      order={dialogModelSortOrder()}
                      onClick={() => toggleDialogModelSort("model")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.column.steps")}
                      active={dialogModelSortKey() === "steps"}
                      order={dialogModelSortOrder()}
                      align="right"
                      onClick={() => toggleDialogModelSort("steps")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.tokens.input")}
                      active={dialogModelSortKey() === "input"}
                      order={dialogModelSortOrder()}
                      align="right"
                      onClick={() => toggleDialogModelSort("input")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.tokens.output")}
                      active={dialogModelSortKey() === "output"}
                      order={dialogModelSortOrder()}
                      align="right"
                      onClick={() => toggleDialogModelSort("output")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.tokens.reasoning")}
                      active={dialogModelSortKey() === "reasoning"}
                      order={dialogModelSortOrder()}
                      align="right"
                      onClick={() => toggleDialogModelSort("reasoning")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.tokens.cache")}
                      active={dialogModelSortKey() === "cache"}
                      order={dialogModelSortOrder()}
                      align="right"
                      onClick={() => toggleDialogModelSort("cache")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.tokens.total")}
                      active={dialogModelSortKey() === "total"}
                      order={dialogModelSortOrder()}
                      align="right"
                      onClick={() => toggleDialogModelSort("total")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.card.cost")}
                      active={dialogModelSortKey() === "cost"}
                      order={dialogModelSortOrder()}
                      align="right"
                      onClick={() => toggleDialogModelSort("cost")}
                    />
                  </div>
                  <For each={modelTotals()}>
                    {(total) => (
                      <div class="usage-table-row">
                        <span class="usage-cell-model">{total.model}</span>
                        <span>{total.steps}</span>
                        <span>{compact(total.tokens.input)}</span>
                        <span>{compact(total.tokens.output)}</span>
                        <span>{compact(total.tokens.reasoning)}</span>
                        <span>{compact(total.tokens.cache.read + total.tokens.cache.write)}</span>
                        <span>{compact(tokenTotal(total.tokens))}</span>
                        <span>{format.money(total.cost)}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <div class="usage-section">
                <span class="usage-section-title">{language.t("settings.usage.section.messages")}</span>
                <div class="usage-table" data-columns="7">
                  <div class="usage-table-head">
                    <span>{language.t("settings.usage.column.time")}</span>
                    <span>{language.t("settings.usage.column.kind")}</span>
                    <span>{language.t("settings.usage.column.model")}</span>
                    <span>{language.t("settings.usage.tokens.input")}</span>
                    <span>{language.t("settings.usage.tokens.output")}</span>
                    <span>{language.t("settings.usage.tokens.reasoning")}</span>
                    <span>{language.t("settings.usage.card.cost")}</span>
                  </div>
                  <For each={rows()}>
                    {(row) => (
                      <div class="usage-table-row">
                        <span>{format.shortTime(row.time)}</span>
                        <span>
                          {language.t(
                            row.kind === "assistant"
                              ? "settings.usage.kind.assistant"
                              : "settings.usage.kind.compaction",
                          )}
                        </span>
                        <span class="usage-cell-model">{row.model ?? "—"}</span>
                        <span>{row.tokens ? compact(row.tokens.input) : "—"}</span>
                        <span>{row.tokens ? compact(row.tokens.output) : "—"}</span>
                        <span>{row.tokens ? compact(row.tokens.reasoning) : "—"}</span>
                        <span>{row.cost === undefined ? "—" : format.money(row.cost)}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </Show>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
