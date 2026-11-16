export * as Ports from "./ports.js"

import { Schema } from "effect"

export const Status = Schema.Struct({
  /** Stable identifier of the port entry, matching the `ports` config field name where configurable. */
  id: Schema.Literals(["callback_openai", "callback_openai_fallback", "callback_digitalocean", "callback_gitlab"]),
  /** The port used when the config does not override it. */
  default_port: Schema.Int,
  /** The port configured in config, when set. */
  configured_port: Schema.NullOr(Schema.Int),
  /** Whether the effective port is currently bindable on the loopback interface. */
  available: Schema.Boolean,
  /** Whether the settings may change this port; fixed ports are registered with the provider. */
  configurable: Schema.Boolean,
}).annotate({ identifier: "Ports.Status" })

export const Info = Schema.Struct({
  ports: Schema.Array(Status),
}).annotate({ identifier: "Ports.Info" })

export type Info = typeof Info.Type
