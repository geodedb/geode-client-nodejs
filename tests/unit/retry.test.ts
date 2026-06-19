import { describe, it, expect } from 'vitest';
import { defaultRetryPolicy, backoffDelay, retry } from '../../src/retry.js';
import { TransportError, ConfigError } from '../../src/errors.js';

describe('defaultRetryPolicy', () => {
  it('matches Go defaults (3 attempts, 1s->30s, 2x)', () => {
    const p = defaultRetryPolicy();
    expect(p.maxAttempts).toBe(3);
    expect(p.initialBackoffMs).toBe(1000);
    expect(p.maxBackoffMs).toBe(30000);
    expect(p.multiplier).toBe(2.0);
  });
});

describe('backoffDelay', () => {
  it('computes initial * multiplier^(attempt-1), clamped to max', () => {
    const p = defaultRetryPolicy();
    expect(backoffDelay(p, 1)).toBe(1000);
    expect(backoffDelay(p, 2)).toBe(2000);
    expect(backoffDelay(p, 3)).toBe(4000);
    expect(backoffDelay(p, 10)).toBe(30000); // clamped
  });

  it('treats attempts < 1 as 1', () => {
    const p = defaultRetryPolicy();
    expect(backoffDelay(p, 0)).toBe(1000);
  });
});

describe('retry', () => {
  const fast = { maxAttempts: 3, initialBackoffMs: 1, maxBackoffMs: 5, multiplier: 2.0 };

  it('returns immediately on success', async () => {
    let calls = 0;
    const out = await retry(async () => {
      calls++;
      return 'ok';
    }, fast);
    expect(out).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries retryable errors up to maxAttempts', async () => {
    let calls = 0;
    await expect(
      retry(async () => {
        calls++;
        throw new TransportError({ operation: 'read' });
      }, fast)
    ).rejects.toBeInstanceOf(TransportError);
    expect(calls).toBe(3);
  });

  it('succeeds after a transient failure', async () => {
    let calls = 0;
    const out = await retry(async () => {
      calls++;
      if (calls < 3) throw new TransportError({ operation: 'read' });
      return 'recovered';
    }, fast);
    expect(out).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      retry(async () => {
        calls++;
        throw new ConfigError({ field: 'host', message: 'bad' });
      }, fast)
    ).rejects.toBeInstanceOf(ConfigError);
    expect(calls).toBe(1);
  });

  it('does not retry non-Geode errors', async () => {
    let calls = 0;
    await expect(
      retry(async () => {
        calls++;
        throw new Error('plain');
      }, fast)
    ).rejects.toThrow('plain');
    expect(calls).toBe(1);
  });

  it('aborts before sleeping when signal is aborted', async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const promise = retry(
      async () => {
        calls++;
        ctrl.abort();
        throw new TransportError({ operation: 'read' });
      },
      fast,
      ctrl.signal
    );
    await expect(promise).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
