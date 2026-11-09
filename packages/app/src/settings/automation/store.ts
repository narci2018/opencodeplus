export type AutomationTask = {
  id: string
  name: string
  description: string
  schedule: string
  agent: "trae" | "trae-bao" | "build"
  prompt: string
  enabled: boolean
  lastRunTime?: number
  lastRunStatus?: "success" | "error" | "running"
}

export type AutomationRunRecord = {
  id: string
  taskId: string
  taskName: string
  agent: string
  startTime: number
  durationMs: number
  status: "success" | "error"
  sessionId?: string
  summary?: string
}

const STORAGE_KEY_TASKS = "opencode.automation.tasks"
const STORAGE_KEY_HISTORY = "opencode.automation.history"

const DEFAULT_TASKS: AutomationTask[] = [
  {
    id: "auto-daily-code-audit",
    name: "每日代码规范与潜在缺陷巡检",
    description: "自动扫描工作区最近提交与未暂存改动，检查是否存在类型隐患、未处理的 Promise 拒绝及循环依赖。",
    schedule: "每天 09:00",
    agent: "trae",
    prompt: "请扫描当前工作区最近的代码变更，检查是否有潜在的类型错误、异步异常漏捕获、未使用的变量或性能隐患，并输出简明的巡检清单。",
    enabled: true,
    lastRunTime: Date.now() - 3600000 * 2,
    lastRunStatus: "success",
  },
  {
    id: "auto-deps-security-scan",
    name: "依赖项安全漏洞与弃用审计",
    description: "分析 package.json 及其锁文件，排查已知的 CVE 安全风险，并给出无损升级建议。",
    schedule: "每周一 10:00",
    agent: "trae-bao",
    prompt: "检查项目中 package.json 的依赖项，分析是否有严重过时或存在已知安全漏洞的组件，给出推荐的安全版本与升级注意事项。",
    enabled: true,
    lastRunTime: Date.now() - 86400000,
    lastRunStatus: "success",
  },
  {
    id: "auto-git-branch-clean",
    name: "Git 分支清理与冲突风险预警",
    description: "检查本地与远端分支状态，标记已合并至主干可清理的分支，及长时间未同步可能存在巨型冲突的分支。",
    schedule: "每天 18:00",
    agent: "trae",
    prompt: "分析当前的 git 分支状态，找出所有已合并到主分支但未删除的本地分支，以及落后主分支较多的活跃分支，给出安全清理脚本。",
    enabled: false,
  },
  {
    id: "auto-daily-summary",
    name: "每日工作进展与待办事项萃取",
    description: "汇总当天 git 提交与会话决策，生成结构化的下班日报与次日高优先级待办清单。",
    schedule: "每天 19:00",
    agent: "trae-bao",
    prompt: "汇总今天的代码提交记录与会话中达成的待办决策，生成一份规范的《每日工作小结与次日重点待办》。",
    enabled: true,
    lastRunTime: Date.now() - 3600000 * 14,
    lastRunStatus: "success",
  },
]

export function loadAutomationTasks(): AutomationTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TASKS)
    if (!raw) {
      saveAutomationTasks(DEFAULT_TASKS)
      return DEFAULT_TASKS
    }
    return JSON.parse(raw) as AutomationTask[]
  } catch {
    return DEFAULT_TASKS
  }
}

export function saveAutomationTasks(tasks: AutomationTask[]) {
  try {
    localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks))
  } catch {
    // ignore
  }
}

export function loadAutomationHistory(): AutomationRunRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY)
    if (!raw) return []
    return JSON.parse(raw) as AutomationRunRecord[]
  } catch {
    return []
  }
}

export function saveAutomationHistory(records: AutomationRunRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(records))
  } catch {
    // ignore
  }
}

export function addAutomationHistory(record: AutomationRunRecord) {
  const list = loadAutomationHistory()
  list.unshift(record)
  // keep max 100 records
  if (list.length > 100) list.length = 100
  saveAutomationHistory(list)
}
