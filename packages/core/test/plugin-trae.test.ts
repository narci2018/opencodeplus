import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type { Plugin } from "@opencode/plugin/effect"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { TraePlugin } from "@opencode/core/plugin/trae/trae"
import { Document, Info } from "@opencode/schema/config"
import { AbsolutePath } from "@opencode/core/schema"
import { Global } from "@opencode/util/global"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Agent.node, Location.node]), [
    Global.node.replace(Layer.succeed(Global.Service, Global.make({ data: "/data", config: "/config", tmp: "/tmp/opencode" }))),
    Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") })))),
  ]) as unknown as Layer.Layer<unknown, never>,
)

type EditorLike = {
  list(): [string, unknown][]
  get(name: string): unknown
  set(name: string, config: unknown): void
  update(): void
  remove(name: string): void
}

/** Capturing mcp domain so the test can assert the in-memory server override. */
const mcpHost = () => {
  const servers = new Map<string, unknown>()
  const editor: EditorLike = {
    list: () => [...servers.entries()],
    get: (name) => servers.get(name),
    set: (name, config) => {
      servers.set(name, config)
    },
    update: () => {},
    remove: (name) => {
      servers.delete(name)
    },
  }
  const domain = {
    list: () => Effect.succeed(editor.list()),
    transform: (callback: (editor: EditorLike) => void) => Effect.sync(() => callback(editor)),
    reload: () => Effect.void,
  }
  return { domain: domain as unknown as Plugin.Context["mcp"], servers }
}

describe("TraePlugin", () => {
  it.effect("registers the TRAE agent as a callable orchestrator", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const mcp = mcpHost()
      yield* TraePlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
          mcp: mcp.domain,
        }),
      ).pipe(Effect.provide(Config.testLayer([])))

      const trae = yield* agent.get(Agent.ID.make("trae"))
      expect(trae).toBeDefined()
      expect(String(trae?.name)).toBe("TRAE")
      expect(trae?.mode).toBe("all")
      expect(trae?.native).toBe(true)
      expect(trae?.system).toContain("tools.browser.snapshot")
      expect(trae?.system).toContain("tools.computer_use")
      // Same baseline as build: everything allowed except .env reads.
      expect(Permission.evaluate("shell", "git log -5", trae?.permissions ?? []).effect).toBe("allow")
      expect(Permission.evaluate("read", ".env", trae?.permissions ?? []).effect).toBe("ask")
    }),
  )

  it.effect("adds the computer-use server as an in-memory override", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const mcp = mcpHost()
      yield* TraePlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
          mcp: mcp.domain,
        }),
      ).pipe(Effect.provide(Config.testLayer([])))

      const config = mcp.servers.get("computer-use") as { type: string; command: string[] } | undefined
      if (!config) throw new Error("expected the computer-use server override")
      expect(config.type).toBe("local")
      expect(config.command[1]).toBe("mcp")
      expect(config.command[0]).toContain("open-computer-use")
    }),
  )

  it.effect("skips the computer-use server when config opts out", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const mcp = mcpHost()
      const config = new Document({
        type: "document",
        info: Info.make({ trae: { computer_use: false } }),
      })
      yield* TraePlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
          mcp: mcp.domain,
        }),
      ).pipe(Effect.provide(Config.testLayer([config])))

      expect(mcp.servers.has("computer-use")).toBe(false)
      // Agent personas are still registered; only desktop automation is skipped.
      expect(yield* agent.get(Agent.ID.make("trae"))).toBeDefined()
    }),
  )
})
