export * as TraePlugin from "./trae.js"

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../../agent.js"
import ComputerBinding from "./computer-binding.js"
import systemPrompt from "./system.md" with { type: "text" }
import traeBaoPrompt from "./trae-bao.md" with { type: "text" }

// The TRAE agent is a built-in orchestrator over Code Mode, browser, and desktop tools. The
// computer-use MCP server rides along: its native binary ships embedded in the CLI (resolved
// from the workspace dev dependency in development) and registers here as an in-memory server
// override, so no user configuration is involved. When the binary is unavailable — other
// platforms, stripped builds — nothing is registered and the agent's prompt tells it to report
// desktop automation as unavailable instead of inventing calls.
// TRAE 宝 is the developer companion assistant with cross-project memory, task decomposition,
// and agile developer coordination ported from Trae CN.
export const Plugin = define({
  id: "opencode.trae",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("trae"), (item) => {
        item.name = Agent.Name.make("TRAE")
        item.description =
          "Trae CN 主智能体：通过 Code Mode 驱动代码、浏览器与系统工具的编排专家，擅长多步骤复杂任务。"
        item.system = systemPrompt
        item.mode = "all"
        item.native = true
      })

      editor.update(Agent.ID.make("trae-bao"), (item) => {
        item.name = Agent.Name.make("TRAE 宝")
        item.description =
          "Trae CN 开发者伙伴助理：跨项目记忆、多任务拆解并行、敏捷开发协作者与专属助理。"
        item.system = traeBaoPrompt
        item.mode = "all"
        item.native = true
      })
    })

    const binding = ComputerBinding
    if (!binding?.path) return
    const cwd = binding.cwd || path.join(os.tmpdir(), "opencode-computer-use")
    try {
      mkdirSync(cwd, { recursive: true })
    } catch {}

    // Resolve or extract executable to real filesystem (Bun's embedded "B:/~BUN/..." files cannot be spawned directly)
    const executable = yield* Effect.promise(async () => {
      if (existsSync(binding.path)) return binding.path
      try {
        const binDir = path.join(cwd, "bin", `${binding.version}-${binding.sha256?.slice(0, 16) ?? "embedded"}`)
        mkdirSync(binDir, { recursive: true })
        const exeName = process.platform === "win32" ? "open-computer-use.exe" : "open-computer-use"
        const target = path.join(binDir, exeName)
        if (existsSync(target)) return target

        // Read embedded asset via Bun.file
        // @ts-ignore
        if (typeof Bun !== "undefined") {
          // @ts-ignore
          const file = Bun.file(binding.path)
          const arrayBuffer = await file.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          if (bytes.byteLength > 0) {
            writeFileSync(target, bytes, { mode: 0o755 })
            return target
          }
        }
      } catch (err) {
        console.error("Failed to extract embedded computer-use binary:", err)
      }
      return binding.path
    })

    yield* ctx.mcp.transform((editor) => {
      editor.set("computer-use", {
        type: "local",
        command: [executable, "mcp"],
        cwd,
      })
    })
  }),
})
