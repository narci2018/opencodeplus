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

describe("config update provider disabled", () => {
  it.live("writes disabled alongside the entry fields and decodes back", () =>
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

            yield* update({
              provider: {
                id: "zro",
                package: "@opencode/ai/providers/openai-compatible",
                canonical: "openai-compatible",
                name: "ZRO",
                settings: { baseURL: "https://api.zro.test/v1", apiKey: "sk-zro" },
                models: { "zro-model": { name: "zro-model" } },
              },
            })
            yield* update({
              provider: {
                id: "zro",
                package: "@opencode/ai/providers/openai-compatible",
                canonical: "openai-compatible",
                name: "ZRO",
                settings: { baseURL: "https://api.zro.test/v1", apiKey: "sk-zro" },
                models: { "zro-model": { name: "zro-model" } },
                disabled: true,
              },
            })

            const content = yield* Effect.promise(() =>
              import("fs/promises").then((fs) => fs.readFile(configFile, "utf8")),
            )
            const parsed = JSON.parse(content)
            // Disabling keeps the whole entry; no field is dropped when config.update replaces it.
            expect(parsed.providers.zro.disabled).toBe(true)
            expect(parsed.providers.zro.settings.apiKey).toBe("sk-zro")
            expect(parsed.providers.zro.models["zro-model"]).toEqual({ name: "zro-model" })

            const entries = yield* config.entries()
            const decoded = entries
              .filter((entry) => entry.type === "document")
              .flatMap((entry) => Object.entries(entry.info.providers ?? {}))
              .find(([id]) => id === "zro")?.[1]
            expect(decoded?.disabled).toBe(true)
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )
})
