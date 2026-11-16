import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { Global } from "@opencode/util/global"
import { Credential } from "@opencode/core/credential"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { WellKnown } from "@opencode/core/wellknown"
import { AbsolutePath } from "@opencode/core/schema"
import { emptyCredentialNode, emptyWellknownNode } from "../fixture/config-nodes"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

function makeLayer(project: string, globalDir: string, configFile: string) {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(project) })),
  )
  return AppNodeBuilder.build(
    LayerNode.group([Config.node, Bus.node, Credential.node, WellKnown.node]),
    [
      Config.node.replace(Config.configured({ global: true, system: false, file: configFile })),
      Location.node.replace(locationLayer),
      Global.node.replace(Global.layerWith({ config: globalDir, home: path.join(globalDir, "home") })),
      Credential.node.replace(emptyCredentialNode),
      WellKnown.node.replace(emptyWellknownNode),
      Watcher.node.replace(Watcher.testLayer),
    ],
  )
}

describe("config update ports", () => {
  it.live("writes port overrides and preserves unrelated config", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const globalDir = path.join(tmp.path, "global")
          const configFile = path.join(globalDir, "opencode.jsonc")
          yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            await fs.mkdir(project, { recursive: true })
            await fs.mkdir(globalDir, { recursive: true })
            await fs.writeFile(configFile, '{\n  "model": "test/model"\n}\n')
          })

          const layer = makeLayer(project, globalDir, configFile)

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const update = config.update!

            yield* update({ ports: { callback_openai: 18080 } })
            yield* update({ ports: { callback_digitalocean: 18081 } })

            const content = yield* Effect.promise(() =>
              import("fs/promises").then((fs) => fs.readFile(configFile, "utf8")),
            )
            const parsed = JSON.parse(content)
            expect(parsed.ports).toEqual({ callback_openai: 18080, callback_digitalocean: 18081 })
            // The sequential disjoint jsonc edits must not drop the hand-written sibling.
            expect(parsed.model).toBe("test/model")
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )

  it.live("null clears an override and removes the empty ports object", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const globalDir = path.join(tmp.path, "global")
          const configFile = path.join(globalDir, "opencode.jsonc")
          yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            await fs.mkdir(project, { recursive: true })
            await fs.mkdir(globalDir, { recursive: true })
          })

          const layer = makeLayer(project, globalDir, configFile)

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const update = config.update!

            yield* update({ ports: { callback_openai: 18080 } })
            yield* update({ ports: { callback_openai: null } })

            const content = yield* Effect.promise(() =>
              import("fs/promises").then((fs) => fs.readFile(configFile, "utf8")),
            )
            const parsed = JSON.parse(content)
            expect(parsed.ports).toBeUndefined()
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )

  it.live("the latest configured port wins and decodes through normalize", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const globalDir = path.join(tmp.path, "global")
          const configFile = path.join(globalDir, "opencode.jsonc")
          yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            await fs.mkdir(project, { recursive: true })
            await fs.mkdir(globalDir, { recursive: true })
          })

          const layer = makeLayer(project, globalDir, configFile)

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const update = config.update!

            yield* update({ ports: { callback_openai: 18080 } })

            const entries = yield* config.entries()
            const ports = entries
              .filter((entry) => entry.type === "document")
              .flatMap((entry) => (entry.info.ports ? [entry.info.ports] : []))
              .at(-1)
            // Normalize must pass the nested object through or the plugins would read undefined.
            expect(ports?.callback_openai).toBe(18080)
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )
})
