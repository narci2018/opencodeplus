import { RulesFiles } from "@opencode/core/rules-files"
import { Config } from "@opencode/core/config"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

export const RulesHandler = HttpApiBuilder.group(Api, "server.rules", (handlers) =>
  handlers.handle(
    "rules.files",
    Effect.fn("server.rules.files")(function* (ctx) {
      const config = yield* Config.Service
      return yield* RulesFiles.get(config, ctx.query.location?.directory).pipe(Effect.orDie)
    }),
  ),
)
