/**
 * Client-level retry wrapper for transient errors.
 *
 * Mirrors the Go reference client's `RetryPolicy`/`Retry` (see
 * `geode-client-go/retry.go`): retries only when {@link isRetryableError}
 * returns true, with exponential backoff capped at `maxBackoffMs`.
 */

import { isRetryableError } from './errors.js';

// Default retry policy values (parity with the Go reference client).
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;
const DEFAULT_MULTIPLIER = 2.0;

/**
 * Configures retry behavior for transient errors.
 */
export interface RetryPolicy {
  /**
   * Maximum number of attempts including the initial call.
   * Values less than 1 are treated as 1.
   */
  maxAttempts: number;

  /** Delay in milliseconds before the first retry. */
  initialBackoffMs: number;

  /**
   * Maximum backoff in milliseconds. The exponential backoff is clamped to
   * this value.
   */
  maxBackoffMs: number;

  /** Exponential backoff multiplier applied on each retry. */
  multiplier: number;
}

/**
 * Returns a {@link RetryPolicy} with sensible defaults:
 * 3 max attempts, 1000ms initial backoff, 30000ms max backoff, 2.0 multiplier.
 */
export function defaultRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    initialBackoffMs: DEFAULT_INITIAL_BACKOFF_MS,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    multiplier: DEFAULT_MULTIPLIER,
  };
}

/**
 * Calculates the backoff delay (in milliseconds) for the given 1-indexed
 * attempt. The result is clamped to `policy.maxBackoffMs`.
 */
function backoffMs(policy: RetryPolicy, attempt: number): number {
  const a = attempt < 1 ? 1 : attempt;
  // initialBackoffMs * multiplier^(attempt-1)
  const d = policy.initialBackoffMs * Math.pow(policy.multiplier, a - 1);
  return d > policy.maxBackoffMs ? policy.maxBackoffMs : d;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes `fn` up to `policy.maxAttempts` times, retrying only when
 * {@link isRetryableError} returns true for the rejection reason. Non-retryable
 * errors and non-Geode errors are propagated immediately without further
 * attempts. Between attempts the wrapper waits using exponential backoff
 * clamped to `policy.maxBackoffMs`.
 *
 * @param fn The operation to run. Re-invoked on each retry.
 * @param policy Optional retry policy. Defaults to {@link defaultRetryPolicy}.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy()
): Promise<T> {
  const maxAttempts = policy.maxAttempts < 1 ? 1 : policy.maxAttempts;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;

      // Only retry Geode errors that are explicitly retryable.
      if (!isRetryableError(e)) {
        throw e;
      }

      // No more attempts remaining.
      if (attempt === maxAttempts) {
        break;
      }

      const delay = backoffMs(policy, attempt);
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  throw lastErr;
}
