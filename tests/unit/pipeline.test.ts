import { describe, it, expect } from 'vitest';
import {
  batchExec,
  pipelineExec,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_WORKERS,
  type PipelineExecutor,
  type PipelineTx,
} from '../../src/pipeline.js';
import type { Statement } from '../../src/schema.js';
import { TransportError } from '../../src/errors.js';

interface CallLog {
  txCount: number;
  maxConcurrent: number;
  current: number;
  execed: string[];
}

/**
 * Build a mock pool that records transaction usage. `failOn` causes the
 * matching query to throw a (retryable) TransportError on every attempt.
 */
function mockPool(
  log: CallLog,
  opts?: { failOn?: string; failTimes?: number }
): PipelineExecutor & { failCounts: Map<string, number> } {
  const failCounts = new Map<string, number>();
  return {
    failCounts,
    async withTransaction<T>(fn: (tx: PipelineTx) => Promise<T>): Promise<T> {
      log.txCount++;
      log.current++;
      log.maxConcurrent = Math.max(log.maxConcurrent, log.current);
      const tx: PipelineTx = {
        async exec(query: string): Promise<void> {
          log.execed.push(query);
          if (opts?.failOn && query === opts.failOn) {
            const seen = (failCounts.get(query) ?? 0) + 1;
            failCounts.set(query, seen);
            if (!opts.failTimes || seen <= opts.failTimes) {
              throw new TransportError({ operation: 'exec' });
            }
          }
        },
      };
      try {
        // Yield so concurrency overlaps observably.
        await new Promise((r) => setTimeout(r, 5));
        return await fn(tx);
      } finally {
        log.current--;
      }
    },
  };
}

const stmt = (q: string): Statement => ({ query: q });

describe('defaults', () => {
  it('matches Go (chunk 100, workers 8)', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(100);
    expect(DEFAULT_MAX_WORKERS).toBe(8);
  });
});

describe('batchExec', () => {
  it('is a no-op for empty statements', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    await batchExec(mockPool(log), []);
    expect(log.txCount).toBe(0);
  });

  it('runs all statements in a single transaction', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    await batchExec(mockPool(log), [stmt('A'), stmt('B'), stmt('C')]);
    expect(log.txCount).toBe(1);
    expect(log.execed).toEqual(['A', 'B', 'C']);
  });

  it('retries the whole batch on a retryable error', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    const pool = mockPool(log, { failOn: 'B', failTimes: 1 });
    await batchExec(pool, [stmt('A'), stmt('B')]);
    expect(log.txCount).toBe(2); // first attempt fails at B, retry succeeds
  });
});

describe('pipelineExec', () => {
  it('is a no-op for empty statements', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    await pipelineExec(mockPool(log), []);
    expect(log.txCount).toBe(0);
  });

  it('splits into chunks of chunkSize (one tx per chunk)', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    const stmts = Array.from({ length: 10 }, (_, i) => stmt(`Q${i}`));
    await pipelineExec(mockPool(log), stmts, { chunkSize: 3, maxWorkers: 8 });
    // 10 statements / 3 per chunk = 4 chunks
    expect(log.txCount).toBe(4);
    expect(log.execed).toHaveLength(10);
  });

  it('bounds concurrency to maxWorkers', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    const stmts = Array.from({ length: 20 }, (_, i) => stmt(`Q${i}`));
    await pipelineExec(mockPool(log), stmts, { chunkSize: 1, maxWorkers: 2 });
    expect(log.maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('returns the first error and stops launching new chunks', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    const stmts = Array.from({ length: 20 }, (_, i) => stmt(`Q${i}`));
    // Q0 always fails (non-recoverable across retries).
    const pool = mockPool(log, { failOn: 'Q0' });
    await expect(pipelineExec(pool, stmts, { chunkSize: 1, maxWorkers: 1 })).rejects.toBeInstanceOf(
      TransportError
    );
    // With maxWorkers=1 and Q0 first, no further chunks should launch after the failure.
    expect(log.txCount).toBeLessThan(20);
  });
});
