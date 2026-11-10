export * as Config from "./config.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { Permission } from "./permission.js"
import { AbsolutePath, optional } from "./schema.js"
import { ConfigAgent } from "./config/agent.js"
import { ConfigMedia } from "./config/media.js"
import { ConfigCompaction } from "./config/compaction.js"
import { ConfigCommand } from "./config/command.js"
import { ConfigExperimental } from "./config/experimental.js"
import { ConfigFormatter } from "./config/formatter.js"
import { ConfigLSP } from "./config/lsp.js"
import { ConfigMCP } from "./config/mcp.js"
import { ConfigModel } from "./config/model.js"
import { ConfigPlugin } from "./config/plugin.js"
import { ConfigPolicy } from "./config/policy.js"
import { ConfigProvider } from "./config/provider.js"
import { ConfigReference } from "./config/reference.js"
import { ConfigRules } from "./config/rules.js"
import { ConfigMemory } from "./config/memory.js"
import { ConfigWebSearch } from "./config/websearch.js"
import { ConfigToolOutput } from "./config/tool-output.js"
import { ConfigWatcher } from "./config/watcher.js"
import { ConfigWarming } from "./config/warming.js"
import { ConfigWorktree } from "./config/worktree.js"

export class Info extends Schema.Class<Info>("Config.Info")({
  $schema: optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  shell: Schema.String.pipe(optional).annotate({
    description: "Default shell to use for terminal and shell tool execution",
  }),
  model: ConfigModel.Selection.pipe(optional).annotate({
    description: "Default model to use when no session or agent model is selected",
  }),
  default_agent: Schema.String.pipe(optional).annotate({
    description: "Default primary agent to use when no session agent is selected",
  }),
  update: Schema.Literals(["disable", "notify", "auto"]).pipe(optional).annotate({
    description: "Disable updates, notify when one is available, or install updates automatically",
  }),
  share: Schema.Literals(["manual", "auto", "disabled"]).pipe(optional).annotate({
    description: "Control whether sessions may be shared manually, automatically, or not at all",
  }),
  enterprise: Schema.Struct({
    url: Schema.String.pipe(optional),
  })
    .pipe(optional)
    .annotate({
      description: "Enterprise sharing service configuration",
    }),
  username: Schema.String.pipe(optional).annotate({
    description: "Username displayed in conversations and used for telemetry identity",
  }),
  timezone: Schema.String.pipe(optional).annotate({
    description: "IANA time zone for schedules, e.g. America/Los_Angeles. Defaults to the server's local zone",
  }),
  permissions: Permission.Ruleset.pipe(optional).annotate({
    description: "Ordered tool permission rules applied to agent tool use",
  }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Ordered policies controlling access to providers, tools, and integrations",
  }),
  agents: Schema.Record(Schema.String, ConfigAgent.Info).pipe(optional).annotate({
    description: "Named built-in agent overrides and custom agent definitions",
  }),
  snapshots: Schema.Boolean.pipe(optional).annotate({
    description: "Enable snapshots used for undo and revert behavior",
  }),
  watcher: ConfigWatcher.Info.pipe(optional).annotate({
    description: "Filesystem watcher configuration",
  }),
  formatter: ConfigFormatter.Info.pipe(optional).annotate({
    description: "Enable built-in formatters or configure formatter overrides",
  }),
  lsp: ConfigLSP.Info.pipe(optional).annotate({
    description: "Enable built-in language servers or configure server overrides",
  }),
  media: ConfigMedia.Info.pipe(optional).annotate({
    description: "Media processing configuration",
  }),
  tool_output: ConfigToolOutput.Info.pipe(optional).annotate({
    description: "Tool output truncation thresholds",
  }),
  mcp: ConfigMCP.Info.pipe(optional).annotate({
    description: "MCP server configuration",
  }),
  compaction: ConfigCompaction.Info.pipe(optional).annotate({
    description: "Conversation compaction behavior",
  }),
  skills: Schema.String.pipe(Schema.Array, optional).annotate({
    description: "Additional paths or URLs to discover skills from",
  }),
  commands: Schema.Record(Schema.String, ConfigCommand.Info).pipe(optional).annotate({
    description: "Named slash command definitions",
  }),
  instructions: Schema.String.pipe(Schema.Array, optional).annotate({
    description: "Additional paths or URLs supplying ambient instructions",
  }),
  rules: ConfigRules.Info.pipe(optional).annotate({
    description: "Rule file import toggles for AGENTS.md and CLAUDE.md",
  }),
  memory: ConfigMemory.Info.pipe(optional).annotate({
    description: "Memory injection and distillation settings",
  }),
  references: ConfigReference.Info.pipe(optional).annotate({
    description: "Named local directories or Git repositories available as external context",
  }),
  websearch: ConfigWebSearch.Selection.pipe(optional).annotate({
    description: "Web search provider selection",
  }),
  plugins: ConfigPlugin.Plugins.pipe(optional).annotate({
    description: "Ordered plugin enablement directives and external package declarations",
  }),
  worktree: ConfigWorktree.Info.pipe(optional).annotate({
    description: "Directory defaults for local worktree creation",
  }),
  warming: ConfigWarming.Warming.pipe(optional).annotate({
    description: "Keep recently active sessions warm with transient model requests (default: false)",
  }),
  providers: Schema.Record(Schema.String, ConfigProvider.Info).pipe(optional),
  experimental: ConfigExperimental.Info.pipe(optional),
}) {}

export const ProviderPatch = Schema.Struct({
  /** The id this custom provider is registered under, e.g. `my-llm`. */
  id: Schema.String,
  /** The provider carrier package, e.g. `@opencode/ai/providers/openai-compatible`. */
  package: Schema.String.pipe(optional),
  /** The carrier's canonical provider id, e.g. `openai-compatible`. */
  canonical: Schema.String.pipe(optional),
  name: Schema.String.pipe(optional),
  settings: Schema.Struct({
    baseURL: Schema.String,
    apiKey: Schema.String.pipe(optional),
  }).pipe(optional),
  /** Model ids to register under this provider, each with an optional display name. */
  models: Schema.Record(
    Schema.String,
    Schema.Struct({ name: Schema.String.pipe(optional) }),
  ).pipe(optional),
  /** When true, remove the entry instead of upserting it. */
  remove: Schema.Literal(true).pipe(optional),
}).annotate({ identifier: "Config.ProviderPatch" })
export type ProviderPatch = Schema.Schema.Type<typeof ProviderPatch>

export const AgentPatch = Schema.Struct({
  /** The id this custom agent is registered under, e.g. `reviewer`. */
  id: Schema.String,
  /** Display name of the agent. */
  name: Schema.String.pipe(optional),
  /** Short description shown in the composer selector and agent list. */
  description: Schema.String.pipe(optional),
  /** The agent system prompt; the agent's role and instructions. */
  system: Schema.String.pipe(optional),
  /** The model this agent uses, overriding the configured default. */
  model: ConfigModel.Selection.pipe(optional),
  /** Whether the agent is selectable in the composer (`primary`/`all`) or a subagent. */
  mode: Schema.Literals(["subagent", "primary", "all"]).pipe(optional),
  /** Hide the agent from the composer selector. */
  hidden: Schema.Boolean.pipe(optional),
  /** Ordered permission rules appended to the agent's default ruleset, e.g. denying tools. */
  permissions: Permission.Ruleset.pipe(optional),
  /** When true, remove the entry instead of upserting it. */
  remove: Schema.Literal(true).pipe(optional),
}).annotate({ identifier: "Config.AgentPatch" })
export type AgentPatch = Schema.Schema.Type<typeof AgentPatch>

export const McpPatch = Schema.Struct({
  /** The name this MCP server is registered under in the `mcp.servers` map. */
  name: Schema.String,
  /** The server configuration; required unless `remove` is set. */
  config: ConfigMCP.Server.pipe(optional),
  /** When true, remove the entry instead of upserting it. */
  remove: Schema.Literal(true).pipe(optional),
}).annotate({ identifier: "Config.McpPatch" })
export type McpPatch = Schema.Schema.Type<typeof McpPatch>

export const PluginPatch = Schema.Struct({
  /** The npm/Git package specifier or local plugin directory to add, e.g. `@opencode/plugin-figma`. */
  package: Schema.String,
  /** When true, remove every matching entry (string or `package` object) instead of adding it. */
  remove: Schema.Literal(true).pipe(optional),
}).annotate({ identifier: "Config.PluginPatch" })
export type PluginPatch = Schema.Schema.Type<typeof PluginPatch>

export const SkillPatch = Schema.Struct({
  /** A skills directory path or http(s) URL to discover skills from. */
  source: Schema.String,
  /** When true, remove the entry instead of adding it. */
  remove: Schema.Literal(true).pipe(optional),
}).annotate({ identifier: "Config.SkillPatch" })
export type SkillPatch = Schema.Schema.Type<typeof SkillPatch>

export const RulesPatch = Schema.Struct({
  /** Include AGENTS.md instruction files in the context. */
  agents_md: Schema.Boolean.pipe(optional),
  /** Include project CLAUDE.md and CLAUDE.local.md files in the context. */
  claude_md: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Config.RulesPatch" })
export type RulesPatch = Schema.Schema.Type<typeof RulesPatch>

export const MemoryPatch = Schema.Struct({
  /** Inject the global and project memory files into sessions. */
  enabled: Schema.Boolean.pipe(optional),
  /** Distill session insights into the project memory when a session goes idle. */
  distill: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Config.MemoryPatch" })
export type MemoryPatch = Schema.Schema.Type<typeof MemoryPatch>

export const InstructionPatch = Schema.Struct({
  /** A file path or http(s) URL supplying ambient instructions. */
  source: Schema.String,
  /** When true, remove the entry instead of adding it. */
  remove: Schema.Literal(true).pipe(optional),
}).annotate({ identifier: "Config.InstructionPatch" })
export type InstructionPatch = Schema.Schema.Type<typeof InstructionPatch>

export const ExperimentalPatch = Schema.Struct({
  /** Merge new subagent availability entries into the `experimental.subagent_access` map. */
  subagent_access: Schema.Record(Schema.String, Schema.Literals(["default", "allow", "deny"])).pipe(optional),
}).annotate({ identifier: "Config.ExperimentalPatch" })
export type ExperimentalPatch = Schema.Schema.Type<typeof ExperimentalPatch>

export const Patch = Schema.Struct({
  shell: Schema.NullOr(Schema.String).pipe(optional),
  /** Sets, updates, or removes one custom provider entry in the `providers` field. */
  provider: ProviderPatch.pipe(optional),
  /** Sets, updates, or removes one custom agent entry in the `agents` field. */
  agent: AgentPatch.pipe(optional),
  /** Sets, updates, or removes one MCP server entry in the `mcp.servers` field. */
  mcp: McpPatch.pipe(optional),
  /** Adds or removes one plugin entry in the `plugins` array. */
  plugin: PluginPatch.pipe(optional),
  /** Adds or removes one skills source in the `skills` array. */
  skill: SkillPatch.pipe(optional),
  /** Sets the rule file import toggles in the `rules` field. */
  rules: RulesPatch.pipe(optional),
  /** Sets the memory injection and distillation toggles in the `memory` field. */
  memory: MemoryPatch.pipe(optional),
  /** Adds or removes one instructions source in the `instructions` array. */
  instruction: InstructionPatch.pipe(optional),
  /** Merges experimental settings, such as subagent availability, into the `experimental` field. */
  experimental: ExperimentalPatch.pipe(optional),
}).annotate({ identifier: "Config.Patch" })
export interface Patch extends Schema.Schema.Type<typeof Patch> {}

export class Document extends Schema.Class<Document>("Config.Document")({
  type: Schema.Literal("document"),
  path: AbsolutePath.pipe(optional),
  info: Info,
}) {}

export class Directory extends Schema.Class<Directory>("Config.Directory")({
  type: Schema.Literal("directory"),
  path: AbsolutePath,
}) {}

export const Entry = Schema.Union([Document, Directory]).annotate({
  identifier: "Config.Entry",
})
export type Entry = typeof Entry.Type

const Updated = ephemeral({
  type: "config.updated",
  schema: {},
})

export const Event = { Updated, Definitions: inventory(Updated) }
