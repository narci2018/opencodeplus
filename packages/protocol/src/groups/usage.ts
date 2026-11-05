import { Location } from "@opencode/schema/location"
import { UsageLimits } from "@opencode/schema/usage-limits"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const EgressInfo = Schema.Struct({
  proxy: Schema.Struct({
    https: Schema.NullOr(Schema.String),
    http: Schema.NullOr(Schema.String),
    noProxy: Schema.NullOr(Schema.String),
  }),
  ip: Schema.NullOr(Schema.String),
})

export const UsageGroup = HttpApiGroup.make("server.usage")
  .add(
    HttpApiEndpoint.get("usage.limits", "/api/experimental/usage/limits", {
      query: LocationQuery,
      success: Location.response(Schema.NullOr(UsageLimits.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.usage.limits",
          summary: "Get usage limits",
          description:
            "Return the OpenCode Go allowance and Console budgets of the OpenCode Console workspace the location is signed in to, or null when it isn't signed in.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("network.egress", "/api/experimental/network/egress", {
      success: EgressInfo,
      error: ServiceUnavailableError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.network.egress",
        summary: "Check network egress",
        description:
          "Report the proxy variables this service process runs with and the public IP it reaches through them. Model requests leave from this process, so this is the path a real model request takes: the proxy variables decide whether it goes through the configured proxy or direct.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "usage",
      description: "Experimental usage limit and network egress routes.",
    }),
  )
