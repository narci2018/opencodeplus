export * as ConfigMemory from "./memory.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Memory")({
  /** Inject the global and project memory files into sessions (default: true). */
  enabled: Schema.Boolean.pipe(optional),
  /** Distill session insights into the project memory when a session goes idle (default: true). */
  distill: Schema.Boolean.pipe(optional),
}) {}
