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
const MAX_SESSION_PAGES = 1
const SESSION_BATCH_SIZE = 100
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
  if (!Number.isFinite(value) || value <= 0) return "0"
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
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

const MODEL_PALETTE = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4", "#f97316", "#64748b"]

function Pagination(props: {
  current: number
  total: number
  pageSize: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const totalPages = () => Math.max(1, Math.ceil(props.total / props.pageSize))
  const options = props.pageSizeOptions ?? [10, 20, 50]

  return (
    <div class="usage-pagination">
      <span>
        第 {props.current} / {totalPages()} 页 (共 {props.total} 条)
      </span>
      <div class="usage-pagination-actions">
        <select
          class="usage-page-size-select"
          value={props.pageSize}
          onChange={(e) => {
            props.onPageSizeChange(Number(e.currentTarget.value))
            props.onPageChange(1)
          }}
        >
          <For each={options}>
            {(size) => <option value={size}>{size} 条/页</option>}
          </For>
        </select>
        <button
          type="button"
          class="usage-pagination-btn"
          disabled={props.current <= 1}
          onClick={() => props.onPageChange(props.current - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          class="usage-pagination-btn"
          disabled={props.current >= totalPages()}
          onClick={() => props.onPageChange(props.current + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  )
}

type StatsData = Awaited<ReturnType<ReturnType<typeof useServerSDK>["api"]["experimental"]["session"]["stats"]>>
const statsCache = new Map<UsageRange, StatsData>()
const sessionsCache = new Map<UsageRange, SessionInfo[]>()

function getCachedStats(range: UsageRange): StatsData | undefined {
  const mem = statsCache.get(range)
  if (mem) return mem
  try {
    const raw = localStorage.getItem(`opencode.usage.stats.${range}`)
    if (raw) {
      const parsed = JSON.parse(raw) as StatsData
      statsCache.set(range, parsed)
      return parsed
    }
  } catch {}
  return undefined
}

function setCachedStats(range: UsageRange, data: StatsData) {
  statsCache.set(range, data)
  try {
    localStorage.setItem(`opencode.usage.stats.${range}`, JSON.stringify(data))
  } catch {}
}

function getCachedSessions(range: UsageRange): SessionInfo[] | undefined {
  const mem = sessionsCache.get(range)
  if (mem) return mem
  try {
    const raw = sessionStorage.getItem(`opencode.usage.sessions.${range}`)
    if (raw) {
      const parsed = JSON.parse(raw) as SessionInfo[]
      sessionsCache.set(range, parsed)
      return parsed
    }
  } catch {}
  return undefined
}

function setCachedSessions(range: UsageRange, data: SessionInfo[]) {
  sessionsCache.set(range, data)
  try {
    sessionStorage.setItem(`opencode.usage.sessions.${range}`, JSON.stringify(data.slice(0, 100)))
  } catch {}
}

export function prefetchUsage(sdk: ReturnType<typeof useServerSDK>) {
  if (sdk.connection.status() !== "connected") return
  void sdk.api.experimental.session
    .stats({
      tools: "none",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    })
    .then((res) => {
      if (res) setCachedStats("all", res)
    })
    .catch(() => undefined)
  void sdk.api.session
    .list({ limit: 100, order: "desc" })
    .then((res) => {
      if (res?.data?.length) setCachedSessions("all", res.data)
    })
    .catch(() => undefined)
}

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
  const [projectPage, setProjectPage] = createSignal(1)
  const [projectPageSize, setProjectPageSize] = createSignal(10)

  const [sessionSortKey, setSessionSortKey] = createSignal<SessionSortKey>("cost")
  const [sessionSortOrder, setSessionSortOrder] = createSignal<SortOrder>("desc")
  const [sessionPage, setSessionPage] = createSignal(1)
  const [sessionPageSize, setSessionPageSize] = createSignal(10)

  const [modelSortKey, setModelSortKey] = createSignal<ModelSortKey>("cost")
  const [modelSortOrder, setModelSortOrder] = createSignal<SortOrder>("desc")
  const [modelPage, setModelPage] = createSignal(1)
  const [modelPageSize, setModelPageSize] = createSignal(10)

  const connected = () => sdk.connection.status() === "connected"

  const [stats, statsActions] = createResource(
    () => [connected(), range()] as const,
    async ([active, current]) => {
      if (!active) return undefined
      const from = rangeFrom(current)
      const result = await sdk.api.experimental.session.stats({
        ...(from !== undefined ? { from } : {}),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        tools: "none",
      })
      if (result) setCachedStats(current, result)
      return result
    },
    { initialValue: getCachedStats(range()) },
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
      if (all.length > 0) setCachedSessions(current, all)
      return all
    },
    { initialValue: getCachedSessions(range()) ?? [] },
  )

  const [projects] = createResource(connected, async () => {
    if (!connected()) return []
    return sdk.api.project.list().catch(() => [])
  })

  const loading = () => stats.loading && !stats.latest
  const failed = () => stats.error !== undefined && !stats.latest

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

  const paginatedProjects = createMemo(() => {
    const list = sortedProjects()
    const start = (projectPage() - 1) * projectPageSize()
    return list.slice(start, start + projectPageSize())
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

  const paginatedSessions = createMemo(() => {
    const list = sortedSessions()
    const start = (sessionPage() - 1) * sessionPageSize()
    return list.slice(start, start + sessionPageSize())
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

  const paginatedModels = createMemo(() => {
    const list = sortedModels()
    const start = (modelPage() - 1) * modelPageSize()
    return list.slice(start, start + modelPageSize())
  })

  const toggleProjectSort = (key: ProjectSortKey) => {
    if (projectSortKey() === key) {
      setProjectSortOrder(projectSortOrder() === "asc" ? "desc" : "asc")
    } else {
      setProjectSortKey(key)
      setProjectSortOrder("desc")
    }
    setProjectPage(1)
  }

  const toggleSessionSort = (key: SessionSortKey) => {
    if (sessionSortKey() === key) {
      setSessionSortOrder(sessionSortOrder() === "asc" ? "desc" : "asc")
    } else {
      setSessionSortKey(key)
      setSessionSortOrder("desc")
    }
    setSessionPage(1)
  }

  const toggleModelSort = (key: ModelSortKey) => {
    if (modelSortKey() === key) {
      setModelSortOrder(modelSortOrder() === "asc" ? "desc" : "asc")
    } else {
      setModelSortKey(key)
      setModelSortOrder("desc")
    }
    setModelPage(1)
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

  // Derived Analytics Metrics for Advanced Charts
  const totalTokensVal = createMemo(() => tokenTotal(stats.latest?.tokens))
  const totalCostVal = createMemo(() => stats.latest?.cost ?? 0)

  const tokenBreakdown = createMemo(() => {
    const t = stats.latest?.tokens ?? zeroTokens()
    const total = Math.max(1, tokenTotal(t))
    const inputPct = Math.round((t.input / total) * 100)
    const outputPct = Math.round((t.output / total) * 100)
    const reasoningPct = Math.round((t.reasoning / total) * 100)
    const cachePct = Math.round(((t.cache.read + t.cache.write) / total) * 100)
    return {
      input: t.input,
      output: t.output,
      reasoning: t.reasoning,
      cacheRead: t.cache.read,
      cacheWrite: t.cache.write,
      inputPct,
      outputPct,
      reasoningPct,
      cachePct,
    }
  })

  // Cache hit percentage & estimated cost savings
  const cacheMetrics = createMemo(() => {
    const t = stats.latest?.tokens ?? zeroTokens()
    const totalCacheable = t.input + t.cache.read
    const hitRate = totalCacheable > 0 ? (t.cache.read / totalCacheable) * 100 : 0
    // Estimate savings based on read tokens vs standard input price ($1.5 per M tokens as proxy)
    const savedAmount = (t.cache.read / 1_000_000) * 1.5
    return {
      hitRate: Number(hitRate.toFixed(1)),
      savedAmount: Number(savedAmount.toFixed(2)),
      cachedTokens: t.cache.read,
      uncachedTokens: t.input,
    }
  })

  // 24-hour activity rhythm calculation
  const hourlyActivity = createMemo(() => {
    const hours = new Array(24).fill(0)
    for (const session of filteredSessions()) {
      const h = new Date(session.time.updated).getHours()
      hours[h] += tokenTotal(session.tokens)
    }
    const maxVal = Math.max(1, ...hours)
    let peakH = 0
    let peakTokens = 0
    let troughH = 0
    let troughTokens = Infinity
    hours.forEach((v, idx) => {
      if (v > peakTokens) {
        peakTokens = v
        peakH = idx
      }
      if (v < troughTokens) {
        troughTokens = v
        troughH = idx
      }
    })
    const avgLoad = (stats.latest?.steps ?? 0) > 0 ? totalTokensVal() / stats.latest!.steps : 0
    const ratio = tokenBreakdown().output > 0 ? (tokenBreakdown().input / tokenBreakdown().output).toFixed(1) : "—"
    return {
      hours,
      maxVal,
      peakHour: `${peakH.toString().padStart(2, "0")}:00`,
      troughHour: `${troughH.toString().padStart(2, "0")}:00`,
      avgLoad,
      ratio,
    }
  })

  // Multi-model spline trend data points
  const trendPoints = createMemo(() => {
    const activity = stats.latest?.activity ?? []
    const maxSteps = Math.max(1, ...activity.map((a) => a.steps))
    return {
      activity,
      maxSteps,
    }
  })

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
          {/* ==================== 1. 用量调度全景高级报表 ==================== */}
          <div class="usage-panorama-grid">
            {/* Card 1: 用量调度全景 + Radial Rays Sunburst Gauge */}
            <div class="usage-panorama-card">
              <div class="usage-panorama-header">
                <span class="usage-panorama-title">用量调度全景</span>
                <span class="text-11-regular text-v2-text-muted">周期: {range() === "all" ? "全部" : range()}</span>
              </div>
              <div class="usage-panorama-body">
                <div class="flex flex-col gap-1">
                  <span class="text-11-regular text-v2-text-muted">总消耗量</span>
                  <div class="flex items-baseline gap-1">
                    <span class="text-24-bold text-v2-text-base">{compact(totalTokensVal())}</span>
                    <span class="text-11-regular text-v2-text-muted">Tokens</span>
                  </div>
                  <div class="usage-tags-breakdown">
                    <span class="usage-tag-pill" style={{ color: "#3b82f6" }}>
                      入: {compact(tokenBreakdown().input)} ({tokenBreakdown().inputPct}%)
                    </span>
                    <span class="usage-tag-pill" style={{ color: "#10b981" }}>
                      出: {compact(tokenBreakdown().output)} ({tokenBreakdown().outputPct}%)
                    </span>
                    <span class="usage-tag-pill" style={{ color: "#8b5cf6" }}>
                      思: {compact(tokenBreakdown().reasoning)} ({tokenBreakdown().reasoningPct}%)
                    </span>
                  </div>
                  {/* Top Models breakdown */}
                  <div class="mt-3 flex flex-col gap-1">
                    <For each={sortedModels().slice(0, 3)}>
                      {(m, idx) => {
                        const pct = totalTokensVal() > 0 ? Math.round((tokenTotal(m.tokens) / totalTokensVal()) * 100) : 0
                        const color = MODEL_PALETTE[idx() % MODEL_PALETTE.length]
                        return (
                          <div class="flex items-center justify-between text-11-regular">
                            <div class="flex items-center gap-1.5 min-w-0">
                              <span class="w-2 h-2 rounded-full" style={{ background: color }} />
                              <span class="truncate max-w-[120px]" title={m.model.id}>
                                {m.model.id}
                              </span>
                            </div>
                            <span class="tabular-nums text-v2-text-muted">{compact(tokenTotal(m.tokens))} ({pct}%)</span>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </div>

                {/* Center SVG Radial Sunburst Gauge */}
                <div class="usage-sunburst-container">
                  <svg viewBox="0 0 140 140" class="w-full h-full">
                    <defs>
                      <linearGradient id="rayGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#10b981" />
                        <stop offset="50%" stop-color="#06b6d4" />
                        <stop offset="100%" stop-color="#3b82f6" />
                      </linearGradient>
                    </defs>
                    {/* Render 36 Radial Rays */}
                    {Array.from({ length: 36 }).map((_, i) => {
                      const angle = (i * 360) / 36
                      const rad = (angle * Math.PI) / 180
                      const rInner = 44
                      const rOuter = 44 + (i % 2 === 0 ? 18 : 12)
                      const x1 = 70 + rInner * Math.cos(rad)
                      const y1 = 70 + rInner * Math.sin(rad)
                      const x2 = 70 + rOuter * Math.cos(rad)
                      const y2 = 70 + rOuter * Math.sin(rad)
                      return (
                        <line
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke="url(#rayGradient)"
                          stroke-width={i % 2 === 0 ? "2.5" : "1.8"}
                          stroke-linecap="round"
                          opacity={0.7 + (i % 3) * 0.15}
                        />
                      )
                    })}
                    {/* Inner glowing circle */}
                    <circle cx="70" cy="70" r="38" fill="var(--v2-background-bg-layer-02)" stroke="var(--v2-border-border)" stroke-width="1.5" />
                  </svg>
                  <div class="usage-sunburst-center">
                    <span class="usage-sunburst-val">{compact(totalTokensVal())}</span>
                    <span class="usage-sunburst-sub">SUMMARY</span>
                  </div>
                </div>

                {/* Right Costs & Cache Savings */}
                <div class="flex flex-col gap-3 min-w-[120px] text-right">
                  <div>
                    <span class="text-11-regular text-v2-text-muted">预估支出</span>
                    <div class="text-18-bold text-v2-text-base">{format.money(totalCostVal())}</div>
                    <span class="text-10-regular text-v2-text-muted">
                      均次 ~{format.money((stats.latest?.steps ?? 0) > 0 ? totalCostVal() / stats.latest!.steps : 0)} / req
                    </span>
                  </div>
                  <div>
                    <span class="text-11-regular text-v2-text-muted">缓存节省</span>
                    <div class="text-16-bold text-emerald-500">+{format.money(cacheMetrics().savedAmount)}</div>
                    <span class="text-10-regular text-emerald-500">{cacheMetrics().hitRate}% 命中</span>
                  </div>
                  <div class="text-11-regular text-emerald-500 font-medium">✓ 网关调度正常</div>
                </div>
              </div>
            </div>

            {/* Card 2: 24小时活跃律动 (24h Activity Rhythm) */}
            <div class="usage-panorama-card">
              <div class="usage-panorama-header">
                <div class="flex items-center gap-1.5">
                  <Icon name="clock" size="small" />
                  <span class="usage-panorama-title">24小时活跃律动</span>
                </div>
                <div class="flex items-center gap-2 text-11-regular text-v2-text-muted">
                  <span>均次负载: {compact(hourlyActivity().avgLoad)}</span>
                  <span class="text-blue-500 font-medium">峰值: {hourlyActivity().peakHour}</span>
                </div>
              </div>
              {/* 24-column bar chart */}
              <div class="usage-rhythm-bars">
                <For each={hourlyActivity().hours}>
                  {(val, idx) => {
                    const heightPct = Math.max(4, Math.round((val / hourlyActivity().maxVal) * 100))
                    const isPeak = `${idx().toString().padStart(2, "0")}:00` === hourlyActivity().peakHour
                    return (
                      <div class="usage-rhythm-col" title={`${idx()}:00 - ${compact(val)} tokens`}>
                        <div
                          class={`usage-rhythm-bar-fill ${isPeak ? "usage-rhythm-bar-fill--peak" : ""}`}
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                    )
                  }}
                </For>
              </div>
              <div class="mt-2 flex items-center justify-between text-11-regular text-v2-text-muted">
                <span>入出倍率: {hourlyActivity().ratio} : 1</span>
                <span>低谷: {hourlyActivity().troughHour}</span>
              </div>
            </div>

            {/* Card 3: 效能指数 (Efficiency Index & Semicircular Arc Gauge) */}
            <div class="usage-panorama-card">
              <div class="usage-panorama-header">
                <div class="flex items-center gap-1.5">
                  <Icon name="bolt" size="small" />
                  <span class="usage-panorama-title">效能指数</span>
                </div>
                <span class="text-11-regular text-v2-text-muted">
                  ~{compact((stats.latest?.steps ?? 0) > 0 ? tokenBreakdown().reasoning / stats.latest!.steps : 0)} 思 / req
                </span>
              </div>
              {/* Semicircular Arc Gauge */}
              <div class="usage-arc-container">
                <svg viewBox="0 0 160 90" class="w-full h-[90px]">
                  <defs>
                    <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stop-color="#f59e0b" />
                      <stop offset="60%" stop-color="#10b981" />
                      <stop offset="100%" stop-color="#06b6d4" />
                    </linearGradient>
                  </defs>
                  {/* Arc Needle Ticks (180 deg to 0 deg) */}
                  {Array.from({ length: 25 }).map((_, i) => {
                    const angle = 180 + (i * 180) / 24
                    const rad = (angle * Math.PI) / 180
                    const rIn = 60
                    const rOut = 74
                    const x1 = 80 + rIn * Math.cos(rad)
                    const y1 = 85 + rIn * Math.sin(rad)
                    const x2 = 80 + rOut * Math.cos(rad)
                    const y2 = 85 + rOut * Math.sin(rad)
                    const tickPct = (i / 24) * 100
                    const isActive = tickPct <= cacheMetrics().hitRate
                    return (
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={isActive ? "url(#arcGrad)" : "var(--v2-border-border)"}
                        stroke-width="2.5"
                        stroke-linecap="round"
                        opacity={isActive ? 1 : 0.3}
                      />
                    )
                  })}
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-end pb-1 text-center">
                  <span class="text-10-regular text-emerald-500 font-medium">命中率: {cacheMetrics().hitRate}%</span>
                  <span class="text-18-bold text-v2-text-base tabular-nums">{compact(cacheMetrics().cachedTokens)}</span>
                  <span class="text-9-regular text-v2-text-muted tracking-wider">复用 TOKEN 规模</span>
                </div>
              </div>
              <div class="mt-2 flex items-center justify-between text-11-regular text-v2-text-muted">
                <span>未缓存输入: {compact(cacheMetrics().uncachedTokens)}</span>
                <span class="text-emerald-500 font-medium">+{format.money(cacheMetrics().savedAmount)} 节省</span>
              </div>
            </div>
          </div>

          {/* ==================== 2. Summary Metric Cards ==================== */}
          <div class="usage-cards mt-4">
            <div class="usage-card">
              <span class="usage-card-label">{language.t("settings.usage.card.cost")}</span>
              <span class="usage-card-value">{format.money(totalCostVal())}</span>
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

          {/* ==================== 3. Activity Heatmap & Trends ==================== */}
          <div class="usage-chart-grid mt-4">
            {/* Activity Heatmap Grid (GitHub style) */}
            <div class="usage-chart-card">
              <div class="usage-chart-header">
                <span class="usage-chart-title">Token 活动热力图</span>
                <div class="flex items-center gap-1 text-10-regular text-v2-text-muted">
                  <span>少</span>
                  <span class="usage-heatmap-day" data-level="1" />
                  <span class="usage-heatmap-day" data-level="2" />
                  <span class="usage-heatmap-day" data-level="3" />
                  <span class="usage-heatmap-day" data-level="4" />
                  <span>多</span>
                </div>
              </div>
              <div class="usage-heatmap-container no-scrollbar">
                <div class="usage-heatmap-weeks">
                  {Array.from({ length: 30 }).map((_, w) => (
                    <div class="usage-heatmap-week">
                      {Array.from({ length: 7 }).map((_, d) => {
                        const cellIndex = w * 7 + d
                        const activity = (stats.latest?.activity ?? [])[cellIndex]
                        const level = !activity || activity.steps === 0 ? "0" : activity.steps > 100 ? "4" : activity.steps > 40 ? "3" : activity.steps > 15 ? "2" : "1"
                        return (
                          <div
                            class="usage-heatmap-day"
                            data-level={level}
                            title={activity ? `${activity.date}: ${activity.steps} steps` : `Day ${cellIndex + 1}`}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* Daily Trend Curve */}
              <Show when={trendPoints().activity.length > 1}>
                <div class="mt-2 pt-2 border-t border-v2-border-subtle">
                  <div class="flex items-center justify-between text-10-regular text-v2-text-muted mb-1">
                    <span>活跃步数波形</span>
                    <span>峰值: {trendPoints().maxSteps} 步</span>
                  </div>
                  <svg viewBox="0 0 400 36" class="w-full h-9 overflow-visible">
                    <defs>
                      <linearGradient id="trendGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.3" />
                        <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0" />
                      </linearGradient>
                    </defs>
                    {(() => {
                      const act = trendPoints().activity
                      const max = trendPoints().maxSteps
                      const pts = act.map((item, idx) => {
                        const x = (idx / Math.max(1, act.length - 1)) * 400
                        const y = 32 - (item.steps / max) * 28
                        return { x, y }
                      })
                      const pathD = pts.reduce((acc, pt, i) => (i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`), "")
                      const areaD = `${pathD} L 400 34 L 0 34 Z`
                      return (
                        <>
                          <path d={areaD} fill="url(#trendGrad)" />
                          <path d={pathD} fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" />
                        </>
                      )
                    })()}
                  </svg>
                </div>
              </Show>
            </div>

            {/* Model Usage Donut Chart */}
            <div class="usage-chart-card">
              <div class="usage-chart-header">
                <span class="usage-chart-title">模型用量占比</span>
                <span class="text-11-regular text-v2-text-muted">{compact(totalTokensVal())} Tokens</span>
              </div>
              <div class="flex items-center justify-around gap-4 py-2">
                <div class="relative w-28 h-28 flex-shrink-0">
                  <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90">
                    {(() => {
                      let accumulated = 0
                      const total = Math.max(1, totalTokensVal())
                      return sortedModels().slice(0, 5).map((m, idx) => {
                        const val = tokenTotal(m.tokens)
                        const pct = (val / total) * 100
                        const dash = (pct * 251.2) / 100
                        const offset = 251.2 - (accumulated * 251.2) / 100
                        accumulated += pct
                        return (
                          <circle
                            cx="50"
                            cy="50"
                            r="40"
                            fill="transparent"
                            stroke={MODEL_PALETTE[idx % MODEL_PALETTE.length]}
                            stroke-width="14"
                            stroke-dasharray={`${dash} 251.2`}
                            stroke-dashoffset={offset}
                          />
                        )
                      })
                    })()}
                  </svg>
                  <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                    <span class="text-12-bold text-v2-text-base">{compact(totalTokensVal())}</span>
                    <span class="text-9-regular text-v2-text-muted">Tokens</span>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5 flex-1 min-w-0">
                  <For each={sortedModels().slice(0, 4)}>
                    {(m, idx) => {
                      const pct = totalTokensVal() > 0 ? Math.round((tokenTotal(m.tokens) / totalTokensVal()) * 100) : 0
                      return (
                        <div class="flex items-center justify-between text-11-regular">
                          <div class="flex items-center gap-1.5 min-w-0">
                            <span class="w-2 h-2 rounded-full" style={{ background: MODEL_PALETTE[idx() % MODEL_PALETTE.length] }} />
                            <span class="truncate max-w-[110px]" title={m.model.id}>{m.model.id}</span>
                          </div>
                          <span class="tabular-nums text-v2-text-muted">{pct}%</span>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>
            </div>
          </div>

          {/* ==================== 4. View Tab Selector: By Project vs By Model ==================== */}
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

          {/* ==================== Tab 1: By Project (with sessions sub-group) ==================== */}
          <Show when={viewTab() === "projects"}>
            <div class="usage-section">
              <div class="usage-section-row">
                <span class="usage-section-title">{language.t("settings.usage.section.projects")}</span>
                <span class="text-11-regular text-v2-text-text-muted">{projectGroups().length}</span>
              </div>

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
                  <For each={paginatedProjects()}>
                    {(group) => (
                      <button
                        type="button"
                        class="usage-table-row usage-table-row--click"
                        data-active={selectedProject() === group.projectID ? "" : undefined}
                        onClick={() => {
                          setSelectedProject(selectedProject() === group.projectID ? undefined : group.projectID)
                          setSessionPage(1)
                        }}
                      >
                        <span class="usage-cell-model" title={group.name}>{group.name}</span>
                        <span>{group.sessions}</span>
                        <span>{compact(group.tokens)}</span>
                        <span>{format.money(group.cost)}</span>
                      </button>
                    )}
                  </For>
                </div>
                <Pagination
                  current={projectPage()}
                  total={sortedProjects().length}
                  pageSize={projectPageSize()}
                  onPageChange={setProjectPage}
                  onPageSizeChange={setProjectPageSize}
                />
              </Show>

              {/* Nested Sessions Table under Projects */}
              <div class="usage-section usage-sessions-section">
                <div class="usage-section-row">
                  <div class="flex items-center gap-2">
                    <span class="usage-section-title">{language.t("settings.usage.section.sessions")}</span>
                    <Show when={selectedProject()}>
                      {(projectID) => (
                        <div class="flex items-center gap-1">
                          <span class="usage-project-badge">
                            {projectName(projectID())}
                            <button
                              type="button"
                              class="usage-badge-clear"
                              aria-label={language.t("common.clear")}
                              onClick={() => {
                                setSelectedProject(undefined)
                                setSessionPage(1)
                              }}
                            >
                              ✕
                            </button>
                          </span>
                        </div>
                      )}
                    </Show>
                  </div>
                  <span class="text-11-regular text-v2-text-text-muted">{sortedSessions().length}</span>
                </div>

                <Show
                  when={sortedSessions().length > 0}
                  fallback={<div class="usage-status">{language.t("settings.usage.empty")}</div>}
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
                        title={language.t("settings.usage.column.date")}
                        active={sessionSortKey() === "time"}
                        order={sessionSortOrder()}
                        align="right"
                        onClick={() => toggleSessionSort("time")}
                      />
                    </div>
                    <For each={paginatedSessions()}>
                      {(session) => (
                        <button
                          type="button"
                          class="usage-table-row usage-table-row--click"
                          onClick={() => openSession(session)}
                        >
                          <span class="usage-cell-model" title={session.title || session.id}>
                            {session.title || session.id}
                          </span>
                          <span class="usage-cell-model">
                            {session.model ? modelName(session.model) : "—"}
                          </span>
                          <span>{compact(tokenTotal(session.tokens))}</span>
                          <span>{format.money(session.cost)}</span>
                          <span>{format.time(session.time.updated)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                  <Pagination
                    current={sessionPage()}
                    total={sortedSessions().length}
                    pageSize={sessionPageSize()}
                    onPageChange={setSessionPage}
                    onPageSizeChange={setSessionPageSize}
                  />
                </Show>
              </div>
            </div>
          </Show>

          {/* ==================== Tab 2: By Model ==================== */}
          <Show when={viewTab() === "models"}>
            <div class="usage-section">
              <div class="usage-section-row">
                <span class="usage-section-title">{language.t("settings.usage.section.models")}</span>
                <span class="text-11-regular text-v2-text-text-muted">{stats.latest?.models.length ?? 0}</span>
              </div>
              <Show
                when={(stats.latest?.models.length ?? 0) > 0}
                fallback={<div class="usage-status">{language.t("settings.usage.empty")}</div>}
              >
                <div class="usage-table" data-columns="9">
                  <div class="usage-table-head">
                    <SortHeader
                      title={language.t("settings.usage.column.model")}
                      active={modelSortKey() === "model"}
                      order={modelSortOrder()}
                      onClick={() => toggleModelSort("model")}
                    />
                    <SortHeader
                      title={language.t("settings.usage.card.steps")}
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
                  <For each={paginatedModels()}>
                    {(m) => {
                      const total = tokenTotal(m.tokens)
                      const perStep = m.steps > 0 ? total / m.steps : 0
                      return (
                        <div class="usage-table-row">
                          <span class="usage-cell-model" title={modelName(m.model)}>
                            {modelName(m.model)}
                          </span>
                          <span>{m.steps}</span>
                          <span>{compact(m.tokens.input)}</span>
                          <span>{compact(m.tokens.output)}</span>
                          <span>{compact(m.tokens.reasoning)}</span>
                          <span>{compact(m.tokens.cache.read + m.tokens.cache.write)}</span>
                          <span>{compact(total)}</span>
                          <span>{compact(perStep)}</span>
                          <span>{format.money(m.cost)}</span>
                        </div>
                      )
                    }}
                  </For>
                </div>
                <Pagination
                  current={modelPage()}
                  total={sortedModels().length}
                  pageSize={modelPageSize()}
                  onPageChange={setModelPage}
                  onPageSizeChange={setModelPageSize}
                />
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  )
}

type SessionMessageRow = {
  id: string
  kind: "assistant" | "compaction"
  model?: string
  tokens?: TokenUsageInfo
  cost?: number
  time: number
}

function UsageSessionDialog(props: { session: SessionInfo; projectName: string }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const format = useUsageFormat()

  const [messages] = createResource(async () => {
    const list: SessionMessageInfo[] = []
    let cursor: string | undefined

    for (let page = 0; page < MESSAGE_PAGES; page++) {
      try {
        const result = await sdk.api.message.list(
          cursor
            ? { sessionID: props.session.id, limit: 100, cursor }
            : { sessionID: props.session.id, limit: 100, order: "asc" },
          { mediaRefs: false },
        )
        list.push(...result.data)
        cursor = result.cursor.next ?? undefined
        if (!cursor) break
      } catch {
        break
      }
    }
    return list
  })

  const messageRows = createMemo(() => {
    const list: SessionMessageRow[] = []
    for (const msg of messages.latest ?? []) {
      if (msg.type !== "assistant" && msg.type !== "compaction") continue
      const model = "model" in msg && msg.model ? modelName(msg.model) : undefined
      const tokens = "tokens" in msg ? msg.tokens : undefined
      const cost = "cost" in msg ? msg.cost : undefined
      list.push({
        id: msg.id,
        kind: msg.type,
        model,
        tokens,
        cost,
        time: msg.time.created,
      })
    }
    return list
  })

  const models = createMemo(() => {
    const byModel = new Map<
      string,
      { model: string; count: number; cost: number; tokens: TokenUsageInfo }
    >()

    for (const row of messageRows()) {
      if (!row.model) continue
      const existing = byModel.get(row.model) ?? {
        model: row.model,
        count: 0,
        cost: 0,
        tokens: zeroTokens(),
      }
      existing.count += 1
      existing.cost += row.cost ?? 0
      if (row.tokens) {
        existing.tokens.input += row.tokens.input
        existing.tokens.output += row.tokens.output
        existing.tokens.reasoning += row.tokens.reasoning
        existing.tokens.cache.read += row.tokens.cache.read
        existing.tokens.cache.write += row.tokens.cache.write
      }
      byModel.set(row.model, existing)
    }

    return [...byModel.values()]
  })

  return (
    <Dialog size="x-large" variant="settings" resizable maximizable>
      <DialogHeader>
        <DialogTitleGroup
          title={props.session.title || props.session.id}
          description={`${props.projectName} · ${format.money(props.session.cost)} · ${compact(tokenTotal(props.session.tokens))} 总 tokens`}
        />
      </DialogHeader>
      <DialogBody class="usage-dialog-body" style={{ padding: "8px 24px 16px" }}>
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
            <Show when={models().length > 0}>
              <div class="usage-section">
                <span class="usage-section-title">{language.t("settings.usage.dialog.models")}</span>
                <div class="usage-table" data-columns="7">
                  <div class="usage-table-head">
                    <span>{language.t("settings.usage.column.model")}</span>
                    <span>{language.t("settings.usage.column.messages")}</span>
                    <span>{language.t("settings.usage.tokens.input")}</span>
                    <span>{language.t("settings.usage.tokens.output")}</span>
                    <span>{language.t("settings.usage.tokens.reasoning")}</span>
                    <span>{language.t("settings.usage.tokens.cache")}</span>
                    <span>{language.t("settings.usage.card.cost")}</span>
                  </div>
                  <For each={models()}>
                    {(item) => (
                      <div class="usage-table-row">
                        <span class="usage-cell-model" title={item.model}>
                          {item.model}
                        </span>
                        <span>{item.count}</span>
                        <span>{compact(item.tokens.input)}</span>
                        <span>{compact(item.tokens.output)}</span>
                        <span>{compact(item.tokens.reasoning)}</span>
                        <span>{compact(item.tokens.cache.read + item.tokens.cache.write)}</span>
                        <span>{format.money(item.cost)}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <div class="usage-section">
              <div class="usage-section-row">
                <span class="usage-section-title">{language.t("settings.usage.dialog.messages")}</span>
                <span class="text-11-regular text-v2-text-text-muted">{messageRows().length}</span>
              </div>
              <Show
                when={messageRows().length > 0}
                fallback={<div class="usage-status">{language.t("settings.usage.dialog.empty")}</div>}
              >
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
                  <For each={messageRows()}>
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
                        <span class="usage-cell-model" title={row.model ?? "—"}>
                          {row.model ?? "—"}
                        </span>
                        <span>{row.tokens ? compact(row.tokens.input) : "—"}</span>
                        <span>{row.tokens ? compact(row.tokens.output) : "—"}</span>
                        <span>{row.tokens ? compact(row.tokens.reasoning) : "—"}</span>
                        <span>{row.cost === undefined ? "—" : format.money(row.cost)}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
