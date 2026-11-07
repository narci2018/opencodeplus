export * as ConfigRules from "./rules.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Rules")({
  /** Include AGENTS.md instruction files in the context (default: true). */
  agents_md: Schema.Boolean.pipe(optional),
  /** Include project CLAUDE.md and CLAUDE.local.md files in the context (default: false). */
  claude_md: Schema.Boolean.pipe(optional),
}) {}
