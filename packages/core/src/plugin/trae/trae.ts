export * as TraePlugin from "./trae.js"

import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../../agent.js"
import ComputerBinding from "./computer-binding.js"
import systemPrompt from "./system.md" with { type: "text" }
import traeBaoPrompt from "./trae-bao.md" with { type: "text" }

const require = createRequire(import.meta.url)

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

    // Resolve or extract executable to real filesystem
    // (Bun's embedded "B:/~BUN/..." or "/$bunfs/..." files are virtual and cannot be spawned by OS)
    const executable = yield* Effect.promise(async () => {
      const isVirtualPath = (p: string) =>
        p.includes("~BUN") ||
        p.includes("bunfs") ||
        p.startsWith("/$bunfs") ||
        /^[a-zA-Z]:[/\\]~BUN/i.test(p)

      // If it's a real physical binary on disk, use it directly
      if (!isVirtualPath(binding.path) && existsSync(binding.path)) {
        return binding.path
      }

      const exeName = process.platform === "win32" ? "open-computer-use.exe" : "open-computer-use"
      const binDir = path.join(cwd, "bin", `${binding.version}-${binding.sha256?.slice(0, 16) ?? "embedded"}`)
      const target = path.join(binDir, exeName)

      try {
        mkdirSync(binDir, { recursive: true })
        if (existsSync(target)) {
          const stats = statSync(target)
          if (stats.size > 0) return target
        }

        // Read embedded asset via Bun.file
        // @ts-ignore
        if (typeof Bun !== "undefined" && typeof Bun.file === "function") {
          // @ts-ignore
          const file = Bun.file(binding.path)
          const arrayBuffer = await file.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          if (bytes.byteLength > 0) {
            const temp = path.join(binDir, `${exeName}.${process.pid}.${Date.now()}.tmp`)
            writeFileSync(temp, bytes, { mode: 0o755 })
            try {
              renameSync(temp, target)
            } catch {
              try {
                copyFileSync(temp, target)
                unlinkSync(temp)
              } catch {}
            }
            if (existsSync(target) && statSync(target).size > 0) {
              return target
            }
          }
        }
      } catch (err) {
        console.error("Failed to extract embedded computer-use binary:", err)
      }

      // Fallback: check node_modules resolution
      try {
        const manifestPath = require.resolve("open-computer-use/package.json")
        const root = path.dirname(manifestPath)
        const fallbackExe =
          process.platform === "win32"
            ? path.join(root, "dist", "windows", process.arch === "arm64" ? "arm64" : "amd64", "open-computer-use.exe")
            : process.platform === "linux"
              ? path.join(root, "dist", "linux", process.arch === "arm64" ? "arm64" : "amd64", "open-computer-use")
              : undefined
        if (fallbackExe && existsSync(fallbackExe)) return fallbackExe
      } catch {}

      return existsSync(target) ? target : binding.path
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
