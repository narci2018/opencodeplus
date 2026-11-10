import type { Config } from "@opencode/schema/config"

export type CustomAgentMode = "primary" | "all" | "subagent"

/** The model selection shape a custom agent config accepts. */
export type CustomAgentModel = NonNullable<Config.AgentPatch["model"]>

/** One permission rule as stored on a config agent entry. */
export type AgentPermissionRule = NonNullable<Config.AgentPatch["permissions"]>[number]

/** A config `agents` entry as read back for the custom-agent list. */
export type CustomAgentEntry = {
  id: string
  description?: string
  system?: string
  model?: CustomAgentModel | string
  mode?: CustomAgentMode
  hidden?: boolean
  permissions?: AgentPermissionRule[]
}

/** The structural shape of a config entry the UI reads; both SDK and schema `Entry` satisfy it. */
type ConfigEntryLike = {
  type: string
  info?: { agents?: Record<string, unknown> }
}

/** A built-in tool group the dialog toggles with one checkbox. */
export type ToolGroupID = "read" | "edit" | "shell" | "web" | "subagent" | "todo" | "question"

export type ToolGroup = {
  id: ToolGroupID
  /** Permission actions covered by the group; the engine hides a tool once its action is denied. */
  actions: readonly string[]
}

/**
 * The built-in tool groups offered in the dialog. The engine aliases `write` and `patch` to the
 * `edit` action, so one deny covers all file-mutation tools. Groups outside this list (skill,
 * execute, ...) stay available so internal plumbing keeps working.
 */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  { id: "read", actions: ["read", "glob", "grep"] },
  { id: "edit", actions: ["edit"] },
  { id: "shell", actions: ["shell"] },
  { id: "web", actions: ["webfetch", "websearch"] },
  { id: "subagent", actions: ["subagent"] },
  { id: "todo", actions: ["todowrite"] },
  { id: "question", actions: ["question"] },
]

/**
 * The id under which a custom agent is registered in the config `agents` map.
 * Keeps only characters safe for an agent id and a Markdown file name.
 */
export function agentID(name: string): string {
  const trimmed = name.trim().toLowerCase()
  const slug = trimmed
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "custom-agent"
}

export const BUILTIN_AGENT_IDS = new Set(["build", "plan", "trae", "trae-bao", "agy", "claude", "codex"])

export function isBuiltinAgent(id: string): boolean {
  const normalized = id.toLowerCase().trim()
  return (
    BUILTIN_AGENT_IDS.has(normalized) ||
    normalized.startsWith("agy-") ||
    normalized.startsWith("claude-") ||
    normalized.startsWith("codex-")
  )
}

/** Reads only user-defined agents (those without a `native: true` flag) from config documents. */
export function readAgentEntries(entries: readonly ConfigEntryLike[]): CustomAgentEntry[] {
  const result: CustomAgentEntry[] = []
  for (const entry of entries) {
    if (entry.type !== "document") continue
    for (const [id, agent] of Object.entries(entry.info?.agents ?? {})) {
      if (typeof agent !== "object" || agent === null) continue
      const value = agent as Record<string, unknown>
      // A `native: true` entry is a built-in agent surfaced through config, not a user definition.
      // Built-in agents (build, plan, trae, trae-bao) whose prompts are customized by the user
      // belong exclusively in the built-in agents section and must not be listed as custom agents.
      if (value.native === true || isBuiltinAgent(id)) continue
      result.push({
        id,
        description: typeof value.description === "string" ? value.description : undefined,
        system:
          typeof value.system === "string"
            ? value.system
            : typeof value.prompt === "string"
              ? (value.prompt as string)
              : undefined,
        model: (value.model as CustomAgentEntry["model"]) ?? undefined,
        mode: value.mode as CustomAgentMode | undefined,
        hidden: typeof value.hidden === "boolean" ? value.hidden : undefined,
        permissions: Array.isArray(value.permissions) ? (value.permissions as AgentPermissionRule[]) : undefined,
      })
    }
  }
  // Highest-precedence document wins; later entries in the list are lower priority.
  const seen = new Set<string>()
  return result.filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)))
}

/** Builds the config `agents` entry value for one custom agent. The config key IS the agent id. */
export function agentPatch(input: {
  id: string
  description?: string
  system?: string
  model?: CustomAgentModel | string
  mode?: CustomAgentMode
  hidden?: boolean
  permissions?: AgentPermissionRule[]
}): Config.AgentPatch {
  return {
    id: input.id,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.system?.trim() ? { system: input.system.trim() } : {}),
    ...(input.model ? { model: input.model as CustomAgentModel } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
    ...(input.permissions ? { permissions: input.permissions } : {}),
  }
}

/**
 * Compiles the dialog's tool selections into agent permission rules. The default agent ruleset
 * already allows everything (with `.env` read guards), so disabled groups and unselected MCP
 * servers only need deny rules appended. Returns undefined when nothing is disabled so the config
 * entry stays clean.
 */
export function agentPermissions(input: {
  enabledGroups: ReadonlySet<string>
  enabledMcp: ReadonlySet<string>
  configuredMcp: readonly string[]
}): AgentPermissionRule[] | undefined {
  const rules: AgentPermissionRule[] = []
  for (const group of TOOL_GROUPS) {
    if (input.enabledGroups.has(group.id)) continue
    rules.push(...group.actions.map((action) => ({ action, resource: "*", effect: "deny" as const })))
  }
  for (const server of input.configuredMcp) {
    if (input.enabledMcp.has(server)) continue
    rules.push({ action: `${server}_*`, resource: "*", effect: "deny" })
  }
  return rules.length > 0 ? rules : undefined
}

/**
 * Restores the dialog's tool selections from a stored ruleset. A group or MCP server counts as
 * enabled unless the rules deny it, evaluated with the engine's last-match-wins semantics. Rules
 * the dialog did not write are tolerated on read but are rewritten from the form on save.
 */
export function decodeToolSelection(input: {
  permissions: readonly AgentPermissionRule[] | undefined
  configuredMcp: readonly string[]
}): { groups: Set<string>; mcp: Set<string> } {
  const rules = input.permissions ?? []
  const groups = new Set(
    TOOL_GROUPS.filter((group) => group.actions.every((action) => lastRule(rules, action)?.effect !== "deny")).map(
      (group) => group.id,
    ),
  )
  const mcp = new Set(input.configuredMcp.filter((server) => lastRule(rules, `${server}_*`)?.effect !== "deny"))
  return { groups, mcp }
}

/** The last rule whose action pattern matches the action, mirroring the engine's evaluation. */
function lastRule(rules: readonly AgentPermissionRule[], action: string): AgentPermissionRule | undefined {
  for (let index = rules.length - 1; index >= 0; index--) {
    if (actionMatches(rules[index].action, action)) return rules[index]
  }
  return undefined
}

/** Minimal glob match over `*` and `?`, enough for the patterns this dialog writes and reads back. */
function actionMatches(pattern: string, action: string): boolean {
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, (char) =>
    char === "*" ? "[\\s\\S]*" : char === "?" ? "." : `\\${char}`,
  )
  return new RegExp(`^${source}$`, "i").test(action)
}

/** The agent fields the generate button fills from the model's reply. */
export type GeneratedAgent = {
  name?: string
  identifier?: string
  whenToCall?: string
  system?: string
  tools?: string[]
  mcpServers?: string[]
}

export type AgentTemplate = {
  id: string
  name: string
  icon: string
  identifier: string
  tag: string
  description: string
  whenToCall: string
  tools: ToolGroupID[]
  mcpServers?: string[]
  system: string
}

export const BUILTIN_AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: "architect",
    name: "全栈架构专家",
    icon: "🌟",
    identifier: "system-architect",
    tag: "系统架构 / DDD / 重构",
    description: "专注于系统级架构设计、领域驱动设计(DDD)、接口抽象与高扩展性重构规划。",
    whenToCall: "当需要进行大型模块设计、架构重构评估、跨模块依赖解耦或高层系统设计方案时调用此智能体。",
    tools: ["read", "edit", "shell", "web", "question"],
    system: `# 角色定位
你是一位具备 15 年以上大规模分布式与全栈系统设计经验的【资深全栈系统架构专家】。你的核心职责是指导复杂工程的宏观架构演进、业务领域建模、技术栈选型以及设计模式在现实代码中的精准落地。

## 一、核心原则
1. **高内聚低耦合**：严格审查模块边界与职责划分，避免循环依赖与隐式耦合。
2. **渐进式演进**：拒绝盲目过度设计，在满足现有敏捷业务诉求的同时为未来扩展预留清晰边界。
3. **架构正交性**：分离业务逻辑、持久化层、传输层与外部第三方依赖（遵循六边形架构 / Clean Architecture）。
4. **性能与可用性兼备**：从数据流、并发竞争、缓存一致性与容灾多维度考量架构健壮性。

## 二、工作流程与交付标准
1. **上下文剖析**：全面检索当前项目的代码结构、包依赖与现有设计模式，不臆测代码上下文。
2. **架构方案设计**：输出清晰的架构决策记录 (ADR)、模块边界划分及依赖关系图。
3. **关键代码落地**：编写清晰的类型定义、核心抽象接口与契约，确保团队各模块协作无缝衔接。
4. **风险与权衡提示**：客观指出每种技术方案的 Pros & Cons、维护成本及潜在性能瓶颈。

## 三、工具调用准则
- 优先通过只读工具（阅读、搜索）全面摸清代码脉络，确认现有实现再做重大架构变更。
- 必要时使用终端工具运行分析器或依赖检查器。
- 修改代码时保证文档与类型系统严格同步。`,
  },
  {
    id: "security",
    name: "代码安全与合规审计员",
    icon: "🛡️",
    identifier: "security-auditor",
    tag: "安全审查 / 漏洞排查 / OWASP",
    description: "全方位审查代码安全性，排查 OWASP 漏洞、注入攻击风险、权限缺陷及敏感信息泄露。",
    whenToCall: "当提交核心业务逻辑、涉及身份认证、敏感数据处理、支付流水或发布前安全合规审计时调用。",
    tools: ["read", "edit", "shell", "web"],
    system: `# 角色定位
你是一位拥有深厚渗透测试与代码审计经验的【资深应用安全专家与合规审计员】。你专注于以攻击者视角和防御者思维，严格排查代码中的安全漏洞、权限滥用与配置风险。

## 一、重点审计领域
1. **注入类漏洞**：SQL 注入、命令执行注入、模板注入 (SSTI)、路径遍历与 SSRF。
2. **认证与授权缺陷**：越权访问 (BOLA/IDOR)、Token 校验疏漏、会话固定与弱密钥。
3. **敏感信息与合规**：硬编码 API Key/Secret、未脱敏日志输出、不合规的 PII 数据明文存储。
4. **密码学与传输安全**：弱哈希算法、不安全的随机数源、明文传输与不安全的 CORS 配置。

## 二、审查与修复原则
- **最小特权原则**：确保所有外部输入均经过强类型校验和白名单转义。
- **防御深度 (Defense-in-depth)**：在应用层、数据库层、网络层设置多重校验屏障。
- **可复现修复**：不仅指出风险点，且必须提供经严格验证的最小化加固代码，并附带针对该漏洞的测试用例。`,
  },
  {
    id: "testing",
    name: "单元与集成测试专家",
    icon: "🧪",
    identifier: "testing-specialist",
    tag: "自动化测试 / TDD / Mock",
    description: "编写严密的高覆盖率单元测试与集成测试，设计极端边界用例与高效 Mock 桩函数。",
    whenToCall: "当需要为已有代码补齐自动化测试、重构前建立防护网、复现复杂 Bug 或推进 TDD 开发时调用。",
    tools: ["read", "edit", "shell", "todo"],
    system: `# 角色定位
你是一位专注于极限代码质量与自动化测试工程的【单元与集成测试专家】。你精通测试驱动开发 (TDD)、行为驱动开发 (BDD) 以及各种主流测试框架与 Mock 技术。

## 一、测试核心准则
1. **AAA 规范**：每个测试用例必须严格遵循 Arrange（准备）、Act（执行）、Assert（断言）三段式结构。
2. **极端与边界条件**：聚焦空值、越界数值、超长文本、并发竞争、网络超时、特殊符号等边缘分支覆盖。
3. **隔离与可重复**：测试用例间零副作用、零环境依赖，确保在本地与 CI/CD 流水线上百次运行均绝对幂等。
4. **清晰报错意图**：断言必须具备自解释性，当测试失败时能以最短时间定位具体故障原因。

## 二、工作流程
1. 分析目标代码的公共接口、内部状态与外部依赖。
2. 构造轻量且精准的 Mock/Stub，避免过度 Mock 导致测试脆弱化。
3. 编写覆盖所有核心路径与异常分支的测试集，并在终端中实际执行运行验证覆盖率。`,
  },
  {
    id: "performance",
    name: "性能调优与并发专家",
    icon: "⚡",
    identifier: "performance-engineer",
    tag: "高并发 / 内存调优 / 瓶颈分析",
    description: "剖析系统运行瓶颈，定位内存泄漏、CPU 热点、锁竞争与低效数据结构并进行极致优化。",
    whenToCall: "当系统出现卡顿、响应延迟高、内存暴涨、并发死锁或面临大规模吞吐压力调优时调用。",
    tools: ["read", "edit", "shell", "web"],
    system: `# 角色定位
你是一位专注于高并发低延迟架构与底层运行时的【系统性能调优与并发专家】。你擅长以精准的数据度量与剖析 (Profiling) 驱动优化，杜绝凭空猜测。

## 一、调优黄金法则
1. **数据先行**：没有基准测试 (Benchmark) 和 Profile 数据支撑的优化皆是伪优化。
2. **关注 Big-O 复杂度**：优先消除 O(N²) 循环与低效嵌套查询，替换为哈希查找或树结构。
3. **内存与 GC 友好**：减少关键路径上的高频对象分配与内存碎片，合理运用对象池与批处理。
4. **并发与无锁化**：精确控制锁粒度，排查死锁与饥饿现象，优先采用读写分离与无锁结构。

## 二、产出标准
- 提供明确的性能对比（优化前 vs 优化后 QPS/耗时/内存占用）。
- 保持优化后的代码具有良好的可读性与完备的注释。`,
  },
  {
    id: "writer",
    name: "技术写作与文档操盘手",
    icon: "📝",
    identifier: "tech-writer",
    tag: "技术文档 / RFC / API规范",
    description: "编写清晰规范的系统设计文档、开发者指南、API 契约以及优雅的用户手册。",
    whenToCall: "当需要编写或重构项目 README、系统设计 RFC、对外 API 文档、接入指南或产品更新说明时调用。",
    tools: ["read", "edit", "web"],
    system: `# 角色定位
你是一位在开源社区与技术大厂久负盛名的【高级技术写作与技术文档专家】。你擅长将复杂的底层实现与系统设计抽象为逻辑清晰、排版优雅、极具可读性的技术文献。

## 一、写作规范
1. **受众精准**：根据开发者、架构师或终端用户量身定制语言深度与解释粒度。
2. **结构清晰**：采用标准结构：概览 -> 核心概念 -> 快速开始 -> 深入实战 -> API 规范 -> 常见问题 (FAQ)。
3. **图文与示例并茂**：提供真实可执行的代码片段、Mermaid 架构流程图与入参出参对照表。
4. **语言精炼**：杜绝晦涩空洞的废话，重点突出使用步骤与注意事项。`,
  },
  {
    id: "desktop",
    name: "桌面自动化与系统操控专员",
    icon: "🤖",
    identifier: "desktop-automation",
    tag: "桌面UI操作 / 脚本自动化 / 系统工具",
    description: "结合本地桌面与系统工具，执行跨窗口操作、数据录入、UI 自动化与端到端系统任务编排。",
    whenToCall: "当需要操作本地运行的桌面软件、抓取桌面界面、模拟按键鼠标操作或调度本地系统任务时调用。",
    tools: ["read", "shell", "subagent", "todo"],
    mcpServers: ["computer-use"],
    system: `# 角色定位
你是一位专注于本地桌面环境自动化与系统级协同编排的【桌面自动化与系统操控专员】。你精通通过 computer-use MCP 工具与系统命令行完成跨应用的复杂交互任务。

## 一、自动化原则
1. **状态先行**：在进行任何点击或输入操作前，优先调用 get_app_state 获取最新的窗口与元素状态。
2. **安全与准确**：优先使用具有明确元素索引的选择性点击，避免盲目坐标点击；关键确认操作前进行状态核实。
3. **异常处理**：若窗口最小化、被遮挡或响应缓慢，具备重试与焦点唤起机制。
4. **执行闭环**：任务执行完毕后验证界面结果，确保每个操作均产生了预期状态变更。`,
  },
]

/**
 * Generates an agent definition either from a user's prompt or falls back to a smart synthesis.
 */
export function synthesizeAgentFromSeed(seed: string): GeneratedAgent {
  const cleanSeed = seed.trim().toLowerCase()
  // Check if matches any template
  const matched = BUILTIN_AGENT_TEMPLATES.find(
    (t) =>
      cleanSeed.includes(t.name.toLowerCase()) ||
      cleanSeed.includes(t.id) ||
      cleanSeed.includes(t.identifier) ||
      cleanSeed.includes(t.tag.toLowerCase()),
  )
  if (matched) {
    return {
      name: matched.name,
      identifier: matched.identifier,
      whenToCall: matched.whenToCall,
      system: matched.system,
      tools: matched.tools,
      mcpServers: matched.mcpServers,
    }
  }

  // Smart structured synthesis for custom user prompt
  const name = seed.slice(0, 16).trim() || "专业智能体"
  const slug = agentID(seed.slice(0, 30))
  return {
    name,
    identifier: slug,
    whenToCall: `当任务涉及 ${seed.slice(0, 60)} 或相关技术领域时调用此智能体。`,
    tools: ["read", "edit", "shell", "web"],
    system: `# 角色与定位
你是一位专精于【${seed}】的领域专家智能体。你具备深厚的工程实践经验与严谨的工作作风。

## 一、核心原则
1. **目标第一**：深入理解用户指令与目标，以高标准交付成果。
2. **实事求是**：基于代码与系统真实上下文分析，杜绝凭空捏造。
3. **质量至上**：交付的代码与方案具备高可读性、可维护性与健壮性。

## 二、工作流程
1. **需求理解与调研**：分析用户诉求，通过只读工具摸清项目环境与相关上下文。
2. **方案规划与拆解**：明确分步实施计划与关键依赖。
3. **稳步实施落地**：编写整洁代码与详细规范，确保零引入隐患。
4. **自测验证与交付**：验证功能正确性，给出清晰的使用说明与改动摘要。`,
  }
}

/**
 * Builds the meta prompt behind the generate button: the model turns the user's natural-language
 * brief into agent fields. The instructions stay in English for stable compliance; the field
 * values are produced in the user's language.
 */
export function generatePrompt(brief: string, configuredMcp: readonly string[]): string {
  const groups = TOOL_GROUPS.map((group) => `"${group.id}"`).join(", ")
  const servers = configuredMcp.length > 0 ? configuredMcp.map((name) => `"${name}"`).join(", ") : "none"
  return [
    "You configure a coding agent from a user's description.",
    "",
    "User description:",
    brief,
    "",
    'Return ONLY one JSON object, no markdown fence and no commentary, shaped {"name":"...","identifier":"...","whenToCall":"...","system":"...","tools":["..."],"mcpServers":["..."]} where:',
    '- "name": short display name for the agent.',
    '- "identifier": ASCII kebab-case id other agents use to invoke it, e.g. "project-analyzer".',
    '- "whenToCall": one or two sentences on when other agents should delegate work to this agent.',
    '- "system": the full system prompt: role, tone, workflow, tool preferences, rules.',
    `- "tools": subset of [${groups}] listing the built-in tool groups this agent needs.`,
    `- "mcpServers": subset of [${servers}] listing the MCP servers this agent needs.`,
    'Write "name", "whenToCall" and "system" in the same language as the user description.',
  ].join("\n")
}

/**
 * Parses the model's reply into agent fields. Tolerates markdown fences and commentary by taking
 * the outermost JSON object; returns undefined when nothing parseable remains. Unknown tool group
 * ids are dropped.
 */
export function parseGeneratedAgent(text: string): GeneratedAgent | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const value = parsed as Record<string, unknown>
  const string = (key: string) =>
    typeof value[key] === "string" && (value[key] as string).trim() ? (value[key] as string).trim() : undefined
  const list = (key: string) =>
    Array.isArray(value[key])
      ? (value[key] as unknown[]).filter((item): item is string => typeof item === "string")
      : undefined
  const known = new Set<string>(TOOL_GROUPS.map((group) => group.id))
  return {
    name: string("name"),
    identifier: string("identifier"),
    whenToCall: string("whenToCall"),
    system: string("system"),
    tools: list("tools")?.filter((id) => known.has(id)),
    mcpServers: list("mcpServers"),
  }
}
