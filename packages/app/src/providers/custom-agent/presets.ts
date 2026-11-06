import type { Config } from "@opencode/schema/config"

export type CustomAgentMode = "primary" | "all" | "subagent"

/** The model selection shape a custom agent config accepts. */
export type CustomAgentModel = NonNullable<Config.AgentPatch["model"]>

/** A config `agents` entry as read back for the custom-agent list. */
export type CustomAgentEntry = {
  id: string
  description?: string
  system?: string
  model?: CustomAgentModel | string
  mode?: CustomAgentMode
  hidden?: boolean
}

/** The structural shape of a config entry the UI reads; both SDK and schema `Entry` satisfy it. */
type ConfigEntryLike = {
  type: string
  info?: { agents?: Record<string, unknown> }
}

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

/** Reads only user-defined agents (those without a `native: true` flag) from config documents. */
export function readAgentEntries(entries: readonly ConfigEntryLike[]): CustomAgentEntry[] {
  const result: CustomAgentEntry[] = []
  for (const entry of entries) {
    if (entry.type !== "document") continue
    for (const [id, agent] of Object.entries(entry.info?.agents ?? {})) {
      if (typeof agent !== "object" || agent === null) continue
      const value = agent as Record<string, unknown>
      // A `native: true` entry is a built-in agent surfaced through config, not a user definition.
      if (value.native === true) continue
      result.push({
        id,
        description: typeof value.description === "string" ? value.description : undefined,
        system: typeof value.system === "string" ? value.system : undefined,
        model: (value.model as CustomAgentEntry["model"]) ?? undefined,
        mode: value.mode as CustomAgentMode | undefined,
        hidden: typeof value.hidden === "boolean" ? value.hidden : undefined,
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
}): Config.AgentPatch {
  return {
    id: input.id,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.system?.trim() ? { system: input.system.trim() } : {}),
    ...(input.model ? { model: input.model as CustomAgentModel } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
  }
}
