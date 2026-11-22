import { describe, expect } from "bun:test"
import {
  AIError,
  AuthenticationError,
  ContentPolicyError,
  InvalidRequestError,
  ProviderInternalError,
  QuotaExceededError,
  RateLimitError,
  TransportError,
  UnsupportedOperationError,
} from "@opencode/ai/effect"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Effect } from "effect"
import { it } from "./lib/effect"

const timeout = new AIError({
  reason: new TransportError({ message: "Timed out", transport: "http", operation: "request", code: "Timeout" }),
})
const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })
const quota = new AIError({ reason: new QuotaExceededError({ message: "Insufficient balance" }) })
const quotaWithAfter = (retryAfterMs: number) =>
  new AIError({ reason: new QuotaExceededError({ message: "Daily limit exceeded", retryAfterMs }) })
const rateLimited = (retryAfterMs?: number) =>
  new AIError({ reason: new RateLimitError({ message: "Rate limited", retryAfterMs }) })
const unauthenticated = new AIError({ reason: new AuthenticationError({ message: "Invalid key" }) })
const invalidRequest = new AIError({ reason: new InvalidRequestError({ message: "Bad request" }) })
const contentPolicy = new AIError({ reason: new ContentPolicyError({ message: "Refused" }) })
const unsupported = new AIError({
  reason: new UnsupportedOperationError({ message: "Not implemented", operation: "compact" }),
})

const input = (cause: AIError) => ({
  cause,
  error: toSessionError(cause),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }),
  hook: () => Effect.void,
  retry: SessionRunnerRetry.isWorthRetrying(cause),
})

// Decisions for `count` consecutive failures of the same cause within one step.
const decisions = (cause: AIError, count: number) =>
  Effect.gen(function* () {
    const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
    const results: boolean[] = []
    for (let i = 0; i < count; i++) results.push((yield* policy(input(cause))).retry)
    return results
  })

const delayOf = (decision: { retry: false } | SessionRunnerRetry.Decision) => {
  expect(decision.retry).toBe(true)
  if (!decision.retry) throw new Error("expected a retry decision")
  return decision.delay
}

describe("SessionRunnerRetry.isWorthRetrying", () => {
  it.effect("retries environmental failures, including quota and authentication", () =>
    Effect.gen(function* () {
      for (const cause of [rateLimited(), quota, unauthenticated, timeout, internal]) {
        expect(SessionRunnerRetry.isWorthRetrying(cause)).toBe(true)
      }
    }),
  )

  it.effect("never retries deterministic failures", () =>
    Effect.gen(function* () {
      for (const cause of [invalidRequest, contentPolicy, unsupported]) {
        expect(SessionRunnerRetry.isWorthRetrying(cause)).toBe(false)
      }
    }),
  )

  it.effect("honors the x-should-retry header either way", () =>
    Effect.gen(function* () {
      const force = new AIError({
        reason: new InvalidRequestError({ message: "Bad request", http: { url: "https://x", status: 400, headers: { "x-should-retry": "true" } } }),
      })
      const forbid = new AIError({
        reason: new RateLimitError({ message: "Rate limited", http: { url: "https://x", status: 429, headers: { "x-should-retry": "false" } } }),
      })
      expect(SessionRunnerRetry.isWorthRetrying(force)).toBe(true)
      expect(SessionRunnerRetry.isWorthRetrying(forbid)).toBe(false)
    }),
  )
})

describe("SessionRunnerRetry.policy", () => {
  it.effect("keeps retrying environmental failures indefinitely", () =>
    Effect.gen(function* () {
      for (const cause of [timeout, internal, quota, unauthenticated]) {
        expect(yield* decisions(cause, 12)).toEqual(Array(12).fill(true))
      }
    }),
  )

  it.effect("stops a deterministic failure immediately", () =>
    Effect.gen(function* () {
      expect(yield* decisions(invalidRequest, 1)).toEqual([false])
    }),
  )

  it.effect("caps the exponential gap at five minutes", () =>
    Effect.gen(function* () {
      const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
      for (let i = 0; i < 12; i++) {
        const decision = yield* policy(input(internal))

        expect(decision.retry).toBe(true)
        expect(delayOf(decision)).toBeGreaterThan(0)
        // Jitter spreads the capped gap up to twenty percent past five minutes.
        expect(delayOf(decision)).toBeLessThanOrEqual(6 * 60 * 1000)
      }
    }),
  )

  it.effect("waits out a provider retry-after past the old fifteen-minute cap", () =>
    Effect.gen(function* () {
      const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
      const decision = yield* policy(input(rateLimited(20 * 60 * 1000)))

      expect(delayOf(decision)).toBe(20 * 60 * 1000)
    }),
  )

  it.effect("honors a quota retry-after and caps it at a day", () =>
    Effect.gen(function* () {
      const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))

      expect(delayOf(yield* policy(input(quotaWithAfter(20 * 60 * 1000))))).toBe(20 * 60 * 1000)
      expect(delayOf(yield* policy(input(quotaWithAfter(30 * 60 * 60 * 1000))))).toBe(24 * 60 * 60 * 1000)
    }),
  )
})
