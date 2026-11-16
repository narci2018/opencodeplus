import { expect } from "bun:test"
import { createServer } from "node:net"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const options = {
  app: { version: "test-version" },
  database: { path: ":memory:" },
  config: { project: false },
  models: { fetch: false },
  fs: { filewatcher: false },
} as const

type PortRow = {
  id: string
  default_port: number
  configured_port: number | null
  available: boolean
  configurable: boolean
}

const rows = Effect.fn("ports rows")(function* (response: Response) {
  expect(response.status).toBe(200)
  const body = (yield* Effect.promise(() => response.json())) as { ports: PortRow[] }
  return body.ports
})

it.live("reports the configured callback port as occupied when another listener holds it", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-ports-")))
    const directory = tmp.path

    // A system-assigned ephemeral port, held open by this test, stands in for the occupant.
    const holder = createServer()
    yield* Effect.addFinalizer(() => Effect.sync(() => holder.close()))
    const port = yield* Effect.callback<number, Error>((resume) => {
      holder.once("error", (error) => resume(Effect.fail(error)))
      holder.listen(0, "127.0.0.1", () => {
        const address = holder.address()
        resume(Effect.succeed(typeof address === "object" && address !== null ? address.port : 0))
      })
    })

    const handler = yield* ServerFetch.make({
      ...options,
      config: { directory, project: false, content: JSON.stringify({ ports: { callback_openai: port } }) },
    })
    const response = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/experimental/ports", {
          headers: { "x-opencode-directory": encodeURIComponent(directory) },
        }),
      ),
    )
    const ports = yield* rows(response)

    const openai = ports.find((row) => row.id === "callback_openai")
    expect(openai).toBeTruthy()
    expect(openai!.configured_port).toBe(port)
    expect(openai!.available).toBe(false)

    const fallback = ports.find((row) => row.id === "callback_openai_fallback")
    expect(fallback!.configured_port).toBeNull()
    expect(fallback!.default_port).toBe(1457)

    // DigitalOcean keeps its default; the probe is honest about whether it is free right now.
    const digitalocean = ports.find((row) => row.id === "callback_digitalocean")
    expect(digitalocean!.configured_port).toBeNull()
    expect(typeof digitalocean!.available).toBe("boolean")

    // GitLab is listed, marked non-configurable, and probed on its fixed port.
    const gitlab = ports.find((row) => row.id === "callback_gitlab")
    expect(gitlab!.configurable).toBe(false)
    expect(gitlab!.default_port).toBe(8080)
  }),
)

it.live("lists every known port with defaults when no config overrides exist", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make(options)
    const response = yield* Effect.promise(() =>
      handler(new Request("http://opencode.local/api/experimental/ports")),
    )
    const ports = yield* rows(response)

    expect(ports.map((row) => row.id).toSorted()).toEqual(
      ["callback_digitalocean", "callback_gitlab", "callback_openai", "callback_openai_fallback"].toSorted(),
    )
    for (const row of ports) expect(row.configured_port).toBeNull()
  }),
)
