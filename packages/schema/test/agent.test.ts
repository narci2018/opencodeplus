import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "../src/agent.js"

test("Agent.Color preserves configured colors at the public boundary", () => {
  const encode = Schema.encodeSync(Agent.Color)

  expect(encode("info")).toBe("info")
  expect(encode("custom-color")).toBe("custom-color")
})

test("Agent.Info marks a fresh agent as non-native and round-trips the native flag", () => {
  const fresh = Agent.Info.default(Agent.ID.make("reviewer"))
  expect(fresh.native).toBe(false)

  const decoded = Schema.decodeUnknownSync(Agent.Info)({
    ...fresh,
    native: true,
  })
  expect(decoded.native).toBe(true)
})
