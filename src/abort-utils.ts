/**
 * Abort-signal utility for combining an optional AbortSignal with an
 * optional timeout into a single signal + cleanup function.
 *
 * Extracted from Connection._withRequestTimeout (QUAL-R2).
 */

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
export function withAbortTimeout(
  signal?: AbortSignal,
  timeoutMs?: number
): AbortHandle {
  const effectiveTimeout = timeoutMs ?? 0;

  // No timeout requested — pass through the caller's signal as-is
  if (!effectiveTimeout || effectiveTimeout <= 0) {
    return { signal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

  // Honor already-aborted signals immediately
  if (signal?.aborted) {
    controller.abort();
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timeoutId);
      },
    };
  }

  // Wire parent signal to abort the controller
  let onAbort: (() => void) | null = null;
  if (signal) {
    onAbort = () => controller.abort();
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
  };
}
