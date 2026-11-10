import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type { Plugin } from "@opencode/plugin/effect"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { AntigravityPlugin } from "@opencode/core/plugin/antigravity/antigravity"
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

// The full set of Antigravity swarm subagents the plugin registers.
const AGY_AGENT_IDS = [
  "agy-swarm-orchestrator",
  "agy-swarm-follower",
  "agy-swarm-synthesizer",
  "agy-pipeline-conductor",
  "agy-pipeline-coordinator",
  "agy-coding-worker",
  "agy-investigation-worker",
  "agy-reviewer",
  "agy-coordinator",
  "agy-critic-orchestrator",
  "agy-teamwork-aggregator",
  "agy-teamwork-critic",
  "agy-teamwork-explorer",
  "agy-teamwork-interviewer",
  "agy-teamwork-specialist",
  "agy-blackboard-manager",
  "agy-problem-decomposer",
  "agy-subproblem-solver",
  "agy-synthesizer",
  "agy-test-writer",
  "agy-code-analysis-expert",
  "agy-codebase-nav-expert",
  "agy-dependency-auditor",
  "agy-document-ingestor",
  "agy-command-safety-adjudicator",
  "agy-tool-calling-agent",
  "agy-research-subagent",
  "agy-dispatch-orchestrator",
  "agy-browser-agent",
] as const

describe("AntigravityPlugin", () => {
  it.effect("registers the Antigravity main conductor as a selectable primary agent", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      yield* AntigravityPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      )

      const agy = yield* agent.get(Agent.ID.make("agy"))
      expect(agy).toBeDefined()
      expect(String(agy?.name)).toBe("Antigravity")
      expect(agy?.mode).toBe("all")
      expect(agy?.native).toBe(true)
      expect(agy?.system).toContain("Antigravity")
      expect(agy?.system).toContain("subagent")
    }),
  )

  it.effect("registers all Antigravity swarm agents as callable subagents", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      yield* AntigravityPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      )

      for (const id of AGY_AGENT_IDS) {
        const registered = yield* agent.get(Agent.ID.make(id))
        expect(registered, `agent ${id} should be registered`).toBeDefined()
        expect(registered?.mode, `${id} mode`).toBe("subagent")
        expect(registered?.native, `${id} native`).toBe(true)
        expect(registered?.system, `${id} system prompt`).toBeTruthy()
        expect(registered?.system, `${id} system starts with role`).toMatch(/^You are /)
      }
    }),
  )

  it.effect("registers the swarm orchestration core with coherent prompts", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      yield* AntigravityPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      )

      const orchestrator = yield* agent.get(Agent.ID.make("agy-swarm-orchestrator"))
      expect(orchestrator?.system).toContain("Swarm Orchestrator")
      expect(orchestrator?.system).toContain("blackboard")
      expect(orchestrator?.system).toContain("stigmergy")

      const follower = yield* agent.get(Agent.ID.make("agy-swarm-follower"))
      expect(follower?.system).toContain("swarm_follower")
      expect(follower?.system).toContain("output_")

      const coding = yield* agent.get(Agent.ID.make("agy-coding-worker"))
      expect(coding?.system).toContain("coding worker")
      expect(coding?.system).toContain("original_task")
    }),
  )
})
