/**
 * Unit tests for withAbortTimeout utility (QUAL-R2).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { withAbortTimeout } from '../../src/abort-utils.js';

describe('withAbortTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return the original signal when no timeout is specified', () => {
    const controller = new AbortController();
    const result = withAbortTimeout(controller.signal);
    expect(result.signal).toBe(controller.signal);
    result.cleanup();
  });

  it('should return undefined signal when neither signal nor timeout provided', () => {
    const result = withAbortTimeout();
    expect(result.signal).toBeUndefined();
    result.cleanup();
  });

  it('should return undefined signal when timeout is 0', () => {
    const controller = new AbortController();
    const result = withAbortTimeout(controller.signal, 0);
    expect(result.signal).toBe(controller.signal);
    result.cleanup();
  });

  it('should return undefined signal when timeout is negative', () => {
    const result = withAbortTimeout(undefined, -100);
    expect(result.signal).toBeUndefined();
    result.cleanup();
  });

  it('should create a new signal when timeout is provided without parent signal', () => {
    vi.useFakeTimers();
    const result = withAbortTimeout(undefined, 1000);
    expect(result.signal).toBeDefined();
    expect(result.signal!.aborted).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(result.signal!.aborted).toBe(true);
    result.cleanup();
  });

  it('should abort on timeout when both signal and timeout are provided', () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const result = withAbortTimeout(parent.signal, 500);

    expect(result.signal).toBeDefined();
    expect(result.signal).not.toBe(parent.signal); // new combined signal
    expect(result.signal!.aborted).toBe(false);

    vi.advanceTimersByTime(500);
    expect(result.signal!.aborted).toBe(true);
    result.cleanup();
  });

  it('should abort on parent signal abort before timeout', () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const result = withAbortTimeout(parent.signal, 5000);

    expect(result.signal!.aborted).toBe(false);
    parent.abort();
    expect(result.signal!.aborted).toBe(true);
    result.cleanup();
  });

  it('should handle already-aborted signal', () => {
    const parent = new AbortController();
    parent.abort();
    const result = withAbortTimeout(parent.signal, 5000);
    expect(result.signal!.aborted).toBe(true);
    result.cleanup();
  });

  it('should clean up timeout on cleanup()', () => {
    vi.useFakeTimers();
    const result = withAbortTimeout(undefined, 1000);
    expect(result.signal!.aborted).toBe(false);

    result.cleanup();
    vi.advanceTimersByTime(1000);
    // After cleanup, the timeout should have been cleared, so the signal
    // should not have been aborted by the timer. However, since clearTimeout
    // was called, the abort never fires.
    expect(result.signal!.aborted).toBe(false);
  });

  it('should remove parent signal listener on cleanup()', () => {
    const parent = new AbortController();
    const result = withAbortTimeout(parent.signal, 5000);

    result.cleanup();
    // After cleanup, aborting parent should NOT abort the combined signal
    // because the listener was removed
    parent.abort();
    expect(result.signal!.aborted).toBe(false);
  });
});
