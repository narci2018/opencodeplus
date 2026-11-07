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

const DAY = 24 * 60 * 60 * 1000
const SESSION_PAGES = 200
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

export const SettingsUsage: Component<SettingsUsageProps> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const format = useUsageFormat()

  const [range, setRange] = createSignal<UsageRange>("all")
  const [selectedProject, setSelectedProject] = createSignal<string | undefined>(undefined)
  const [sortMode, setSortMode] = createSignal<"cost" | "time">("cost")
  const dialog = useDialog()

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
      let cursor: string | undefined
      for (let page = 0; page < SESSION_PAGES; page++) {
        const result = await sdk.api.session.list({ limit: 100, order: "desc", ...(cursor ? { cursor } : {}) })
        all.push(...result.data)
        cursor = result.cursor.next ?? undefined
        if (!cursor) break
      }
      const from = rangeFrom(current)
      return from === undefined ? all : all.filter((session) => session.time.updated >= from)
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
    return [...groups.values()].sort((a, b) => b.cost - a.cost || b.last - a.last)
  })

  const sessionRows = createMemo(() => {
    const project = selectedProject()
    const rows = project ? filteredSessions().filter((session) => session.projectID === project) : filteredSessions()
    return [...rows].sort((a, b) =>
      sortMode() === "cost" ? b.cost - a.cost : b.time.updated - a.time.updated,
    )
  })

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
        <Show when={!loading()} fallback={
          <div class="usage-status">
            <Loader class="usage-status-spinner" />
            <span>{language.t("settings.usage.loading")}</span>
          </div>
        }>
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

          <Show when={(stats.latest?.activity ?? []).length > 0}>
            <div class="usage-section">
              <span class="usage-section-title">{language.t("settings.usage.section.activity")}</span>
              <ActivityChart activity={stats.latest?.activity ?? []} />
            </div>
          </Show>

          <Show when={(stats.latest?.models ?? []).length > 0}>
            <div class="usage-section">
              <span class="usage-section-title">{language.t("settings.usage.section.models")}</span>
              <div class="usage-table" data-columns="9">
                <div class="usage-table-head">
                  <span>{language.t("settings.usage.column.model")}</span>
                  <span>{language.t("settings.usage.column.steps")}</span>
                  <span>{language.t("settings.usage.tokens.input")}</span>
                  <span>{language.t("settings.usage.tokens.output")}</span>
                  <span>{language.t("settings.usage.tokens.reasoning")}</span>
                  <span>{language.t("settings.usage.tokens.cache")}</span>
                  <span>{language.t("settings.usage.tokens.total")}</span>
                  <span>{language.t("settings.usage.tokens.perStep")}</span>
                  <span>{language.t("settings.usage.card.cost")}</span>
                </div>
                <For each={[...(stats.latest?.models ?? [])].sort((a, b) => b.cost - a.cost)}>
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

          <div class="usage-section">
            <span class="usage-section-title">{language.t("settings.usage.section.projects")}</span>
            <Show when={projectGroups().length > 0} fallback={
              <div class="usage-status">{language.t("settings.usage.empty")}</div>
            }>
              <div class="usage-table" data-columns="4">
                <div class="usage-table-head">
                  <span>{language.t("settings.usage.column.project")}</span>
                  <span>{language.t("settings.usage.column.sessions")}</span>
                  <span>{language.t("settings.usage.tokens.total")}</span>
                  <span>{language.t("settings.usage.card.cost")}</span>
                </div>
                <For each={projectGroups()}>
                  {(group) => (
                    <button
                      type="button"
                      class="usage-table-row usage-table-row--click"
                      data-active={selectedProject() === group.projectID ? "" : undefined}
                      onClick={() => setSelectedProject(selectedProject() === group.projectID ? undefined : group.projectID)}
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
          </div>

          <div class="usage-section">
            <div class="usage-section-row">
              <span class="usage-section-title">
                {language.t("settings.usage.section.sessions")}
                <Show when={selectedProject()}>
                  <span class="usage-section-filter">· {projectName(selectedProject()!)}</span>
                </Show>
              </span>
              <Button
                size="small"
                variant="ghost-muted"
                onClick={() => setSortMode(sortMode() === "cost" ? "time" : "cost")}
              >
                {language.t(sortMode() === "cost" ? "settings.usage.sort.cost" : "settings.usage.sort.time")}
              </Button>
            </div>
            <Show when={sessionRows().length > 0} fallback={
              <div class="usage-status">{language.t("settings.usage.empty.sessions")}</div>
            }>
              <div class="usage-table" data-columns="5">
                <div class="usage-table-head">
                  <span>{language.t("settings.usage.column.session")}</span>
                  <span>{language.t("settings.usage.column.model")}</span>
                  <span>{language.t("settings.usage.tokens.total")}</span>
                  <span>{language.t("settings.usage.card.cost")}</span>
                  <span>{language.t("settings.usage.column.lastActive")}</span>
                </div>
                <For each={sessionRows()}>
                  {(session) => (
                    <button type="button" class="usage-table-row usage-table-row--click" onClick={() => openSession(session)}>
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
        </Show>
      </Show>
    </div>
  )
}

const ActivityChart: Component<{ activity: Array<{ date: string; steps: number }> }> = (props) => {
  const max = Math.max(1, ...props.activity.map((day) => day.steps))
  return (
    <div class="usage-activity">
      <For each={props.activity.slice(-62)}>
        {(day) => (
          <div
            class="usage-activity-bar"
            style={{ height: `${Math.max(4, Math.round((day.steps / max) * 100))}%` }}
            title={`${day.date}: ${day.steps}`}
          />
        )}
      </For>
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
    return { time: message.time.completed ?? message.time.created, kind: "assistant", model: modelName(message.model), tokens: message.tokens, cost: message.cost }
  // Only a completed compaction records the usage of the compaction request itself.
  if (message.type === "compaction" && message.status === "completed" && (message.tokens || message.cost !== undefined))
    return { time: message.time.created, kind: "compaction", model: message.model ? modelName(message.model) : undefined, tokens: message.tokens, cost: message.cost }
  return undefined
}

const UsageSessionDialog: Component<{ session: SessionInfo; projectName: string }> = (props) => {
  const language = useLanguage()
  const sdk = useServerSDK()
  const format = useUsageFormat()

  const [messages] = createResource(async () => {
    const all: SessionMessageInfo[] = []
    let cursor: string | undefined
      for (let page = 0; page < MESSAGE_PAGES; page++) {
        const result = await sdk.api.message.list({
          sessionID: props.session.id,
          limit: 200,
          order: "asc",
          ...(cursor ? { cursor } : {}),
        })
        all.push(...result.data)
        cursor = result.cursor.next ?? undefined
        if (!cursor) break
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
    return [...totals.values()].sort((a, b) => b.cost - a.cost)
  })

  return (
    <Dialog size="x-large" variant="settings" resizable maximizable>
      <DialogHeader>
        <DialogTitleGroup
          title={props.session.title || props.session.id}
          description={`${props.projectName} · ${format.money(props.session.cost)} · ${compact(tokenTotal(props.session.tokens))} ${language.t("settings.usage.tokens.total").toLowerCase()}`}
        />
      </DialogHeader>
      <DialogBody class="usage-dialog-body">
        <Show when={!messages.error} fallback={
          <div class="usage-status" role="alert">
            <Icon name="circle-exclamation" size="small" />
            <span>{language.t("settings.usage.error")}</span>
          </div>
        }>
          <Show when={!messages.loading} fallback={
            <div class="usage-status">
              <Loader class="usage-status-spinner" />
              <span>{language.t("settings.usage.loading")}</span>
            </div>
          }>
            <Show when={rows().length > 0} fallback={
              <div class="usage-status">{language.t("settings.usage.empty.messages")}</div>
            }>
              <div class="usage-section">
                <span class="usage-section-title">{language.t("settings.usage.section.models")}</span>
                <div class="usage-table" data-columns="8">
                  <div class="usage-table-head">
                    <span>{language.t("settings.usage.column.model")}</span>
                    <span>{language.t("settings.usage.column.steps")}</span>
                    <span>{language.t("settings.usage.tokens.input")}</span>
                    <span>{language.t("settings.usage.tokens.output")}</span>
                    <span>{language.t("settings.usage.tokens.reasoning")}</span>
                    <span>{language.t("settings.usage.tokens.cache")}</span>
                    <span>{language.t("settings.usage.tokens.total")}</span>
                    <span>{language.t("settings.usage.card.cost")}</span>
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
                        <span>{language.t(row.kind === "assistant" ? "settings.usage.kind.assistant" : "settings.usage.kind.compaction")}</span>
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
