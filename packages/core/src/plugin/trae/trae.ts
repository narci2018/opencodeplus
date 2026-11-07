export * as TraePlugin from "./trae.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../../agent.js"
import ComputerBinding from "./computer-binding.js"
import systemPrompt from "./system.md" with { type: "text" }

// The TRAE agent is a built-in orchestrator over Code Mode, browser, and desktop tools. The
// computer-use MCP server rides along: its native binary ships embedded in the CLI (resolved
// from the workspace dev dependency in development) and registers here as an in-memory server
// override, so no user configuration is involved. When the binary is unavailable — other
// platforms, stripped builds — nothing is registered and the agent's prompt tells it to report
// desktop automation as unavailable instead of inventing calls.
export const Plugin = define({
  id: "opencode.trae",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.ID.make("trae"), (item) => {
        item.name = Agent.Name.make("TRAE")
        item.description =
          "Orchestrator agent that drives code, browser, and desktop tools through Code Mode. Use it for multi-step tasks spanning web pages, native apps, and the filesystem."
        item.system = systemPrompt
        item.mode = "all"
        item.native = true
      })
    })

    const binding = ComputerBinding
    if (!binding) return
    yield* ctx.mcp.transform((editor) => {
      editor.set("computer-use", {
        type: "local",
        command: [binding.path, "mcp"],
        cwd: binding.cwd,
      })
    })
  }),
})
