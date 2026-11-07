import { RulesFiles } from "@opencode/schema/rules-files"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const RulesGroup = HttpApiGroup.make("server.rules")
  .add(
    HttpApiEndpoint.get("rules.files", "/api/experimental/rules/files", {
      query: LocationQuery,
      success: RulesFiles.Info,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.rules.files",
          summary: "Rules and memory files",
          description:
            "Read model for the rules and memory settings page: import toggles, configured instruction sources, and the rule and memory file paths with their contents for the requested location.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "rules", description: "Rules and memory read model." }))
