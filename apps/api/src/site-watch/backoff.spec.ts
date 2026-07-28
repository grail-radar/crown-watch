/**
 * The escalation curve, checked without waiting real minutes for it.
 */
import { SourceHealth } from '@prisma/client';
import {
  BASE_BACKOFF_MS,
  FAILURES_BEFORE_ERROR,
  healthFor,
  isBackedOff,
  MAX_BACKOFF_MS,
  nextAttemptAt,
} from './backoff';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const waitMs = (failures: number, retryAfter?: number | null) =>
  nextAttemptAt(failures, NOW, retryAfter).getTime() - NOW.getTime();

describe('nextAttemptAt', () => {
  it('doubles the wait with each consecutive failure', () => {
    expect(waitMs(1)).toBe(BASE_BACKOFF_MS);
    expect(waitMs(2)).toBe(BASE_BACKOFF_MS * 2);
    expect(waitMs(3)).toBe(BASE_BACKOFF_MS * 4);
  });

  it('stops doubling at the cap, so a source is always retried eventually', () => {
    expect(waitMs(50)).toBe(MAX_BACKOFF_MS);
    // No overflow to Infinity for a source that has failed for months.
    expect(Number.isFinite(waitMs(10_000))).toBe(true);
  });

  it('waits longer when the store asks for longer', () => {
    const twoHours = 2 * 60 * 60;

    expect(waitMs(1, twoHours)).toBe(twoHours * 1000);
  });

  it('ignores a store asking for less than our own backoff', () => {
    // A shop answering "429, retry in 1s" to every request would otherwise
    // switch our backoff off exactly when it matters most.
    expect(waitMs(3, 1)).toBe(BASE_BACKOFF_MS * 4);
  });

  it('caps even an outrageous Retry-After', () => {
    expect(waitMs(1, 60 * 60 * 24 * 365)).toBe(MAX_BACKOFF_MS);
  });

  it('treats a missing or nonsensical Retry-After as absent', () => {
    for (const value of [null, undefined, NaN, -5]) {
      expect(waitMs(1, value)).toBe(BASE_BACKOFF_MS);
    }
  });
});

describe('healthFor', () => {
  it('is healthy with no failures', () => {
    expect(healthFor(0)).toBe(SourceHealth.healthy);
  });

  it('calls a first failure degraded, not broken', () => {
    // One bad fetch is usually the internet, not the brand deleting the store.
    expect(healthFor(1)).toBe(SourceHealth.degraded);
    expect(healthFor(FAILURES_BEFORE_ERROR - 1)).toBe(SourceHealth.degraded);
  });

  it('escalates to error once failures persist', () => {
    expect(healthFor(FAILURES_BEFORE_ERROR)).toBe(SourceHealth.error);
    expect(healthFor(FAILURES_BEFORE_ERROR + 10)).toBe(SourceHealth.error);
  });
});

describe('isBackedOff', () => {
  it('is true only while the window is still open', () => {
    expect(isBackedOff(new Date(NOW.getTime() + 1000), NOW)).toBe(true);
    expect(isBackedOff(new Date(NOW.getTime() - 1000), NOW)).toBe(false);
    expect(isBackedOff(null, NOW)).toBe(false);
    expect(isBackedOff(undefined, NOW)).toBe(false);
  });
});
