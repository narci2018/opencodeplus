import { EgressInfo } from "@opencode/protocol/groups/network"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

export const NetworkHandler = HttpApiBuilder.group(Api, "server.network", (handlers) =>
  handlers.handle(
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
        Effect.orElseSucceed(() => null),
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
  ),
)

const EgressIp = Schema.Struct({
  data: Schema.Struct({
    ip: Schema.String,
  }),
})
