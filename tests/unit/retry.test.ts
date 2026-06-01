import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, defaultRetryPolicy, type RetryPolicy } from '../../src/retry.js';
import { DriverError, TransportError, StatusClass } from '../../src/errors.js';

describe('retry', () => {
  describe('defaultRetryPolicy', () => {
    it('returns sensible defaults matching the Go reference', () => {
      const policy = defaultRetryPolicy();
      expect(policy.maxAttempts).toBe(3);
      expect(policy.initialBackoffMs).toBe(1000);
      expect(policy.maxBackoffMs).toBe(30000);
      expect(policy.multiplier).toBe(2.0);
    });
  });

  describe('withRetry', () => {
    it('resolves on the first attempt without retrying', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const result = await withRetry(fn);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries a retryable TransportError then resolves', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new TransportError({ operation: 'sendProto' }))
        .mockResolvedValue('recovered');
      // Use a zero backoff to keep the test fast.
      const policy: RetryPolicy = {
        maxAttempts: 3,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        multiplier: 2.0,
      };
      const result = await withRetry(fn, policy);
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries a retryable serialization DriverError then resolves', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(
          new DriverError({
            statusClass: StatusClass.SERIALIZATION,
            subclass: '',
            code: '40001',
            message: 'serialization failure',
          })
        )
        .mockResolvedValue('committed');
      const policy: RetryPolicy = {
        maxAttempts: 3,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        multiplier: 2.0,
      };
      const result = await withRetry(fn, policy);
      expect(result).toBe('committed');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('rejects with the last error after exhausting maxAttempts', async () => {
      const err = new TransportError({ operation: 'sendProto' });
      const fn = vi.fn().mockRejectedValue(err);
      const policy: RetryPolicy = {
        maxAttempts: 3,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        multiplier: 2.0,
      };
      await expect(withRetry(fn, policy)).rejects.toBe(err);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry a non-retryable DriverError (syntax 42000)', async () => {
      const err = new DriverError({
        statusClass: StatusClass.SYNTAX,
        subclass: '',
        code: '42000',
        message: 'syntax error',
      });
      const fn = vi.fn().mockRejectedValue(err);
      await expect(withRetry(fn)).rejects.toBe(err);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry a non-Geode error', async () => {
      const err = new Error('plain error');
      const fn = vi.fn().mockRejectedValue(err);
      await expect(withRetry(fn)).rejects.toBe(err);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('treats maxAttempts < 1 as a single attempt', async () => {
      const err = new TransportError({ operation: 'sendProto' });
      const fn = vi.fn().mockRejectedValue(err);
      const policy: RetryPolicy = {
        maxAttempts: 0,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        multiplier: 2.0,
      };
      await expect(withRetry(fn, policy)).rejects.toBe(err);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    describe('backoff timing (fake timers)', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('applies exponential backoff clamped to maxBackoffMs', async () => {
        const fn = vi.fn().mockRejectedValue(new TransportError({ operation: 'sendProto' }));
        const policy: RetryPolicy = {
          maxAttempts: 4,
          initialBackoffMs: 1000,
          maxBackoffMs: 2500,
          multiplier: 2.0,
        };
        const promise = withRetry(fn, policy);
        // Attach a rejection handler immediately so the eventual rejection is not unhandled.
        const settled = promise.catch((e) => e);

        // Attempt 1 fails immediately.
        await vi.advanceTimersByTimeAsync(0);
        expect(fn).toHaveBeenCalledTimes(1);

        // Backoff before attempt 2 = 1000 * 2^0 = 1000ms.
        await vi.advanceTimersByTimeAsync(999);
        expect(fn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fn).toHaveBeenCalledTimes(2);

        // Backoff before attempt 3 = 1000 * 2^1 = 2000ms.
        await vi.advanceTimersByTimeAsync(2000);
        expect(fn).toHaveBeenCalledTimes(3);

        // Backoff before attempt 4 = 1000 * 2^2 = 4000ms, clamped to 2500ms.
        await vi.advanceTimersByTimeAsync(2499);
        expect(fn).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1);
        expect(fn).toHaveBeenCalledTimes(4);

        const result = await settled;
        expect(result).toBeInstanceOf(TransportError);
      });
    });
  });
});
