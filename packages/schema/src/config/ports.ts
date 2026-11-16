export * as ConfigPorts from "./ports.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Ports")({
  /** Local port for the OpenAI browser-login OAuth callback (default: 1455). */
  callback_openai: Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 })).pipe(optional),
  /** Fallback port when the OpenAI callback port is occupied (default: 1457). */
  callback_openai_fallback: Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 })).pipe(optional),
  /** Local port for the DigitalOcean OAuth callback (default: 1456). */
  callback_digitalocean: Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 })).pipe(optional),
}) {}
