import { Config } from "@opencode/core/config"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { createServer } from "node:net"
import { Api } from "../api"

const DEFAULTS = {
  callback_openai: 1455,
  callback_openai_fallback: 1457,
  callback_digitalocean: 1456,
} as const

/** Whether a loopback listener can bind the port right now: probe with a short-lived server. */
const bindable = (port: number) =>
  Effect.callback<boolean>((resume) => {
    const probe = createServer()
    probe.once("error", () => resume(Effect.succeed(false)))
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resume(Effect.succeed(true)))
    })
  })

export const PortsHandler = HttpApiBuilder.group(Api, "server.ports", (handlers) =>
  handlers.handle(
    "ports.status",
    Effect.fn("server.ports.status")(function* (ctx) {
      const config = yield* Config.Service
      const entries = yield* config.entries()
      const configured = entries
        .filter((entry) => entry.type === "document")
        .flatMap((entry) => (entry.info.ports ? [entry.info.ports] : []))
        .at(-1)
      const rows = [
        ...(Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>).map((id) => ({
          id,
          defaultPort: DEFAULTS[id],
          configuredPort: configured?.[id],
          configurable: true as const,
        })),
        // The GitLab redirect URI is registered with gitlab.com for port 8080 and matched exactly,
        // so the callback port is display-only.
        {
          id: "callback_gitlab" as const,
          defaultPort: 8080,
          configuredPort: undefined,
          configurable: false as const,
        },
      ]
      return {
        ports: yield* Effect.all(
          rows.map((row) =>
            Effect.gen(function* () {
              const effective = row.configuredPort ?? row.defaultPort
              return {
                id: row.id,
                default_port: row.defaultPort,
                configured_port: row.configuredPort ?? null,
                available: yield* bindable(effective),
                configurable: row.configurable,
              }
            }),
          ),
        ),
      }
    }),
  ),
)
