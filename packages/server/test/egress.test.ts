import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

/** Requests the network egress probe from a server with no extra overrides. */
const request = () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-egress-")))
    const global = path.join(tmp.path, "global")
    yield* Effect.promise(() => fs.mkdir(global))
    const handler = yield* ServerFetch.make(
      {
        database: { path: ":memory:" },
        config: { directory: global },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      {
        overrides: [],
      },
    )
    const response = yield* Effect.promise(() => handler(new Request(new URL("/api/experimental/network/egress", "http://opencode.local"))))
    return { status: response.status, body: yield* Effect.promise(() => response.json()) }
  })

it.live("serves the network egress probe from its own group", () =>
  Effect.gen(function* () {
    const result = yield* request()
    expect(result.status).toBe(200)
    expect(result.body).toHaveProperty("proxy")
    expect(result.body.proxy).toHaveProperty("https")
    expect(result.body.proxy).toHaveProperty("http")
    expect(result.body.proxy).toHaveProperty("noProxy")
    expect(result.body).toHaveProperty("ip")
  }),
)
