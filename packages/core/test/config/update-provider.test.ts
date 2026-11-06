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

/**
 * Regression test for the custom-model edit flow: after `Config.update` writes a provider
 * entry, the config entries must carry the edited model id immediately — before any
 * client-initiated refetch. Previously `Config.update` published a debounced reload and
 * returned before it ran, so the first read after the write still held the old config.
 */
describe("config update provider refresh", () => {
  it.live("reflects an edited provider model id immediately after Config.update", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const globalDir = path.join(tmp.path, "global")
          const configFile = path.join(globalDir, "opencode.json")
          yield* Effect.promise(async () => {
            const fs = await import("fs/promises")
            await fs.mkdir(project, { recursive: true })
            await fs.mkdir(globalDir, { recursive: true })
          })

          const locationLayer = Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make(project) })),
          )
          const layer = AppNodeBuilder.build(
            LayerNode.group([Config.node, Bus.node, Credential.node, WellKnown.node]),
            [
              Config.node.replace(
                Config.configured({
                  global: true,
                  system: false,
                  file: configFile,
                }),
              ),
              Location.node.replace(locationLayer),
              Global.node.replace(Global.layerWith({ config: globalDir, home: path.join(globalDir, "home") })),
              Credential.node.replace(emptyCredentialNode),
              WellKnown.node.replace(emptyWellknownNode),
              Watcher.node.replace(Watcher.testLayer),
            ],
          )

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            // The configured layer always provides `update`; the optional signature is for
            // interface compatibility (test/in-memory layers may omit it).
            const update = config.update!

            // Write an initial provider, then edit its model id through Config.update,
            // exactly as the custom-model dialog does on save.
            yield* update({
              provider: {
                id: "demo",
                package: "@opencode/ai/providers/openai-compatible",
                canonical: "openai-compatible",
                name: "Demo",
                settings: { baseURL: "https://demo.example/v1" },
                models: { "old-model": { name: "old-model" } },
              },
            })

            const readModels = () =>
              config.entries().pipe(
                Effect.map((entries) =>
                  entries
                    .filter((entry) => entry.type === "document")
                    .flatMap((entry) => Object.entries(entry.type === "document" ? (entry.info.providers ?? {}) : {}))
                    .find(([id]) => id === "demo")?.[1],
                ),
              )
            expect(yield* readModels()).toMatchObject({
              models: { "old-model": { name: "old-model" } },
            })

            // Edit: change the model id. The dialog resolves `config.update` and immediately
            // refetches providers; the config entries must already show the new model.
            yield* update({
              provider: {
                id: "demo",
                package: "@opencode/ai/providers/openai-compatible",
                canonical: "openai-compatible",
                name: "Demo",
                settings: { baseURL: "https://demo.example/v1" },
                models: { "agnes-2.5-flash": { name: "agnes-2.5-flash" } },
              },
            })

            expect(yield* readModels()).toMatchObject({
              models: { "agnes-2.5-flash": { name: "agnes-2.5-flash" } },
            })
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )
})
