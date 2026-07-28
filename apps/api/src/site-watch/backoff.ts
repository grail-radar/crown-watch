import { SourceHealth } from '@prisma/client';

/**
 * How long a source is left alone after a failure, and what its health becomes.
 *
 * Pure functions over (failure count, clock), so the escalation curve is
 * readable and testable without waiting real minutes for it.
 */

/** First failure waits this long; each further one doubles it. */
export const BASE_BACKOFF_MS = 15 * 60 * 1000;

/** However badly a store misbehaves, we retry at least once a day. */
export const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

/**
 * Failures tolerated before a source is called broken rather than flaky. Below
 * it the source is `degraded`: worth an operator's glance, not their evening.
 */
export const FAILURES_BEFORE_ERROR = 3;

/** A store asking for a longer pause than this is capped, not obeyed blindly. */
const MAX_HONOURED_RETRY_AFTER_MS = MAX_BACKOFF_MS;

/**
 * When this source may be polled again.
 *
 * `retryAfterSeconds` comes from a 429's `Retry-After`. It is an explicit
 * request from the store, so it wins whenever it asks for *longer* than our own
 * curve — but never for shorter, since a store repeating "try in 1s" would
 * otherwise turn our backoff off entirely.
 */
export function nextAttemptAt(
  consecutiveFailures: number,
  now: Date,
  retryAfterSeconds?: number | null,
): Date {
  const steps = Math.max(1, consecutiveFailures);
  // 2^30 ms is already far past the cap; clamping the exponent keeps the shift
  // away from Infinity for a source that has been failing for months.
  const exponent = Math.min(steps - 1, 30);
  const curve = Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);

  const requested =
    typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)
      ? Math.min(Math.max(retryAfterSeconds, 0) * 1000, MAX_HONOURED_RETRY_AFTER_MS)
      : 0;

  return new Date(now.getTime() + Math.max(curve, requested));
}

/**
 * Health after `consecutiveFailures` failures in a row.
 *
 * One bad fetch is usually the internet, not the brand deleting their store —
 * so a single failure is `degraded`, and `error` is reserved for a source that
 * has failed enough times to need a human.
 */
export function healthFor(consecutiveFailures: number): SourceHealth {
  if (consecutiveFailures <= 0) return SourceHealth.healthy;
  return consecutiveFailures >= FAILURES_BEFORE_ERROR
    ? SourceHealth.error
    : SourceHealth.degraded;
}

/** True when the source is still inside a backoff window. */
export function isBackedOff(
  nextAttempt: Date | null | undefined,
  now: Date,
): boolean {
  return nextAttempt !== null && nextAttempt !== undefined && nextAttempt > now;
}
