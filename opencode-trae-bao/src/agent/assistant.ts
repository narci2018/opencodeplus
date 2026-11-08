/**
 * 双助理系统（全局助理 + 项目助理）
 * 
 * 从 Trae CN solo-lite 工作台移植：
 * - 全局助理（default）：跨项目记忆与统筹
 * - 项目助理（project）：单项目拆解与并行执行
 * 
 * 多任务并行核心：
 * - ConcurrencyLimiter：并行队列原语
 * - TaskQueue：防抖 + 节流
 * - 任务状态机：working → completed | failed | cancelled | input_required
 */

import { EventEmitter } from 'node:events'

// ==================== 类型定义 ====================

export type AssistantType = 'default' | 'project'

export interface AssistantTarget {
  assistantType: AssistantType
  targetId?: string
}

export interface AssistantProfile {
  assistantType: AssistantType
  targetId?: string
  revision: number
  avatar: { type: 'default' }
  customName?: string
  name?: string
  employeeNo?: string
  formattedEmployeeNo?: string
  originEmployeeNo?: string
  updatedAt?: number
}

export type TaskStatus = 'working' | 'completed' | 'failed' | 'cancelled' | 'input_required'

export interface TaskInfo {
  taskId: string
  status: TaskStatus
  title?: string
  createdAt: number
  updatedAt: number
  result?: any
  error?: string
  requiresInput?: boolean
}

export interface TaskListOptions {
  limit?: number
  offset?: number
}

// ==================== ConcurrencyLimiter ====================

/**
 * 并行队列原语（从 solo-lite 工作台提取）
 * 控制最大并行度，任务完成后自动消费队列
 */
export class ConcurrencyLimiter {
  private maxDegreeOfParallelism: number
  private outstandingPromises: Array<() => Promise<void>> = []
  private runningPromises = 0
  private onDrained?: () => void

  constructor(maxDegreeOfParallelism: number) {
    this.maxDegreeOfParallelism = maxDegreeOfParallelism
  }

  queue(factory: () => Promise<void>): void {
    this.outstandingPromises.push(factory)
    this.consume()
  }

  private consume(): void {
    while (
      this.outstandingPromises.length > 0 &&
      this.runningPromises < this.maxDegreeOfParallelism
    ) {
      const factory = this.outstandingPromises.shift()!
      this.runningPromises++
      Promise.resolve()
        .then(factory)
        .finally(() => {
          this.runningPromises--
          this.consume()
          if (this.outstandingPromises.length === 0 && this.runningPromises === 0) {
            this.onDrained?.()
          }
        })
    }
  }

  whenIdle(): Promise<void> {
    if (this.outstandingPromises.length === 0 && this.runningPromises === 0) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.onDrained = resolve
    })
  }

  get size(): number {
    return this.outstandingPromises.length + this.runningPromises
  }
}

// ==================== TaskQueue ====================

/**
 * 防抖 + 节流队列（从 solo-lite 工作台提取）
 */
export class TaskQueue {
  private delayer: Debouncer
  private throttler: Throttler

  constructor(delayMs: number) {
    this.delayer = new Debouncer(delayMs)
    this.throttler = new Throttler()
  }

  trigger(fn: () => void): void {
    this.delayer.trigger(() => this.throttler.queue(fn))
  }
}

class Debouncer {
  private timer?: ReturnType<typeof setTimeout>

  constructor(private delayMs: number) {}

  trigger(fn: () => void): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(fn, this.delayMs)
  }
}

class Throttler {
  private tasks: Array<() => void> = []
  private running = false

  queue(fn: () => void): void {
    this.tasks.push(fn)
    if (!this.running) {
      this.running = true
      this.process()
    }
  }

  private process(): void {
    const fn = this.tasks.shift()
    if (!fn) {
      this.running = false
      return
    }
    Promise.resolve().then(fn).then(() => this.process())
  }
}

// ==================== 任务状态机 ====================

/**
 * 任务状态机
 * working → completed | failed | cancelled | input_required
 * input_required → completed | failed | cancelled
 */
export class TaskStateMachine {
  private status: TaskStatus = 'working'
  private listeners = new Set<(status: TaskStatus) => void>()

  constructor() {}

  get current(): TaskStatus {
    return this.status
  }

  isTerminal(): boolean {
    return ['completed', 'failed', 'cancelled'].includes(this.status)
  }

  transition(next: TaskStatus): boolean {
    // 允许的状态转换
    const validTransitions: Record<TaskStatus, TaskStatus[]> = {
      working: ['completed', 'failed', 'cancelled', 'input_required'],
      input_required: ['completed', 'failed', 'cancelled'],
      completed: [],
      failed: [],
      cancelled: [],
    }

    if (!validTransitions[this.status].includes(next)) {
      return false
    }

    this.status = next
    this.listeners.forEach((fn) => fn(next))
    return true
  }

  onTransition(callback: (status: TaskStatus) => void): void {
    this.listeners.add(callback)
  }

  dispose(): void {
    this.listeners.clear()
  }
}

// ==================== 助理档案存储 ====================

/**
 * 助理档案存储（从 assistantProfileStore 提取）
 * - default：全局助理 → key "default"
 * - project：项目助理 → key "project:<targetId>"
 * - 最大保留 64 个目标
 */
export class AssistantProfileStore {
  private profiles = new Map<string, AssistantProfile>()
  private maxTargets = 64

  constructor(private storageDir?: string) {}

  private key(target: AssistantTarget): string {
    return target.assistantType === 'default' ? 'default' : `project:${target.targetId}`
  }

  getSnapshot(): Map<string, AssistantProfile> {
    return new Map(this.profiles)
  }

  getProfile(target: AssistantTarget): AssistantProfile | undefined {
    return this.profiles.get(this.key(target))
  }

  updateProfile(target: AssistantTarget, patch: Partial<AssistantProfile>): AssistantProfile {
    const key = this.key(target)
    const existing = this.profiles.get(key) ?? {
      assistantType: target.assistantType,
      targetId: target.targetId,
      revision: 0,
      avatar: { type: 'default' },
    }

    const updated: AssistantProfile = {
      ...existing,
      ...patch,
      revision: existing.revision + 1,
      updatedAt: Date.now(),
    }

    // 名称校验（1-20字符，NFC规范化）
    if (updated.name !== undefined) {
      updated.name = updated.name.normalize('NFC').slice(0, 20)
    }

    this.profiles.set(key, updated)

    // 超出限制时驱逐最旧的
    if (this.profiles.size > this.maxTargets) {
      const oldest = [...this.profiles.entries()].sort((a, b) => {
        return (a[1].updatedAt ?? 0) - (b[1].updatedAt ?? 0)
      })[0]
      this.profiles.delete(oldest[0])
    }

    return updated
  }

  invalidate(target: AssistantTarget): void {
    this.profiles.delete(this.key(target))
  }

  resolveName(profile: AssistantProfile, fallback: string): string {
    return profile.customName || profile.name || fallback
  }
}

// ==================== 任务管理器 ====================

/**
 * 任务管理器（多任务并行）
 * 管理任务生命周期，支持并行执行和进度查询
 */
export class TaskManager {
  private tasks = new Map<string, TaskInfo>()
  private stateMachines = new Map<string, TaskStateMachine>()
  private emitter = new EventEmitter()
  private limiter: ConcurrencyLimiter

  constructor(maxParallel: number = 4) {
    this.limiter = new ConcurrencyLimiter(maxParallel)
  }

  createTask(title?: string): string {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    const task: TaskInfo = {
      taskId,
      status: 'working',
      title,
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(taskId, task)
    this.stateMachines.set(taskId, new TaskStateMachine())
    this.emitter.emit('task-created', task)
    return taskId
  }

  getTask(taskId: string): TaskInfo | undefined {
    return this.tasks.get(taskId)
  }

  listTasks(options: TaskListOptions = {}): TaskInfo[] {
    const tasks = [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
    const offset = options.offset ?? 0
    const limit = options.limit ?? 50
    return tasks.slice(offset, offset + limit)
  }

  /**
   * 执行任务（并行）
   * 使用 ConcurrencyLimiter 控制并行度
   */
  async executeTask(
    taskId: string,
    fn: () => Promise<any>,
  ): Promise<any> {
    const stateMachine = this.stateMachines.get(taskId)
    const task = this.tasks.get(taskId)
    if (!stateMachine || !task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    this.limiter.queue(async () => {
      try {
        const result = await fn()
        task.result = result
        task.updatedAt = Date.now()
        stateMachine.transition('completed')
        task.status = 'completed'
        this.emitter.emit('task-completed', task)
      } catch (error) {
        task.error = error instanceof Error ? error.message : String(error)
        task.updatedAt = Date.now()
        stateMachine.transition('failed')
        task.status = 'failed'
        this.emitter.emit('task-failed', task)
      }
    })

    return this.limiter.whenIdle().then(() => task.result)
  }

  /**
   * 要求用户输入
   */
  requestInput(taskId: string, prompt: string): void {
    const stateMachine = this.stateMachines.get(taskId)
    const task = this.tasks.get(taskId)
    if (!stateMachine || !task) return
    stateMachine.transition('input_required')
    task.status = 'input_required'
    task.requiresInput = true
    task.updatedAt = Date.now()
    this.emitter.emit('task-input-required', task, prompt)
  }

  cancelTask(taskId: string): boolean {
    const stateMachine = this.stateMachines.get(taskId)
    const task = this.tasks.get(taskId)
    if (!stateMachine || !task) return false
    if (stateMachine.isTerminal()) return false
    stateMachine.transition('cancelled')
    task.status = 'cancelled'
    task.updatedAt = Date.now()
    this.emitter.emit('task-cancelled', task)
    return true
  }

  onEvent(callback: (event: string, task: TaskInfo, data?: any) => void): void {
    this.emitter.on('task-created', (t: TaskInfo) => callback('created', t))
    this.emitter.on('task-completed', (t: TaskInfo) => callback('completed', t))
    this.emitter.on('task-failed', (t: TaskInfo) => callback('failed', t))
    this.emitter.on('task-cancelled', (t: TaskInfo) => callback('cancelled', t))
    this.emitter.on('task-input-required', (t: TaskInfo, p: string) => callback('input-required', t, p))
  }

  dispose(): void {
    this.tasks.clear()
    this.stateMachines.clear()
    this.emitter.removeAllListeners()
  }
}

// ==================== 助理管理器 ====================

/**
 * 助理管理器（双助理模式）
 * - 全局助理：跨项目，key = "default"
 * - 项目助理：单项目，key = "project:<id>"
 *
 * 接入 opencode 运行时：
 * - 子任务通过 ctx.session.create + ctx.session.prompt 派发到真实 agent 会话
 * - 本地 Promise 队列作为降级（无 session 域时）
 */
export class AssistantManager {
  private profiles: AssistantProfileStore
  private taskManager: TaskManager
  private emitter = new EventEmitter()
  private session?: any // opencode SessionDomain（可选）

  constructor(options: { maxParallel?: number; storageDir?: string; session?: any } = {}) {
    this.profiles = new AssistantProfileStore(options.storageDir)
    this.taskManager = new TaskManager(options.maxParallel ?? 4)
    this.session = options.session
  }

  /**
   * 获取助理档案
   */
  getProfile(target: AssistantTarget): AssistantProfile {
    const existing = this.profiles.getProfile(target)
    if (existing) return existing
    return this.profiles.updateProfile(target, {})
  }

  /**
   * 更新助理档案
   */
  updateProfile(target: AssistantTarget, patch: Partial<AssistantProfile>): AssistantProfile {
    return this.profiles.updateProfile(target, patch)
  }

  /**
   * 解析助理名称
   */
  resolveName(target: AssistantTarget, fallback: string): string {
    const profile = this.profiles.getProfile(target)
    return profile ? this.profiles.resolveName(profile, fallback) : fallback
  }

  /**
   * 向助理派发任务（支持并行）
   */
  async dispatchTask(
    target: AssistantTarget,
    fn: () => Promise<any>,
    options: { title?: string } = {},
  ): Promise<any> {
    const taskId = this.taskManager.createTask(options.title)
    return this.taskManager.executeTask(taskId, fn)
  }

  /**
   * 通过 opencode 子会话派发 prompt（接入 agent 运行时）
   * 创建 trae-bao 子会话 → 注入 prompt → 返回 sessionID
   * 无 session 域时降级为本地 Promise
   */
  async dispatchPrompt(
    target: AssistantTarget,
    prompt: string,
    options: { title?: string; agent?: string; parentID?: string } = {},
  ): Promise<{ sessionID: string; taskId: string }> {
    const taskId = this.taskManager.createTask(options.title ?? prompt.slice(0, 40))
    if (!this.session?.create) {
      // 降级：本地直接完成
      const task = this.taskManager.getTask(taskId)
      if (task) {
        task.result = { degraded: true, prompt }
        task.status = 'completed'
        task.updatedAt = Date.now()
      }
      return { sessionID: '', taskId }
    }

    try {
      const info = await this.session.create({
        agent: options.agent ?? 'trae-bao',
        parentID: options.parentID,
        title: options.title,
      })
      const sessionID = info.id
      await this.session.prompt({
        sessionID,
        text: prompt,
        delivery: 'steer',
      })
      const task = this.taskManager.getTask(taskId)
      if (task) {
        task.result = { sessionID }
        task.updatedAt = Date.now()
        task.status = 'working' // 会话运行中，任务保持 working
      }
      this.emitter.emit('task-dispatched', taskId, { sessionID })
      return { sessionID, taskId }
    } catch (error) {
      const task = this.taskManager.getTask(taskId)
      if (task) {
        task.error = error instanceof Error ? error.message : String(error)
        task.status = 'failed'
        task.updatedAt = Date.now()
      }
      throw error
    }
  }

  /**
   * 查询会话进度
   */
  async getSessionProgress(sessionID: string): Promise<any> {
    if (!this.session?.get) return null
    try {
      return await this.session.get(sessionID)
    } catch {
      return null
    }
  }

  /**
   * 批量派发任务（并行）
   */
  async dispatchParallel(
    target: AssistantTarget,
    tasks: Array<() => Promise<any>>,
    options: { title?: string; maxParallel?: number } = {},
  ): Promise<any[]> {
    const limiter = new ConcurrencyLimiter(options.maxParallel ?? tasks.length)
    const results: any[] = new Array(tasks.length)

    for (let i = 0; i < tasks.length; i++) {
      const index = i
      limiter.queue(async () => {
        results[index] = await this.dispatchTask(target, tasks[index], options)
      })
    }

    await limiter.whenIdle()
    return results
  }

  /**
   * 处理 IM 消息
   */
  async handleIncomingMessage(message: any): Promise<void> {
    this.emitter.emit('message', message)
    // 根据消息内容路由到对应助理
    const target: AssistantTarget = { assistantType: 'default' }
    this.emitter.emit('assistant-message', target, message)
  }

  getTaskManager(): TaskManager {
    return this.taskManager
  }

  onEvent(callback: (event: string, data: any) => void): void {
    this.emitter.on('message', (m) => callback('message', m))
    this.emitter.on('assistant-message', (t, m) => callback('assistant-message', { target: t, message: m }))
  }

  dispose(): void {
    this.taskManager.dispose()
    this.emitter.removeAllListeners()
  }
}

/**
 * 创建双助理系统
 */
export async function createAssistants(ctx: any, options: { maxParallel?: number } = {}): Promise<AssistantManager> {
  return new AssistantManager({
    ...options,
    session: ctx.session, // opencode SessionDomain：创建/派发真实子会话
  })
}
