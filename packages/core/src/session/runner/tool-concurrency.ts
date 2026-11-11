export * as ToolConcurrency from "./tool-concurrency.js"

import { Effect, Semaphore } from "effect"

/**
 * ZCode-style bounded concurrency for tool execution.
 *
 * The default opencode path forks every tool call in a step concurrently without
 * an upper bound, which is fast but can saturate MCP servers and the network when
 * a model requests many tools at once. ZCode bounds this with a configurable
 * `maxConcurrency` (default 10), keeping parallel throughput while capping the
 * number of tools actually in flight.
 *
 * This is the portable core of ZCode's speed design: it does not replace the
 * default behavior, it is an opt-in execution policy selected per session.
 */
export interface Policy {
  readonly maxConcurrency: number
}

export const DEFAULT_MAX_CONCURRENCY = 10

/** Wraps an execution effect so at most `maxConcurrency` run concurrently. */
export const withLimit = <E, R>(effect: Effect.Effect<void, E, R>, semaphore: Semaphore.Semaphore) =>
  semaphore.withPermits(1)(effect)

/** Creates a semaphore honoring the policy, or a no-op when unbounded. */
export const semaphore = (policy: Policy | undefined): Semaphore.Semaphore =>
  policy === undefined ? Semaphore.makeUnsafe(Number.MAX_SAFE_INTEGER) : Semaphore.makeUnsafe(policy.maxConcurrency)

export const parsePolicy = (maxConcurrency: number | undefined): Policy | undefined =>
  maxConcurrency !== undefined && maxConcurrency > 0 ? { maxConcurrency } : undefined
