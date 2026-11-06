import { describe, expect, test } from "bun:test"
import { agentID, agentPatch, readAgentEntries } from "./presets"

describe("agentID", () => {
  test("slugs a display name into a safe agent id", () => {
    expect(agentID("My Reviewer")).toBe("my-reviewer")
    expect(agentID("  code  reviewer  ")).toBe("code-reviewer")
    expect(agentID("!!!")).toBe("custom-agent")
  })
})

describe("readAgentEntries", () => {
  test("reads only user-defined agents, skipping built-in config overrides", () => {
    const entries = [
      {
        type: "document",
        info: {
          agents: {
            reviewer: { description: "Reviews code", mode: "primary" },
            build: { name: "Build", native: true },
          },
        },
      },
    ]

    const result = readAgentEntries(entries)

    expect(result).toEqual([{ id: "reviewer", description: "Reviews code", mode: "primary" }])
  })

  test("keeps the highest-precedence document for duplicate ids", () => {
    const entries = [
      { type: "document", info: { agents: { reviewer: { description: "First" } } } },
      { type: "document", info: { agents: { reviewer: { description: "Second" } } } },
    ]

    expect(readAgentEntries(entries)).toEqual([{ id: "reviewer", description: "First" }])
  })
})

describe("agentPatch", () => {
  test("builds a config agent patch with the given fields", () => {
    const patch = agentPatch({
      id: "reviewer",
      description: "Reviews code",
      system: "You review code.",
      mode: "primary",
    })

    expect(patch).toEqual({
      id: "reviewer",
      description: "Reviews code",
      system: "You review code.",
      mode: "primary",
    })
  })

  test("omits empty optional fields", () => {
    const patch = agentPatch({ id: "reviewer" })

    expect(patch).toEqual({ id: "reviewer" })
  })
})
