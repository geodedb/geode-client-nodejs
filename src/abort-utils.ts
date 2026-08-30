/**
 * Abort-signal utility for combining an optional AbortSignal with an
 * optional timeout into a single signal + cleanup function.
 *
 * Extracted from Connection._withRequestTimeout (QUAL-R2).
 */

/**
 * Abort reason used when the deadline built by {@link withAbortTimeout} fires.
 *
 * A deadline abort and a caller abort mean different things to the connection:
 * the caller knows it walked away, but a deadline means the server still owes a
 * response on a stream that carries no correlation ids (ENG-3918). The two are
 * told apart by this reason (and by {@link AbortHandle.timedOut}).
 */
export const TIMEOUT_ABORT_REASON = 'geode:request-timeout';

/**
 * Result of combining abort signal and timeout.
 * Call `cleanup()` when the operation completes (success or failure)
 * to clear the timeout and remove the abort listener.
 */
export interface AbortHandle {
  /** Combined signal that aborts on timeout OR when the parent signal aborts. */
  signal?: AbortSignal;
  /** Must be called when the operation finishes to prevent timer/listener leaks. */
  cleanup: () => void;
  /** True when the combined signal aborted because the deadline elapsed. */
  timedOut: () => boolean;
}

/**
 * Combine an optional caller-provided AbortSignal with an optional timeout
 * (in milliseconds) into a single AbortSignal and a cleanup function.
 *
 * Handles edge cases:
 *  - No timeout and no signal: returns `{ signal: undefined, cleanup: noop }`
 *  - No timeout but signal provided: returns `{ signal, cleanup: noop }`
 *  - Timeout but no signal: returns a new signal that aborts after `timeoutMs`
 *  - Both: returns a new signal that aborts on whichever fires first
 *  - Already-aborted signal: the returned signal is immediately aborted (CWE-703)
 *
 * @param signal  Optional upstream AbortSignal to honor
 * @param timeoutMs  Timeout in milliseconds (0 or negative means no timeout)
 */
export function withAbortTimeout(signal?: AbortSignal, timeoutMs?: number): AbortHandle {
  const effectiveTimeout = timeoutMs ?? 0;

  // No timeout requested — pass through the caller's signal as-is
  if (!effectiveTimeout || effectiveTimeout <= 0) {
    return { signal, cleanup: () => {}, timedOut: () => false };
  }

  const controller = new AbortController();
  let deadlineFired = false;
  const timeoutId = setTimeout(() => {
    deadlineFired = true;
    controller.abort(TIMEOUT_ABORT_REASON);
  }, effectiveTimeout);
  const timedOut = (): boolean => deadlineFired;

  // Honor already-aborted signals immediately
  if (signal?.aborted) {
    controller.abort(signal.reason);
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timeoutId);
      },
      timedOut,
    };
  }

  // Wire parent signal to abort the controller
  let onAbort: (() => void) | null = null;
  if (signal) {
    onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    },
    timedOut,
  };
}
