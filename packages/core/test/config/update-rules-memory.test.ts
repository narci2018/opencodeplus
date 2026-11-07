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

describe("config update rules & memory", () => {
  it.live("writes rules and memory toggles to the config file", () =>
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

            yield* update({ rules: { claude_md: true } })
            yield* update({ rules: { agents_md: false } })
            yield* update({ memory: { enabled: false, distill: false } })
            yield* update({ instruction: { source: "~/rules/a.md" } })
            yield* update({ instruction: { source: "https://example.com/rules.md" } })

            const content = yield* Effect.promise(() =>
              import("fs/promises").then((fs) => fs.readFile(configFile, "utf8")),
            )
            const parsed = JSON.parse(content)
            expect(parsed.rules).toEqual({ claude_md: true, agents_md: false })
            expect(parsed.memory).toEqual({ enabled: false, distill: false })
            expect(parsed.instructions).toEqual(["~/rules/a.md", "https://example.com/rules.md"])
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )

  it.live("removes rules, memory, and instruction entries with cleanup", () =>
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

            yield* update({ rules: { claude_md: true } })
            yield* update({ rules: { claude_md: true, agents_md: true } })
            yield* update({ memory: { enabled: true, distill: true } })
            yield* update({ instruction: { source: "~/rules/a.md" } })

            yield* update({ instruction: { source: "~/rules/a.md", remove: true } })

            const content = yield* Effect.promise(() =>
              import("fs/promises").then((fs) => fs.readFile(configFile, "utf8")),
            )
            const parsed = JSON.parse(content)
            expect(parsed.instructions).toBeUndefined()
            expect(parsed.rules).toEqual({ claude_md: true, agents_md: true })
            expect(parsed.memory).toEqual({ enabled: true, distill: true })
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )
})
