export * as SessionRunnerRetry from "./retry.js"

import { AIError, isRetryable } from "@opencode/ai/effect"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { SessionError } from "@opencode/schema/session-error"
import { Clock, Duration, Effect } from "effect"
import { Bus } from "../../bus.js"
import { ModelRetry } from "../../model-retry.js"
import type { PluginHooks } from "../../plugin/hooks.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"

export { isRetryable }

// A session step retries every failure that can resolve itself: provider outages and rate limits,
// exhausted quotas (a top-up or a daily reset ends the outage), authentication (credentials or
// billing can be fixed while the session waits), timeouts, and transport drops. Deterministic
// failures repeat the same outcome on every attempt, so they end the session instead. The
// `x-should-retry` header overrides either way.
export const isWorthRetrying = (error: AIError): boolean => {
  const override = error.reason.http?.headers["x-should-retry"]
  if (override === "true") return true
  if (override === "false") return false
  switch (error.reason._tag) {
    case "RateLimit":
    case "QuotaExceeded":
    case "ProviderInternal":
    case "Authentication":
    case "Timeout":
    case "UnknownProvider":
      return true
    case "Transport":
      return (
        error.reason.delivery !== "rejected" && (error.reason.delivery !== "accepted" || error.reason.operation === "read")
      )
    case "InvalidProviderOutput":
      return error.reason.classification === "incomplete-stream"
    case "InvalidRequest":
    case "ContentPolicy":
    case "UnsupportedOperation":
      return false
    default: {
      const exhaustive: never = error.reason
      return exhaustive
    }
  }
}

interface Input {
  readonly cause: AIError
  readonly error: SessionError.Error
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly hook: (event: PluginHooks.Domains["session"]["retry"]) => Effect.Effect<void>
  readonly retry: boolean
}

export interface Decision {
  readonly retry: true
  readonly attempt: number
  readonly delay: number
}

export const policy = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const decide = yield* ModelRetry.sessionPolicy
    return (input: Input) =>
      Effect.gen(function* () {
        const next = yield* decide(input)
        if (!next) return { retry: false as const }
        const event: PluginHooks.Domains["session"]["retry"] = {
          sessionID,
          agent: input.agent,
          model: input.model,
          error: input.error,
          attempt: next.attempt,
          decision: next.retry ? { retry: true, delay: next.delay } : { retry: false },
        }
        yield* input.hook(event)
        if (!event.decision.retry) return event.decision
        const normalized =
          Number.isFinite(event.decision.delay) && event.decision.delay >= 0
            ? Math.ceil(event.decision.delay)
            : next.delay
        return { retry: true as const, attempt: next.attempt, delay: normalized }
      })
  })

export const make = (bus: Bus.Interface, sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const decide = yield* policy(sessionID)
    const wait = (input: {
      readonly decision: Decision
      readonly assistantMessageID: SessionMessage.ID
      readonly error: SessionError.Error
    }) =>
      Effect.gen(function* () {
        const scheduled = yield* Clock.currentTimeMillis
        yield* bus.publish(SessionEvent.RetryScheduled, {
          sessionID,
          assistantMessageID: input.assistantMessageID,
          attempt: input.decision.attempt,
          at: scheduled + input.decision.delay,
          error: input.error,
        })
        const remaining = Math.max(0, scheduled + input.decision.delay - (yield* Clock.currentTimeMillis))
        yield* Effect.sleep(Duration.millis(remaining))
      })
    return { decide, wait }
  })
