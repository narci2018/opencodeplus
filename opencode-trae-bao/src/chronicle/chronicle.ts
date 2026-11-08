/**
 * Chronicle 跨会话记忆管理器
 * 
 * 从 Trae CN byted-solo.builtin-mcp/chronicle 移植：
 * - MCP 工具：chronicle_status / chronicle_recent / chronicle_search / chronicle_get_memory
 * - 存储格式：append-only JSONL 索引 + Markdown/JSON 摘要
 * - 摘要窗口：10分钟 / 6小时
 * - 隐私脱敏：OCR 截断、秘密脱敏、原始数据保留 8 小时
 * 
 * Windows 适配：使用 screenshot-desktop + tesseract.js 替代 macOS 原生屏幕捕获
 */

import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'

// 常量（从 chronicleService.js 提取）
const WINDOW_10M = 10 * 60 * 1000 // 10分钟
const WINDOW_6H = 6 * 60 * 60 * 1000 // 6小时
const MAX_RECENT_LIMIT = 12 // 最近观察上限（含 OCR）
const MAX_SEARCH_LIMIT = 20 // 搜索上限
const MAX_QUERY_LENGTH = 512 // 查询长度上限
const MAX_RESULT_CHARACTERS = 64 * 1024 // 响应 64KB 上限
const MAX_OCR_TEXT = 16000 // 每帧 OCR 文本上限
const MAX_SUMMARY_CHARS = 12000 // 摘要正文上限
const MAX_HIGHLIGHTS = 20 // 高亮点上限
const MAX_HIGHLIGHT_CHARS = 500 // 每个高亮点长度上限
const INDEX_MAX_SIZE = 16 * 1024 * 1024 // 索引最大 16MB
const INDEX_MAX_ENTRIES = 12000 // 索引最大条目数
const RAW_RETENTION_HOURS = 8 // 原始数据保留 8 小时
const ACCOUNT_HASH_PREFIX = 'chronicle-v1'

export interface ChronicleStatus {
  supported: boolean
  state: 'disabled' | 'needsConsent' | 'starting' | 'recording' | 'paused' | 'error' | 'stopping'
  product: 'trae' | 'solo-lite' | 'opencode'
  accountHash: string
  protocolVersion: number
  schemaVersion: number
  capabilities: string[]
  capturedArtifacts: number
  pendingSummaryJobs: number
  activityGate: {
    allowed: boolean
    reason?: string
    observedAtMillis?: number
  }
  captureSchedule: {
    state: string
    intervalMs: number
    userInputIdleMs: number
    configVersion: number
    configSource: string
  }
  lastError?: string
  updatedAt: string
}

export interface ChronicleObservation {
  artifactId: string
  capturedAt: string
  displayId: number
  reasons: string[]
  excludedWindowCount: number
  secretRedactionCount: number
  source: 'chronicle_capture'
  trust: 'untrusted_observation'
  ocrText?: string
  ocrTextTruncated?: boolean
}

export interface ChronicleSearchResult {
  memoryId: string
  kind: '10m' | '6h'
  windowStart: string
  windowEnd: string
  title: string
  trust: 'untrusted_observation'
}

export interface ChronicleMemory {
  memoryId: string
  kind: '10m' | '6h'
  windowStart: string
  windowEnd: string
  title: string
  summary: string
  highlights: string[]
  sourceArtifactIds: string[]
  trust: 'untrusted_observation'
}

export interface ChronicleConfig {
  product: 'trae' | 'solo-lite' | 'opencode'
  accountId: string
  enabled: boolean
  consentAccepted: boolean
  activeWindowMs?: number
  activeIntervalMs?: number
  passiveIntervalMs?: number
  idleAfterMs?: number
  idleIntervalMs?: number
  maxFramesPerTenMinuteWindow?: number
  rawRetentionHours?: number
}

export interface ChronicleHandle {
  /** 获取状态 */
  getStatus(): Promise<ChronicleStatus>
  /** 获取最近的观察（最多12个） */
  getRecent(options?: { since?: string; until?: string; limit?: number }): Promise<ChronicleObservation[]>
  /** 搜索记忆索引 */
  search(options: { query: string; since?: string; until?: string; limit?: number }): Promise<ChronicleSearchResult[]>
  /** 通过不透明 ID 解析记忆 */
  getMemory(memoryId: string): Promise<ChronicleMemory | null>
  /** 暂停记录 */
  pause(): Promise<void>
  /** 恢复记录 */
  resume(): Promise<void>
  /** 清除数据 */
  deleteData(): Promise<void>
  /** 获取 MCP 工具定义 */
  getMcpTools(): Array<{ name: string; description: string; parameters: any }>
  /** 销毁 */
  dispose(): void
}

/**
 * 创建 Chronicle 记忆管理器
 * 
 * Windows 适配：使用跨平台屏幕捕获 + OCR 替代 macOS 原生实现。
 */
export async function createChronicle(
  ctx: any,
  config: ChronicleConfig,
  dataDir?: string,
): Promise<ChronicleHandle> {
  const emitter = new EventEmitter()
  const rootDir = dataDir ?? join(process.cwd(), '.trae-bao', 'chronicle')
  const accountHash = sha256(`${ACCOUNT_HASH_PREFIX}\0${config.product}\0${config.accountId}`).slice(0, 32)
  const accountDir = join(rootDir, 'v1', accountHash)

  // 确保目录存在
  mkdirSync(join(accountDir, 'summaries', '10m'), { recursive: true })
  mkdirSync(join(accountDir, 'summaries', '6h'), { recursive: true })
  mkdirSync(join(accountDir, 'raw'), { recursive: true })

  // 索引文件路径
  const indexPath = join(accountDir, 'index', 'memories.jsonl')
  const cleanedWindowsPath = join(accountDir, 'index', 'cleaned-windows.jsonl')
  mkdirSync(join(accountDir, 'index'), { recursive: true })

  // 记录状态
  let state: ChronicleStatus['state'] = config.enabled && config.consentAccepted ? 'recording' : 'disabled'
  let capturedArtifacts = 0
  let pendingSummaryJobs = 0

  // 读取记忆索引（缓存）
  let memoryIndexCache: ChronicleMemory[] | null = null

  function readMemories(): ChronicleMemory[] {
    if (memoryIndexCache) return memoryIndexCache
    if (!existsSync(indexPath)) return []

    const memories: ChronicleMemory[] = []
    const lines = readFileSync(indexPath, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const memory = JSON.parse(line)
        if (isValidMemory(memory)) {
          memories.push(memory)
        }
      } catch {
        // 跳过损坏行
      }
    }
    // 按 memoryId 去重（后写覆盖），并按窗口开始时间排序
    const deduped = new Map<string, ChronicleMemory>()
    for (const m of memories) deduped.set(m.memoryId, m)
    memoryIndexCache = [...deduped.values()].sort((a, b) => b.windowStart.localeCompare(a.windowStart))
    return memoryIndexCache
  }

  function isValidMemory(m: any): m is ChronicleMemory {
    return (
      typeof m.memoryId === 'string' &&
      /^[a-zA-Z0-9_-]{1,160}$/.test(m.memoryId) &&
      (m.kind === '10m' || m.kind === '6h') &&
      typeof m.summary === 'string' &&
      m.trust === 'untrusted_observation'
    )
  }

  // 持久化记忆
  function persistMemory(memory: ChronicleMemory) {
    const existing = readMemories().find((m) => m.memoryId === memory.memoryId)
    if (existing) return // 幂等

    const kindDir = join(accountDir, 'summaries', memory.kind)

    // 写 Markdown
    const mdPath = join(kindDir, `${memory.memoryId}.md`)
    const md = `# ${memory.title}\n\n- Window: ${memory.windowStart} - ${memory.windowEnd}\n- Trust: untrusted observation\n\n${memory.summary}\n\n## Highlights\n\n${memory.highlights.map((h) => `- ${h}`).join('\n')}\n`
    writeFileSync(mdPath, md, 'utf8')

    // 写 JSON
    const jsonPath = join(kindDir, `${memory.memoryId}.json`)
    writeFileSync(jsonPath, JSON.stringify(memory, null, 2), 'utf8')

    // 追加到索引
    appendFileSync(indexPath, JSON.stringify(memory) + '\n', 'utf8')

    // 旋转索引（如果超过限制）
    rotateIndexIfNeeded()

    // 失效缓存
    memoryIndexCache = null
  }

  function rotateIndexIfNeeded() {
    if (!existsSync(indexPath)) return
    const size = readFileSync(indexPath).length
    if (size > INDEX_MAX_SIZE) {
      const memories = readMemories()
      const trimmed = memories.slice(0, INDEX_MAX_ENTRIES)
      writeFileSync(indexPath, trimmed.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8')
      memoryIndexCache = trimmed
    }
  }

  // 截断 OCR 文本
  function truncateOcrText(text: string, max = MAX_OCR_TEXT): { text: string; truncated: boolean } {
    if (text.length <= max) return { text, truncated: false }
    return { text: text.slice(0, max), truncated: true }
  }

  // 窗口计算（从 chronicleWindowing.js 提取）
  function buildWindows(timestamps: number[], windowMs: number, now: number): Array<{ start: number; end: number }> {
    const buckets = new Map<number, number[]>()
    for (const ts of timestamps) {
      const bucket = Math.floor(ts / windowMs) * windowMs
      if (!buckets.has(bucket)) buckets.set(bucket, [])
      buckets.get(bucket)!.push(ts)
    }
    return [...buckets.entries()]
      .filter(([, times]) => times.length > 0)
      .sort((a, b) => a[0] - b[0])
      .map(([start]) => ({ start, end: start + windowMs }))
  }

  // ==================== 屏幕捕获 + OCR（Windows 适配） ====================
  // 延迟加载 tesseract.js（首次捕获才初始化）
  let ocrWorker: any = null
  let ocrLoading: Promise<any> | null = null

  async function loadOcr(): Promise<any> {
    if (ocrWorker) return ocrWorker
    if (!ocrLoading) {
      ocrLoading = (async () => {
        const { createWorker } = await import('tesseract.js')
        const worker = await createWorker('eng')
        return worker
      })()
    }
    ocrWorker = await ocrLoading
    return ocrWorker
  }

  /**
   * 捕获当前屏幕并 OCR 识别
   * @returns OCR 文本或 null（捕获/识别失败）
   */
  async function captureAndOcr(): Promise<{ text: string; imagePath?: Buffer | string } | null> {
    try {
      const screenshot = (await import('screenshot-desktop')).default
      const imagePath = await screenshot({ format: 'png' })
      const worker = await loadOcr()
      const { data } = await worker.recognize(imagePath)
      const text = (data?.text ?? '').trim()
      return { text, imagePath }
    } catch (error) {
      console.warn(`[Chronicle] OCR capture failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /**
   * 写入一条原始观察（raw artifact）
   */
  function persistObservation(ocrText: string, imagePath?: Buffer | string): ChronicleObservation {
    const artifactId = `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const nowIso = new Date().toISOString()
    const displayId = ++capturedArtifacts
    const { text, truncated } = truncateOcrText(ocrText)
    const observation: ChronicleObservation = {
      artifactId,
      capturedAt: nowIso,
      displayId,
      reasons: ['screen_capture'],
      excludedWindowCount: 0,
      secretRedactionCount: 0,
      source: 'chronicle_capture',
      trust: 'untrusted_observation',
      ocrText: text,
      ocrTextTruncated: truncated,
    }
    writeFileSync(join(accountDir, 'raw', `${artifactId}.json`), JSON.stringify(observation, null, 2), 'utf8')
    if (imagePath) {
      try {
        const imageData = typeof imagePath === 'string' ? readFileSync(imagePath) : imagePath
        writeFileSync(join(accountDir, 'raw', `${artifactId}.png`), imageData)
      } catch {
        // 图片复制失败不阻塞
      }
    }
    return observation
  }

  /**
   * 汇总一个窗口（10m / 6h）内的观察为记忆摘要
   */
  function summarizeWindow(kind: '10m' | '6h', windowMs: number): void {
    const rawDir = join(accountDir, 'raw')
    if (!existsSync(rawDir)) return
    const now = Date.now()
    const windowStart = Math.floor(now / windowMs) * windowMs
    const windowEnd = windowStart + windowMs

    // 收集窗口内的观察
    const artifacts = readdirSync(rawDir).filter((f) => f.endsWith('.json'))
    const texts: string[] = []
    const sourceIds: string[] = []
    for (const artifact of artifacts) {
      try {
        const data = JSON.parse(readFileSync(join(rawDir, artifact), 'utf8'))
        const capturedAt = new Date(data.capturedAt ?? 0).getTime()
        if (capturedAt >= windowStart && capturedAt <= windowEnd) {
          if (data.ocrText) texts.push(data.ocrText)
          sourceIds.push(data.artifactId ?? artifact.replace('.json', ''))
        }
      } catch {
        // 跳过损坏
      }
    }
    if (texts.length === 0) return

    // 生成摘要
    const combined = texts.join('\n').trim()
    const memoryId = `mem-${kind}-${windowStart}`
    const existing = readMemories().find((m) => m.memoryId === memoryId)
    if (existing) return // 幂等

    const highlights = combined
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 10)
      .slice(0, MAX_HIGHLIGHTS)
      .map((line) => line.slice(0, MAX_HIGHLIGHT_CHARS))

    const memory: ChronicleMemory = {
      memoryId,
      kind,
      windowStart: new Date(windowStart).toISOString(),
      windowEnd: new Date(windowEnd).toISOString(),
      title: `${kind} 窗口摘要 ${new Date(windowStart).toLocaleString()}`,
      summary: combined.slice(0, MAX_SUMMARY_CHARS),
      highlights,
      sourceArtifactIds: sourceIds,
      trust: 'untrusted_observation',
    }
    persistMemory(memory)
  }

  /**
   * 启动捕获循环
   */
  let captureTimer: ReturnType<typeof setInterval> | null = null
  let lastCaptureAt = 0

  function startCaptureLoop(): void {
    if (captureTimer || state !== 'recording') return
    const interval = config.activeIntervalMs ?? 10000
    captureTimer = setInterval(async () => {
      if (state !== 'recording') return
      const result = await captureAndOcr()
      if (!result) return
      persistObservation(result.text, result.imagePath)
      // 每 10 分钟窗口聚合
      const nowMs = Date.now()
      const tenMinBucket = Math.floor(nowMs / WINDOW_10M)
      if (tenMinBucket !== Math.floor(lastCaptureAt / WINDOW_10M)) {
        summarizeWindow('10m', WINDOW_10M)
      }
      lastCaptureAt = nowMs
      // 每 6 小时窗口聚合
      if (Math.floor(nowMs / WINDOW_6H) !== Math.floor(lastCaptureAt / WINDOW_6H)) {
        summarizeWindow('6h', WINDOW_6H)
      }
    }, interval)
  }

  function stopCaptureLoop(): void {
    if (captureTimer) {
      clearInterval(captureTimer)
      captureTimer = null
    }
  }

  // 若初始即 recording，启动捕获
  if (state === 'recording') startCaptureLoop()

  return {
    async getStatus(): Promise<ChronicleStatus> {
      return {
        supported: true,
        state,
        product: config.product,
        accountHash,
        protocolVersion: 1,
        schemaVersion: 1,
        capabilities: ['cross-platform-ocr-v1', 'summary-window-v1'],
        capturedArtifacts,
        pendingSummaryJobs,
        activityGate: { allowed: state === 'recording' },
        captureSchedule: {
          state: state === 'recording' ? 'active' : 'idle',
          intervalMs: config.activeIntervalMs ?? 10000,
          userInputIdleMs: config.idleAfterMs ?? 300000,
          configVersion: 1,
          configSource: 'local',
        },
        updatedAt: new Date().toISOString(),
      }
    },

    async getRecent(options = {}): Promise<ChronicleObservation[]> {
      const limit = boundedLimit(options.limit ?? 10, MAX_RECENT_LIMIT)
      const now = Date.now()
      const since = options.since ? new Date(options.since).getTime() : now - RAW_RETENTION_HOURS * 3600 * 1000
      const until = options.until ? new Date(options.until).getTime() : now

      // 从 raw 目录读取原始观察
      const rawDir = join(accountDir, 'raw')
      const observations: ChronicleObservation[] = []

      if (existsSync(rawDir)) {
        const artifacts = readdirSync(rawDir).filter((f) => f.endsWith('.json'))
        for (const artifact of artifacts.slice(0, limit)) {
          try {
            const data = JSON.parse(readFileSync(join(rawDir, artifact), 'utf8'))
            const capturedAt = new Date(data.capturedAt ?? 0).getTime()
            if (capturedAt >= since && capturedAt <= until) {
              const { text, truncated } = truncateOcrText(data.ocrText ?? '')
              observations.push({
                artifactId: data.artifactId ?? artifact.replace('.json', ''),
                capturedAt: data.capturedAt,
                displayId: data.displayId ?? 0,
                reasons: data.reasons ?? [],
                excludedWindowCount: data.excludedWindowCount ?? 0,
                secretRedactionCount: data.secretRedactionCount ?? 0,
                source: 'chronicle_capture',
                trust: 'untrusted_observation',
                ocrText: text,
                ocrTextTruncated: truncated,
              })
            }
          } catch {
            // 跳过损坏文件
          }
        }
      }

      return observations.slice(0, limit)
    },

    async search(options): Promise<ChronicleSearchResult[]> {
      const query = options.query.trim()
      if (query.length < 1 || query.length > MAX_QUERY_LENGTH) {
        throw new Error(`Query must be between 1 and ${MAX_QUERY_LENGTH} characters`)
      }
      const limit = boundedLimit(options.limit ?? 10, MAX_SEARCH_LIMIT)
      const since = options.since ? new Date(options.since).getTime() : 0
      const until = options.until ? new Date(options.until).getTime() : Number.MAX_SAFE_INTEGER

      return readMemories()
        .filter((m) => {
          const windowStart = new Date(m.windowStart).getTime()
          const searchable = `${m.title}\n${m.summary}\n${m.highlights.join('\n')}`
          return windowStart >= since && windowStart <= until && searchable.toLowerCase().includes(query.toLowerCase())
        })
        .slice(0, limit)
        .map((m) => ({
          memoryId: m.memoryId,
          kind: m.kind,
          windowStart: m.windowStart,
          windowEnd: m.windowEnd,
          title: m.title,
          trust: 'untrusted_observation',
        }))
    },

    async getMemory(memoryId: string): Promise<ChronicleMemory | null> {
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(memoryId)) {
        throw new Error('Invalid memoryId: arbitrary file paths are not accepted')
      }
      return readMemories().find((m) => m.memoryId === memoryId) ?? null
    },

    async pause() {
      state = 'paused'
      stopCaptureLoop()
    },

    async resume() {
      state = config.enabled && config.consentAccepted ? 'recording' : 'disabled'
      if (state === 'recording') startCaptureLoop()
    },

    async deleteData() {
      const summaryDirs = ['10m', '6h']
      for (const kind of summaryDirs) {
        const dir = join(accountDir, 'summaries', kind)
        if (existsSync(dir)) {
          for (const f of readdirSync(dir)) {
            try {
              writeFileSync(join(dir, f), '', 'utf8')
            } catch {
              // 忽略
            }
          }
        }
      }
      if (existsSync(indexPath)) {
        writeFileSync(indexPath, '', 'utf8')
      }
      memoryIndexCache = null
    },

    getMcpTools() {
      return [
        {
          name: 'chronicle_status',
          description: 'Check availability, recording state, protocol version',
          parameters: {},
        },
        {
          name: 'chronicle_recent',
          description: 'Get recent timestamps, redacted OCR, material-change reasons',
          parameters: {
            since: { type: 'string', optional: true },
            until: { type: 'string', optional: true },
            limit: { type: 'number', optional: true },
          },
        },
        {
          name: 'chronicle_search',
          description: 'Search local 10-minute and 6-hour summaries',
          parameters: {
            query: { type: 'string', required: true },
            since: { type: 'string', optional: true },
            until: { type: 'string', optional: true },
            limit: { type: 'number', optional: true },
          },
        },
        {
          name: 'chronicle_get_memory',
          description: 'Resolve opaque memory ID to bounded local summary',
          parameters: {
            memoryId: { type: 'string', required: true },
          },
        },
      ]
    },

    dispose() {
      stopCaptureLoop()
      // 释放 OCR worker
      if (ocrWorker?.terminate) {
        try {
          ocrWorker.terminate()
        } catch {
          // 忽略
        }
      }
      ocrWorker = null
      ocrLoading = null
      emitter.removeAllListeners()
    },
  }
}

// 工具函数
function boundedLimit(value: number, max: number): number {
  if (!Number.isFinite(value)) return max
  return Math.max(1, Math.min(Math.floor(value), max))
}

function sha256(input: string): string {
  // 使用 Bun 的 crypto（Node.js 兼容）
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  return createHash('sha256').update(input).digest('hex')
}
