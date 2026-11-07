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

describe("config update extensions", () => {
  it.live("upserts, edits, and removes an MCP server with empty-map cleanup", () =>
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

          const layer = makeLayer(project, globalDir, configFile)

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const update = config.update!

            const readServers = () =>
              config.entries().pipe(
                Effect.map((entries) => {
                  const document = [...entries].reverse().find((entry) => entry.type === "document")
                  return document && document.type === "document" ? document.info.mcp?.servers : undefined
                }),
              )

            yield* update({
              mcp: { name: "playwright", config: { type: "local", command: ["npx", "-y", "@playwright/mcp@latest"] } },
            })
            let servers = yield* readServers()
            expect(servers?.playwright).toMatchObject({ type: "local", command: ["npx", "-y", "@playwright/mcp@latest"] })

            // Edit: replace the entry in place.
            yield* update({ mcp: { name: "playwright", config: { type: "remote", url: "https://mcp.example.com" } } })
            servers = yield* readServers()
            expect(servers?.playwright).toMatchObject({ type: "remote", url: "https://mcp.example.com" })

            // Remove: the server goes, and the emptied `mcp` key is dropped for a clean document.
            yield* update({ mcp: { name: "playwright", remove: true } })
            servers = yield* readServers()
            expect(servers).toBeUndefined()
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )

  it.live("adds, dedupes, and removes plugins and skills sources", () =>
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

          const layer = makeLayer(project, globalDir, configFile)

          return yield* Effect.gen(function* () {
            const config = yield* Config.Service
            const update = config.update!

            const readConfig = () =>
              config.entries().pipe(
                Effect.map((entries) => {
                  const document = [...entries].reverse().find((entry) => entry.type === "document")
                  return {
                    plugins: document && document.type === "document" ? document.info.plugins : undefined,
                    skills: document && document.type === "document" ? document.info.skills : undefined,
                  }
                }),
              )

            yield* update({ plugin: { package: "@opencode/plugin-figma" } })
            yield* update({ plugin: { package: "@opencode/plugin-figma" } })
            yield* update({ skill: { source: "C:/my/skills" } })
            yield* update({ skill: { source: "https://example.com/skills" } })

            let current = yield* readConfig()
            expect(current.plugins).toEqual(["@opencode/plugin-figma"])
            expect(current.skills).toEqual(["C:/my/skills", "https://example.com/skills"])

            yield* update({ skill: { source: "C:/my/skills", remove: true } })
            yield* update({ plugin: { package: "@opencode/plugin-figma", remove: true } })
            current = yield* readConfig()
            expect(current.plugins).toBeUndefined()
            expect(current.skills).toEqual(["https://example.com/skills"])
          }).pipe(Effect.provide(layer))
        }),
      ),
    ),
  )
})
