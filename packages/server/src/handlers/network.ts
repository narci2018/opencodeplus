import { EgressInfo, ProxyResponse } from "@opencode/protocol/groups/network"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import fs from "fs"
import path from "path"
import { Global } from "@opencode/util/global"
import { Api } from "../api"

export const NetworkHandler = HttpApiBuilder.group(Api, "server.network", (handlers) =>
  handlers
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
    )
    .handle(
      "network.proxy",
      Effect.fn("server.network.proxy")(function* (req) {
        const input = req.payload
        const timeout = input.timeout ?? 15_000
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(input.url, {
              method: input.method,
              headers: input.headers,
              signal: controller.signal,
            }),
          catch: (cause) => new InvalidRequestError({ message: `Proxy request failed: ${cause instanceof Error ? cause.message : String(cause)}` }),
        })
        clearTimeout(timer)
        const body = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) => new InvalidRequestError({ message: `Failed to read response body: ${cause instanceof Error ? cause.message : String(cause)}` }),
        })
        return ProxyResponse.make({
          status: response.status,
          statusText: response.statusText,
          body,
        })
      }),
    )
    .handle(
      "network.fingerprint",
      Effect.fn("server.network.fingerprint")(function* (req) {
        const input = req.payload
        const configPath = Global.Path.config
        const fingerprintPath = path.join(configPath, "fingerprint.json")

        if (input.fingerprint === null) {
          yield* Effect.tryPromise({
            try: () => fs.promises.unlink(fingerprintPath).catch(() => undefined),
            catch: (cause) => new InvalidRequestError({ message: `Failed to clear fingerprint: ${cause instanceof Error ? cause.message : String(cause)}` }),
          })
        } else {
          const data = {
            active: true,
            ...input.fingerprint,
            updatedAt: new Date().toISOString(),
          }
          yield* Effect.tryPromise({
            try: () => fs.promises.writeFile(fingerprintPath, JSON.stringify(data, null, 2), "utf-8"),
            catch: (cause) => new InvalidRequestError({ message: `Failed to save fingerprint: ${cause instanceof Error ? cause.message : String(cause)}` }),
          })
        }
        return { ok: true }
      }),
    ),
)

const EgressIp = Schema.Struct({
  data: Schema.Struct({
    ip: Schema.String,
  }),
})
