/**
 * Retry Policy
 *
 * Ports geode-client-go retry.go: bounded exponential backoff that retries
 * only when isRetryableError returns true.
 */

import { isRetryableError } from './errors.js';

/** Retry behaviour configuration for transient errors. */
export interface RetryPolicy {
  /** Maximum number of attempts including the initial call. Values < 1 treated as 1. */
  maxAttempts: number;
  /** Delay before the first retry, in milliseconds. */
  initialBackoffMs: number;
  /** Maximum backoff in milliseconds; exponential backoff is clamped to this. */
  maxBackoffMs: number;
  /** Exponential backoff multiplier applied on each retry. */
  multiplier: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;
const DEFAULT_MULTIPLIER = 2.0;

/** Sensible defaults: 3 attempts, 1s initial, 30s max, 2.0 multiplier. */
export function defaultRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    initialBackoffMs: DEFAULT_INITIAL_BACKOFF_MS,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    multiplier: DEFAULT_MULTIPLIER,
  };
}

/** Backoff for the given 1-indexed attempt, clamped to maxBackoffMs. */
export function backoffDelay(policy: RetryPolicy, attempt: number): number {
  const a = attempt < 1 ? 1 : attempt;
  const d = policy.initialBackoffMs * Math.pow(policy.multiplier, a - 1);
  return d > policy.maxBackoffMs ? policy.maxBackoffMs : d;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    let onAbort: (() => void) | null = null;
    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Execute `fn` up to policy.maxAttempts times, retrying only when the thrown
 * error is retryable. Non-retryable and non-Geode errors propagate immediately.
 * The abort signal is checked before each backoff sleep.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy(),
  signal?: AbortSignal
): Promise<T> {
  const maxAttempts = policy.maxAttempts < 1 ? 1 : policy.maxAttempts;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err)) {
        throw err;
      }
      if (attempt === maxAttempts) {
        break;
      }
      if (signal?.aborted) {
        throw err;
      }
      await sleep(backoffDelay(policy, attempt), signal);
    }
  }
  throw lastErr;
}
