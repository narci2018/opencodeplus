import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ServiceUnavailableError, InvalidRequestError } from "../errors.js"

export const EgressInfo = Schema.Struct({
  proxy: Schema.Struct({
    https: Schema.NullOr(Schema.String),
    http: Schema.NullOr(Schema.String),
    noProxy: Schema.NullOr(Schema.String),
  }),
  ip: Schema.NullOr(Schema.String),
})

export const ProxyRequest = Schema.Struct({
  url: Schema.String,
  method: Schema.Union([Schema.Literal("GET"), Schema.Literal("POST")]),
  headers: Schema.Record(Schema.String, Schema.String),
  timeout: Schema.optional(Schema.Number),
})

export const ProxyResponse = Schema.Struct({
  status: Schema.Number,
  statusText: Schema.String,
  body: Schema.String,
})

export const FingerprintData = Schema.Struct({
  userAgent: Schema.String,
  clientName: Schema.String,
  version: Schema.String,
  channel: Schema.String,
  ip: Schema.String,
  screenResolution: Schema.String,
  timezone: Schema.String,
  language: Schema.String,
  platform: Schema.String,
  hardwareConcurrency: Schema.Number,
  deviceMemory: Schema.Number,
  colorDepth: Schema.Number,
  pixelRatio: Schema.Number,
  id: Schema.String,
})

export const FingerprintRequest = Schema.Struct({
  fingerprint: Schema.NullOr(FingerprintData),
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
  .add(
    HttpApiEndpoint.post("network.proxy", "/api/experimental/network/proxy", {
      payload: ProxyRequest,
      success: ProxyResponse,
      error: [InvalidRequestError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.network.proxy",
        summary: "Proxy an HTTP request",
        description:
          "Experimental: may change without compatibility guarantees. Make an HTTP request from the service process on behalf of the renderer, avoiding browser CORS restrictions. Used by the custom-model test-connection flow.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("network.fingerprint", "/api/experimental/network/fingerprint", {
      payload: FingerprintRequest,
      success: Schema.Struct({ ok: Schema.Boolean }),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.network.fingerprint",
        summary: "Update client fingerprint",
        description:
          "Experimental: Set or clear the client fingerprint that overrides default request headers. Pass null to restore original values.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "network",
      description: "Experimental network egress routes.",
    }),
  )
