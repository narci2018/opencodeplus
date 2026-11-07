export * as MemoryPlugin from "./memory.js"

import { Cause, Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Session } from "@opencode/schema/session"
import { FSUtil } from "@opencode/util/fs-util"
import path from "node:path"
import { Config } from "../config.js"
import { Location } from "../location.js"

const DISTILL_PROMPT = (memory: string) =>
  [
    "You maintain this project's long-term memory for future sessions. The current memory file follows.",
    "<memory>",
    memory.trim() || "(the memory file is empty)",
    "</memory>",
    "",
    "From this conversation, extract durable facts worth remembering in future sessions on this project:",
    "user preferences and corrections, decisions and their reasons, project conventions, environment",
    "specifics, and ongoing goals. Do not record transient task details, code snippets, file lists, or",
    "anything the memory file already covers.",
    "",
    "Merge them into the memory file: keep correct existing entries verbatim, fix entries this",
    "conversation proved wrong, add new ones, and keep the whole file concise markdown starting with",
    "a `# Memory` heading.",
    "",
    'Reply with the FULL updated memory file content and nothing else - no fences, no commentary.',
    'Reply with exactly "NO_UPDATE" when nothing worth remembering emerged from this conversation.',
  ].join("\n")

export const Plugin = define({
  id: "opencode.memory",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    // The supervisor runs per location, so this location's project is the distill target for the
    // sessions idling here.
    const location = yield* Location.Service
    // Last seen model-visible message count per session: an idle with no new messages since the
    // previous distill would only re-derive the same memory.
    const distilled = new Map<string, number>()

    const distill = Effect.fn("MemoryPlugin.distill")(function* (sessionID: Session.ID) {
      const entries = yield* config.entries()
      const documents = entries.filter((entry) => entry.type === "document")
      const memory = documents.flatMap((entry) => (entry.info.memory ? [entry.info.memory] : [])).at(-1)
      if (memory?.distill === false || memory?.enabled === false) return

      const messages = yield* ctx.session.context({ sessionID })
      const count = messages.length
      if (distilled.get(sessionID) === count) return

      const memoryPath = path.join(location.project.canonical, ".opencode", "memory", "MEMORY.md")
      const existing = yield* fs.readFileString(memoryPath).pipe(Effect.orElseSucceed(() => ""))

      const result = yield* ctx.session.generate({ sessionID, prompt: DISTILL_PROMPT(existing) })
      distilled.set(sessionID, count)

      const updated = result.text.trim()
      if (!updated || updated === "NO_UPDATE") return
      yield* fs.writeWithDirs(memoryPath, `${updated}\n`)
      yield* Effect.logDebug("memory distilled", { sessionID, memoryPath })
    })

    yield* ctx.session.hook("experimental.idle", (event) =>
      distill(event.sessionID).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("memory distillation failed", { sessionID: event.sessionID, cause }),
        ),
      ),
    )
  }),
})
