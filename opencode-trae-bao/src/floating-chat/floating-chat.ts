/**
 * 浮动宠物 UI 管理器
 * 
 * 从 Trae CN iCubeFloatingChat 移植：
 * - 浮动按钮/宠物窗口（始终置顶、透明、可拖拽）
 * - 任务状态标记（状态环 + 任务卡片）
 * - 快捷操作（文本/语音快速创建）
 * - 结果反馈面板
 * 
 * IPC 通道（全部 fire-and-forget，无 request/response）：
 * - toggle / quick-create / task-status-toggle / task-card-open
 * - assistant-open / assistant-dismiss / drag-move / context-menu
 * - update-icon / update-scale / task-state / feedback
 */

export interface AssistantTarget {
  scopeEpoch: number
  kind: 'default' | 'project' | 'project-assistant' | 'global-assistant'
  projectId?: string
  sessionId?: string
}

export interface TaskState {
  running: number
  waiting: number
  hasFailure: boolean
  completionVersion: number
  voiceActive: boolean
}

export interface TaskInfo {
  sessionId: string
  name: string
  status: 'running' | 'waiting' | 'finished' | 'failed' | 'cancelled' | 'input_required' | 'stopped' | 'other'
}

export interface FeedbackPayload {
  theme: 'light' | 'dark'
  kind: 'count' | 'feedback'
  runningLabel: string
  summaryLabel: string
  clearLabel: string
  failedLabel: string
  finishedLabel: string
  results: Array<{ name: string; status: 'finished' | 'failed'; resultId: string }>
}

export interface FloatingChatConfig {
  enabled: boolean
  buttonIcon: 'traebao' | 'ball'
  shortcut: string
  panelType: 'assistant' | 'task'
  size: number // 0.6 - 1.5
}

export const DEFAULT_FLOATING_CHAT_CONFIG: FloatingChatConfig = {
  enabled: true,
  buttonIcon: 'traebao',
  shortcut: 'Alt+Shift+Space',
  panelType: 'assistant',
  size: 1.0,
}

// IPC 通道常量（从 preload.js 提取）
export const IPC_CHANNELS = {
  // Renderer → Main
  TOGGLE: 'icube-floating-chat:toggle',
  QUICK_CREATE: 'icube-floating-chat:quick-create',
  TASK_STATUS_TOGGLE: 'icube-floating-chat:task-status-toggle',
  TASK_CARD_OPEN: 'icube-floating-chat:task-card-open',
  ASSISTANT_OPEN: 'icube-floating-chat:assistant-open',
  ASSISTANT_DISMISS: 'icube-floating-chat:assistant-dismiss',
  TASK_CARD_DISMISS: 'icube-floating-chat:task-card-dismiss',
  RESULT_OPEN: 'icube-floating-chat:result-open',
  RESULTS_CLEAR: 'icube-floating-chat:results-clear',
  FEEDBACK_RESIZE: 'icube-floating-chat:feedback-resize',
  TOAST_FRAME: 'icube-floating-chat:toast-frame',
  DRAG_MOVE: 'icube-floating-chat:drag-move',
  DRAG_END: 'icube-floating-chat:drag-end',
  CONTEXT_MENU: 'icube-floating-chat:context-menu',
  BUTTON_RESIZE: 'icube-floating-chat:button-resize',
  BUTTON_HIT_REGION: 'icube-floating-chat:button-hit-region',
  REQUEST_STARTUP_EASTER_EGG: 'icube-floating-chat:request-startup-easter-egg',

  // Main → Renderer
  UPDATE_ICON: 'icube-floating-chat:update-icon',
  EASTER_EGG_ENABLED: 'icube-floating-chat:easter-egg-enabled',
  STARTUP_EASTER_EGG: 'icube-floating-chat:startup-easter-egg',
  BUTTON_VISIBILITY: 'icube-floating-chat:button-visibility',
  QUICK_STATE: 'icube-floating-chat:quick-state',
  FEEDBACK: 'icube-floating-chat:feedback',
  TOAST_PRESENT: 'icube-floating-chat:toast-present',
  TOAST_PLACEMENT: 'icube-floating-chat:toast-placement',
  TASK_STATE: 'icube-floating-chat:task-state',
  UPDATE_SCALE: 'icube-floating-chat:update-scale',
  UPDATE_RUNNING_TASKS: 'icube-floating-chat:update-running-tasks',
  CURSOR_POSITION: 'icube-floating-chat:cursor-position',
  INPUT_CARET: 'icube-floating-chat:input-caret',
  UPDATE_THEME: 'icube-floating-chat:update-theme',
  NATIVE_MOUSE_EVENT: 'icube-floating-chat:native-mouse-event',
  NATIVE_INPUT_MODE: 'icube-floating-chat:native-input-mode',
} as const

export interface FloatingChatHandle {
  /** 切换聊天面板显示/隐藏 */
  toggle(): void
  /** 打开面板 */
  openPanel(): void
  /** 关闭面板 */
  closePanel(): void
  /** 快速创建（文本/语音） */
  quickCreate(mode: 'text' | 'voice'): void
  /** 切换任务状态视图 */
  taskStatusToggle(): void
  /** 打开指定任务 */
  taskCardOpen(sessionId: string): void
  /** 打开助理 */
  assistantOpen(target: AssistantTarget): void
  /** 更新任务状态 */
  updateTaskState(state: TaskState): void
  /** 更新运行中的任务列表 */
  updateRunningTasks(tasks: TaskInfo[]): void
  /** 更新宠物图标 */
  updateIcon(iconName: 'traebao' | 'ball'): void
  /** 更新缩放 */
  updateScale(scale: number): void
  /** 显示反馈 */
  showFeedback(payload: FeedbackPayload): void
  /** 显示 Toast */
  showToast(revision: number, finish?: boolean): void
  /** 设置按钮可见性 */
  setButtonVisibility(visible: boolean): void
  /** 销毁 */
  dispose(): void
}

/**
 * 创建浮动宠物 UI 管理器
 * 
 * 使用 opencode 的窗口/TUI 系统替代 Electron 主进程服务。
 * 原始代码从 Trae CN 复制，通过事件总线适配。
 */
export async function createFloatingChat(
  ctx: any,
  config: Partial<FloatingChatConfig> = {},
): Promise<FloatingChatHandle> {
  const mergedConfig = { ...DEFAULT_FLOATING_CHAT_CONFIG, ...config }

  // 事件总线（模拟 IPC 通道）
  const handlers = new Map<string, Set<(...args: any[]) => void>>()
  const sendToMain = (channel: string, ...args: any[]) => {
    handlers.get(channel)?.forEach((fn) => fn(...args))
  }

  // 状态管理
  let visible = false
  let taskState: TaskState = { running: 0, waiting: 0, hasFailure: false, completionVersion: 0, voiceActive: false }
  let runningTasks: TaskInfo[] = []

  // 注册 IPC 通道（从 preload.js 提取的 whitelist）
  const sendChannels = new Set<string>([
    IPC_CHANNELS.TOGGLE,
    IPC_CHANNELS.QUICK_CREATE,
    IPC_CHANNELS.TASK_STATUS_TOGGLE,
    IPC_CHANNELS.TASK_CARD_OPEN,
    IPC_CHANNELS.ASSISTANT_OPEN,
    IPC_CHANNELS.ASSISTANT_DISMISS,
    IPC_CHANNELS.TASK_CARD_DISMISS,
    IPC_CHANNELS.RESULT_OPEN,
    IPC_CHANNELS.RESULTS_CLEAR,
    IPC_CHANNELS.FEEDBACK_RESIZE,
    IPC_CHANNELS.TOAST_FRAME,
    IPC_CHANNELS.DRAG_MOVE,
    IPC_CHANNELS.DRAG_END,
    IPC_CHANNELS.CONTEXT_MENU,
    IPC_CHANNELS.BUTTON_RESIZE,
    IPC_CHANNELS.BUTTON_HIT_REGION,
    IPC_CHANNELS.REQUEST_STARTUP_EASTER_EGG,
  ])

  const receiveChannels = new Set<string>([
    IPC_CHANNELS.UPDATE_ICON,
    IPC_CHANNELS.EASTER_EGG_ENABLED,
    IPC_CHANNELS.STARTUP_EASTER_EGG,
    IPC_CHANNELS.BUTTON_VISIBILITY,
    IPC_CHANNELS.QUICK_STATE,
    IPC_CHANNELS.FEEDBACK,
    IPC_CHANNELS.TOAST_PRESENT,
    IPC_CHANNELS.TOAST_PLACEMENT,
    IPC_CHANNELS.TASK_STATE,
    IPC_CHANNELS.UPDATE_SCALE,
    IPC_CHANNELS.UPDATE_RUNNING_TASKS,
    IPC_CHANNELS.CURSOR_POSITION,
    IPC_CHANNELS.INPUT_CARET,
    IPC_CHANNELS.UPDATE_THEME,
    IPC_CHANNELS.NATIVE_MOUSE_EVENT,
    IPC_CHANNELS.NATIVE_INPUT_MODE,
  ])

  // 监听主进程通道（模拟 opencode 事件总线）
  const on = (channel: string, callback: (...args: any[]) => void) => {
    if (!receiveChannels.has(channel)) return
    if (!handlers.has(channel)) handlers.set(channel, new Set())
    handlers.get(channel)!.add(callback)
  }

  // 发送到渲染进程（模拟 opencode 窗口消息）
  const send = (channel: string, ...args: any[]) => {
    if (!sendChannels.has(channel)) return
    // TODO: 在 opencode 中这里应发送到浮动宠物窗口
    console.log(`[FloatingChat] ${channel}`, ...args)
  }

  // 全局快捷键注册（opencode TUI keymap）
  // Trae CN 的 Alt+Shift+Space 映射为 opencode keymap layer 命令
  const shortcut = mergedConfig.shortcut
  const keymapCommands = [
    {
      id: 'trae-bao.toggle',
      title: 'TRAE 宝：切换浮动面板',
      description: '打开或关闭 TRAE 宝浮动面板（全局助理）',
      group: 'TRAE 宝',
      bind: shortcut === 'Alt+Shift+Space' ? 'alt+shift+space' : shortcut.toLowerCase(),
      palette: true,
      run: () => {
        visible = !visible
        togglePanel(visible)
        sendToMain(IPC_CHANNELS.TOGGLE)
      },
    },
  ]

  function togglePanel(show: boolean): void {
    if (!ctx.ui?.panel) return
    if (show) {
      ctx.ui.panel.open('trae-bao', { presentation: 'panel' })
    } else {
      ctx.ui.panel.close()
    }
  }

  if (ctx.keymap?.layer) {
    ctx.keymap.layer(() => ({ commands: keymapCommands }))
  }

  return {
    toggle() {
      visible = !visible
      togglePanel(visible)
      sendToMain(IPC_CHANNELS.TOGGLE)
    },
    openPanel() {
      visible = true
      togglePanel(true)
    },
    closePanel() {
      visible = false
      togglePanel(false)
    },
    quickCreate(mode) {
      sendToMain(IPC_CHANNELS.QUICK_CREATE, { mode })
    },
    taskStatusToggle() {
      sendToMain(IPC_CHANNELS.TASK_STATUS_TOGGLE)
    },
    taskCardOpen(sessionId) {
      sendToMain(IPC_CHANNELS.TASK_CARD_OPEN, { sessionId })
    },
    assistantOpen(target) {
      sendToMain(IPC_CHANNELS.ASSISTANT_OPEN, { target })
    },
    updateTaskState(state) {
      taskState = state
      send(IPC_CHANNELS.TASK_STATE, state)
    },
    updateRunningTasks(tasks) {
      runningTasks = tasks
      send(IPC_CHANNELS.UPDATE_RUNNING_TASKS, tasks)
    },
    updateIcon(iconName) {
      send(IPC_CHANNELS.UPDATE_ICON, { iconName })
    },
    updateScale(scale) {
      const clamped = Math.max(0.6, Math.min(1.5, scale))
      send(IPC_CHANNELS.UPDATE_SCALE, clamped)
    },
    showFeedback(payload) {
      send(IPC_CHANNELS.FEEDBACK, payload)
    },
    showToast(revision, finish) {
      send(IPC_CHANNELS.TOAST_PRESENT, { revision, finish })
    },
    setButtonVisibility(visible) {
      send(IPC_CHANNELS.BUTTON_VISIBILITY, visible)
    },
    dispose() {
      handlers.clear()
    },
  }
}
