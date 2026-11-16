import { Ports } from "@opencode/schema/ports"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const PortsGroup = HttpApiGroup.make("server.ports")
  .add(
    HttpApiEndpoint.get("ports.status", "/api/experimental/ports", {
      query: LocationQuery,
      success: Ports.Info,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.ports.status",
          summary: "Service port status",
          description:
            "Read model for the service port settings page: the fixed OAuth callback ports with their configured overrides and whether each effective port is currently bindable on loopback.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "ports", description: "Service port status read model." }))
