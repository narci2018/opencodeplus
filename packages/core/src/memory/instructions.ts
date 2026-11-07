export * as MemoryInstructions from "./instructions.js"

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { Effect, Schema } from "effect"
import { Instructions } from "../instructions/index.js"

const globalMemoryPath = (configDirectory: string) => path.join(configDirectory, "memory", "MEMORY.md")
const projectMemoryPath = (canonical: string) => path.join(canonical, ".opencode", "memory", "MEMORY.md")

const source = (key: "core/memory-global" | "core/memory-project", filepath: string) => {
  // Memory files are plain markdown read synchronously; a missing or empty file yields no source.
  let content: string
  try {
    content = existsSync(filepath) ? readFileSync(filepath, "utf8") : ""
  } catch {
    content = ""
  }
  if (!content.trim()) return []
  return [
    Instructions.make<string>({
      key: Instructions.Key.make(key),
      codec: Schema.toCodecJson(Schema.String),
      read: Effect.succeed(content),
      render: {
        initial: (current) => current,
        changed: (_previous, current) => current,
        removed: () => "The memory file no longer exists. Previously remembered facts no longer apply.",
      },
    }),
  ]
}

/**
 * Builds the memory instruction sources. `configDirectory` is the global config directory and
 * `projectCanonical` the project root; both are provided by the calling session context.
 */
export const load = (configDirectory: string, projectCanonical: string): Instructions.List =>
  [
    ...source("core/memory-global", globalMemoryPath(configDirectory)),
    ...source("core/memory-project", projectMemoryPath(projectCanonical)),
  ].flat()

export const projectMemoryPathFor = projectMemoryPath
