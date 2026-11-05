import { UsageLimits } from "@opencode/core/usage-limits"
import { ServiceUnavailableError } from "@opencode/protocol/errors"
import { EgressInfo } from "@opencode/protocol/groups/usage"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

export const UsageHandler = HttpApiBuilder.group(Api, "server.usage", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "usage.limits",
        Effect.fn("server.usage.limits")(function* () {
          // The OpenCode Console plugin registers the sign-in method that refreshes an expired credential.
          yield* awaitPlugins
          const limits = yield* UsageLimits.Service
          return yield* response(
            limits.get().pipe(
              Effect.map((info) => info ?? null),
              Effect.mapError((error) => new ServiceUnavailableError({ message: error.message, service: "opencode" })),
            ),
          )
        }),
      )
      .handle(
        "network.egress",
        Effect.fn("server.network.egress")(function* () {
          const ip = yield* Effect.tryPromise(() =>
            fetch("https://myip.ipip.net/json", { signal: AbortSignal.timeout(10_000) }),
          ).pipe(
            Effect.flatMap((response) =>
              Effect.tryPromise(async () => {
                const body = (await response.json()) as unknown
                // SAFETY: myip.ipip.net returns `{"ret":"ok","data":{"ip":"1.2.3.4",...}}`; anything else
                // is a provider change, and the diagnostic treats it as "could not determine".
                return Schema.decodeUnknownSync(EgressIp)(body)
              }),
            ),
            Effect.map((value) => value.data.ip),
            Effect.catch(() => Effect.succeed(null)),
          )

          const proxy = (name: string) => process.env[name] || process.env[name.toLowerCase()] || null

          return EgressInfo.make({
            proxy: {
              https: proxy("HTTPS_PROXY"),
              http: proxy("HTTP_PROXY"),
              noProxy: proxy("NO_PROXY"),
            },
            ip,
          })
        }),
      )
  }),
)

const EgressIp = Schema.Struct({
  data: Schema.Struct({
    ip: Schema.String,
  }),
})
