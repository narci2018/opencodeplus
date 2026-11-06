import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Config } from "@opencode/core/config"
import { Bus } from "@opencode/core/bus"
import { Global } from "@opencode/util/global"
import { Credential } from "@opencode/core/credential"
import { WellKnown } from "@opencode/core/wellknown"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { emptyCredentialNode, emptyWellknownNode } from "./fixture/config-nodes"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

function testLayer(directory: string, globalDirectory = path.join(directory, "global")) {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(
      location(
        { directory: AbsolutePath.make(directory) },
        { projectDirectory: AbsolutePath.make(directory) },
      ),
    ),
  )
  const built = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
    Config.node.replace(Config.configured({ system: false })),
    Location.node.replace(locationLayer),
    Global.node.replace(Global.layerWith({ config: globalDirectory, home: path.join(globalDirectory, "home") })),
    Credential.node.replace(emptyCredentialNode),
    WellKnown.node.replace(emptyWellknownNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
  return Layer.mergeAll(built, Watcher.testLayer)
}

describe("Config.update provider patch", () => {
  it.live("writes a custom provider into the providers map and removes it cleanly", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) => {
        const global = path.join(tmp.path, "global")
        return Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(global, { recursive: true }))
          yield* Effect.promise(() => fs.writeFile(path.join(global, "opencode.json"), "{\n}\n"))

          const config = yield* Config.Service
          const update = config.update
          expect(update).toBeDefined()
          if (!update) return

          yield* update({
            provider: {
              id: "my-llm",
              package: "@opencode/ai/providers/openai-compatible",
              canonical: "openai-compatible",
              name: "My LLM",
              settings: { baseURL: "https://example.com/v1", apiKey: "sk-test" },
              models: { "gpt-4o": { name: "gpt-4o" } },
            },
          })

          const file = yield* Effect.promise(() => fs.readFile(path.join(global, "opencode.json"), "utf8"))
          expect(file).toContain("my-llm")
          expect(file).toContain("openai-compatible")
          expect(file).toContain("sk-test")
          expect(file).toContain("gpt-4o")
          expect(file).toContain("example.com")

          // Removing the last provider drops the empty `providers` map.
          yield* update({ provider: { id: "my-llm", remove: true } })
          const after = yield* Effect.promise(() => fs.readFile(path.join(global, "opencode.json"), "utf8"))
          expect(after).not.toContain("my-llm")
          expect(after).not.toContain("providers")
        }).pipe(Effect.provide(testLayer(tmp.path, global)))
      }),
    ))
})