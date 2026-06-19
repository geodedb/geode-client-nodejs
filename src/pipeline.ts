/**
 * Pipeline / Batch Execution (GAP-0900)
 *
 * Ports geode-client-go batch.go PipelineExec/BatchExec:
 *  - batchExec runs all statements inside one transaction, with retry.
 *  - pipelineExec splits into chunks and runs up to maxWorkers concurrently;
 *    the first error stops launching new chunks while in-flight chunks finish.
 */

import type { Statement } from './schema.js';
import { retry, defaultRetryPolicy } from './retry.js';

/** Default number of statements per chunk in pipelineExec. */
export const DEFAULT_CHUNK_SIZE = 100;

/** Default maximum number of concurrent chunk workers in pipelineExec. */
export const DEFAULT_MAX_WORKERS = 8;

/** Minimal transaction surface pipelineExec needs. */
export interface PipelineTx {
  exec(query: string, options?: { params?: Record<string, unknown> }): Promise<void>;
}

/** Minimal pool surface pipelineExec needs (ConnectionPool satisfies this). */
export interface PipelineExecutor {
  withTransaction<T>(fn: (tx: PipelineTx) => Promise<T>): Promise<T>;
}

/**
 * Execute `stmts` inside a single transaction with automatic retry on
 * retryable errors. An empty list is a no-op.
 */
export async function batchExec(pool: PipelineExecutor, stmts: Statement[]): Promise<void> {
  if (stmts.length === 0) {
    return;
  }
  await retry(
    () =>
      pool.withTransaction(async (tx) => {
        for (const s of stmts) {
          await tx.exec(s.query, s.params ? { params: s.params } : undefined);
        }
      }),
    defaultRetryPolicy()
  );
}

/**
 * Execute `stmts` in parallel chunks. Splits into chunks of `chunkSize` and
 * runs up to `maxWorkers` chunks concurrently; each chunk runs through
 * batchExec. Returns the first error encountered; once an error occurs no new
 * chunks are launched but in-flight chunks complete.
 */
export async function pipelineExec(
  pool: PipelineExecutor,
  stmts: Statement[],
  opts?: { chunkSize?: number; maxWorkers?: number; signal?: AbortSignal }
): Promise<void> {
  if (stmts.length === 0) {
    return;
  }
  const chunkSize = opts?.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : DEFAULT_CHUNK_SIZE;
  const maxWorkers =
    opts?.maxWorkers && opts.maxWorkers > 0 ? opts.maxWorkers : DEFAULT_MAX_WORKERS;
  const signal = opts?.signal;

  const chunks: Statement[][] = [];
  for (let i = 0; i < stmts.length; i += chunkSize) {
    chunks.push(stmts.slice(i, i + chunkSize));
  }

  let firstErr: Error | undefined;
  let nextChunk = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (firstErr !== undefined || signal?.aborted) {
        return;
      }
      const idx = nextChunk++;
      if (idx >= chunks.length) {
        return;
      }
      try {
        await batchExec(pool, chunks[idx]!);
      } catch (err) {
        firstErr ??= err instanceof Error ? err : new Error(String(err));
        return;
      }
    }
  }

  const workerCount = Math.min(maxWorkers, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstErr !== undefined) {
    throw firstErr;
  }
  if (signal?.aborted) {
    throw new Error('geode: pipeline aborted');
  }
}
