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
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "custom-agent"
}

export const BUILTIN_AGENT_IDS = new Set(["build", "plan", "trae", "trae-bao"])

export function isBuiltinAgent(id: string): boolean {
  return BUILTIN_AGENT_IDS.has(id.toLowerCase().trim())
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
