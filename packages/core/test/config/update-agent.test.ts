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
 * Regression test for the custom-agent flow: after `Config.update` writes an agent
 * entry, the config entries must carry it immediately — before any client-initiated
 * refetch. This mirrors the custom-model edit contract and keeps the agent dialog's
 * "save then refresh" path from reading stale config.
 */
describe("config update agent refresh", () => {
  it.live("reflects an added and edited custom agent immediately after Config.update", () =>
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
            const update = config.update!

            // Add a custom agent, exactly as the custom-agent dialog does on save.
            yield* update({
              agent: {
                id: "reviewer",
                description: "Reviews code",
                system: "You review code.",
                mode: "primary",
              },
            })

            const readAgents = () =>
              config.entries().pipe(
                Effect.map((entries) =>
                  entries
                    .filter((entry) => entry.type === "document")
                    .flatMap((entry) => Object.entries(entry.type === "document" ? (entry.info.agents ?? {}) : {}))
                    .find(([id]) => id === "reviewer")?.[1],
                ),
              )
            expect(yield* readAgents()).toMatchObject({
              description: "Reviews code",
              system: "You review code.",
              mode: "primary",
            })

            // Edit: change the description. The dialog resolves `config.update` and
            // immediately refetches agents; the config entries must already show the new value.
            yield* update({
              agent: {
                id: "reviewer",
                description: "Reviews code and tests",
                system: "You review code.",
                mode: "primary",
              },
            })

            expect(yield* readAgents()).toMatchObject({
              description: "Reviews code and tests",
            })
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )
})
