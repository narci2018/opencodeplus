import { RulesFiles } from "@opencode/core/rules-files"
import { Config } from "@opencode/core/config"
import { Project } from "@opencode/core/project"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

export const RulesHandler = HttpApiBuilder.group(Api, "server.rules", (handlers) =>
  handlers.handle(
    "rules.files",
    Effect.fn("server.rules.files")(function* (ctx) {
      const config = yield* Config.Service
      const projects = yield* Project.Service
      return yield* RulesFiles.get(config, projects, ctx.query.location?.directory).pipe(Effect.orDie)
    }),
  ),
)
