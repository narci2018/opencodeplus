export * as ConfigTrae from "./trae.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Trae")({
  /** Register the embedded computer-use MCP server for desktop automation (default: true). */
  computer_use: Schema.Boolean.pipe(optional),
}) {}
