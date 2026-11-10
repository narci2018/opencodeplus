import { describe, expect, test } from "bun:test"
import {
  agentID,
  agentPatch,
  agentPermissions,
  decodeToolSelection,
  readAgentEntries,
  TOOL_GROUPS,
  type AgentPermissionRule,
} from "./presets"

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

  test("skips built-in agents even when native flag is absent (e.g. customized prompt override)", () => {
    const entries = [
      {
        type: "document",
        info: {
          agents: {
            reviewer: { description: "Reviews code", mode: "primary" },
            build: { system: "Customized system prompt for build" },
            plan: { system: "Customized system prompt for plan" },
            trae: { system: "Customized system prompt for trae" },
            "trae-bao": { system: "Customized system prompt for trae-bao" },
            agy: { system: "Customized system prompt for agy" },
            "agy-coding-worker": { system: "Customized system prompt for worker" },
            claude: { system: "Customized system prompt for claude" },
            "claude-cowork": { system: "Customized system prompt for cowork" },
            codex: { system: "Customized system prompt for codex" },
            "codex-coder": { system: "Customized system prompt for coder" },
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

  test("passes permission rules through", () => {
    const permissions = [{ action: "shell", resource: "*", effect: "deny" as const }]

    expect(agentPatch({ id: "reviewer", permissions })).toEqual({ id: "reviewer", permissions })
  })
})

describe("agentPermissions", () => {
  test("returns undefined when every group and MCP server is enabled", () => {
    const allGroups = new Set(TOOL_GROUPS.map((group) => group.id))

    expect(agentPermissions({ enabledGroups: allGroups, enabledMcp: new Set(["github"]), configuredMcp: ["github"] })).toBeUndefined()
    expect(agentPermissions({ enabledGroups: allGroups, enabledMcp: new Set(), configuredMcp: [] })).toBeUndefined()
  })

  test("denies one rule per action of a disabled group", () => {
    const allGroups = new Set(TOOL_GROUPS.map((group) => group.id))
    allGroups.delete("shell")

    expect(agentPermissions({ enabledGroups: allGroups, enabledMcp: new Set(), configuredMcp: [] })).toEqual([
      { action: "shell", resource: "*", effect: "deny" },
    ])
  })

  test("denies unselected MCP servers with a wildcard action and keeps selected ones", () => {
    const allGroups = new Set(TOOL_GROUPS.map((group) => group.id))

    expect(
      agentPermissions({ enabledGroups: allGroups, enabledMcp: new Set(["github"]), configuredMcp: ["github", "playwright"] }),
    ).toEqual([{ action: "playwright_*", resource: "*", effect: "deny" }])
  })
})

describe("decodeToolSelection", () => {
  const allGroups = () => new Set(TOOL_GROUPS.map((group) => group.id))

  test("round-trips a selection through agentPermissions", () => {
    const all = allGroups()
    const groups = new Set([...all].filter((id) => id !== "shell" && id !== "web"))

    const rules = agentPermissions({ enabledGroups: groups, enabledMcp: new Set(["github"]), configuredMcp: ["github", "playwright"] })
    expect(rules).toBeDefined()

    expect(decodeToolSelection({ permissions: rules, configuredMcp: ["github", "playwright"] })).toEqual({
      groups,
      mcp: new Set(["github"]),
    })
  })

  test("treats missing permissions as everything enabled", () => {
    expect(decodeToolSelection({ permissions: undefined, configuredMcp: ["github"] })).toEqual({
      groups: allGroups(),
      mcp: new Set(["github"]),
    })
  })

  test("lets a later allow rule re-enable a denied group", () => {
    const permissions: AgentPermissionRule[] = [
      { action: "shell", resource: "*", effect: "deny" },
      { action: "shell", resource: "git *", effect: "allow" },
    ]

    expect(decodeToolSelection({ permissions, configuredMcp: [] }).groups).toContain("shell")
  })

  test("keeps a group disabled when only its resource is denied", () => {
    // A deny with a non-`*` resource still wins the last-match evaluation for that action, and the
    // dialog treats the group as disabled because it cannot express resource-scoped rules.
    const permissions: AgentPermissionRule[] = [{ action: "shell", resource: "rm *", effect: "deny" }]

    expect(decodeToolSelection({ permissions, configuredMcp: [] }).groups).not.toContain("shell")
  })
})

describe("readAgentEntries with permissions", () => {
  test("reads the permissions array of a stored agent", () => {
    const entries = [
      {
        type: "document",
        info: {
          agents: {
            reviewer: { permissions: [{ action: "shell", resource: "*", effect: "deny" }] },
          },
        },
      },
    ]

    expect(readAgentEntries(entries)).toEqual([
      { id: "reviewer", permissions: [{ action: "shell", resource: "*", effect: "deny" }] },
    ])
  })
})
