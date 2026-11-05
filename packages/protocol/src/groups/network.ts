import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ServiceUnavailableError } from "../errors.js"

export const EgressInfo = Schema.Struct({
  proxy: Schema.Struct({
    https: Schema.NullOr(Schema.String),
    http: Schema.NullOr(Schema.String),
    noProxy: Schema.NullOr(Schema.String),
  }),
  ip: Schema.NullOr(Schema.String),
})

export const NetworkGroup = HttpApiGroup.make("server.network")
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
      title: "network",
      description: "Experimental network egress routes.",
    }),
  )
