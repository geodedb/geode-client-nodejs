/**
 * Batch Query Operations
 *
 * Support for executing multiple queries efficiently.
 */

import type { Connection, QueryParams } from './connection.js';
import { rowToObject } from './types.js';

/**
 * A single query in a batch.
 */
export interface BatchQuery {
  /** Query text */
  query: string;
  /** Optional parameters */
  params?: QueryParams;
}

/**
 * Result of a batch query.
 */
export interface BatchResult {
  /** Index in the batch (0-based) */
  index: number;
  /** Query that was executed */
  query: string;
  /** Whether the query succeeded */
  success: boolean;
  /** Rows returned (if query was successful) */
  rows?: Record<string, unknown>[];
  /** Error (if query failed) */
  error?: Error;
  /** Execution time in milliseconds */
  durationMs?: number;
}

/**
 * Summary of batch execution.
 */
export interface BatchSummary {
  /** Total number of queries */
  total: number;
  /** Number of successful queries */
  successful: number;
  /** Number of failed queries */
  failed: number;
  /** Total execution time in milliseconds */
  totalDurationMs: number;
  /** Individual results */
  results: BatchResult[];
}

/**
 * Options for batch execution.
 */
export interface BatchOptions {
  /** Stop on first error (default: false) */
  stopOnError?: boolean;
  /** Maximum concurrent queries (default: 1 - sequential) */
  concurrency?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Page size for result fetching */
  pageSize?: number;
  /** Execute within a transaction (default: false) */
  transaction?: boolean;
}

/**
 * Execute multiple queries in a batch.
 *
 * By default, queries are executed sequentially and all results are collected.
 * Set stopOnError to true to abort on the first failure.
 *
 * @param conn - Connection to use
 * @param queries - Array of queries to execute
 * @param options - Batch execution options
 * @returns Batch execution summary
 *
 * @example
 * ```typescript
 * const summary = await batch(conn, [
 *   { query: 'CREATE (a:Person {name: "Alice"})' },
 *   { query: 'CREATE (b:Person {name: "Bob"})' },
 *   { query: 'MATCH (n:Person) RETURN count(n) AS cnt' },
 * ]);
 *
 * console.log(`${summary.successful}/${summary.total} queries succeeded`);
 * ```
 */
export async function batch(
  conn: Connection,
  queries: BatchQuery[],
  options?: BatchOptions
): Promise<BatchSummary> {
  const results: BatchResult[] = [];
  const startTime = Date.now();
  let successful = 0;
  let failed = 0;

  const stopOnError = options?.stopOnError ?? false;
  const inTransaction = options?.transaction ?? false;

  // Start transaction if requested
  let tx: { commit: () => Promise<void>; rollback: () => Promise<void> } | null = null;
  if (inTransaction) {
    tx = await conn.begin(options?.signal);
  }

  try {
    for (let i = 0; i < queries.length; i++) {
      // Check for cancellation
      if (options?.signal?.aborted) {
        // Mark remaining as failed
        for (let j = i; j < queries.length; j++) {
          const q = queries[j];
          results.push({
            index: j,
            query: q?.query ?? '',
            success: false,
            error: new Error('Batch execution cancelled'),
          });
          failed++;
        }
        break;
      }

      const q = queries[i];
      if (!q) continue;
      const queryStart = Date.now();

      try {
        const queryResult = await conn.query(q.query, {
          params: q.params,
          signal: options?.signal,
          pageSize: options?.pageSize,
        });

        // Collect all rows
        const rows: Record<string, unknown>[] = [];
        for await (const row of queryResult) {
          rows.push(rowToObject(row));
        }

        results.push({
          index: i,
          query: q.query,
          success: true,
          rows,
          durationMs: Date.now() - queryStart,
        });
        successful++;
      } catch (error) {
        results.push({
          index: i,
          query: q.query,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          durationMs: Date.now() - queryStart,
        });
        failed++;

        if (stopOnError) {
          // Mark remaining as skipped
          for (let j = i + 1; j < queries.length; j++) {
            const skipped = queries[j];
            results.push({
              index: j,
              query: skipped?.query ?? '',
              success: false,
              error: new Error('Skipped due to previous error'),
            });
            failed++;
          }
          break;
        }
      }
    }

    // Commit transaction if successful
    if (tx && failed === 0) {
      await tx.commit();
    } else if (tx) {
      await tx.rollback();
    }
  } catch (error) {
    // Rollback on unexpected error
    if (tx) {
      try {
        await tx.rollback();
      } catch {
        // Ignore rollback errors
      }
    }
    throw error;
  }

  return {
    total: queries.length,
    successful,
    failed,
    totalDurationMs: Date.now() - startTime,
    results,
  };
}

/**
 * Execute multiple queries and return only successful results.
 *
 * Failed queries are silently ignored (but logged if a logger is provided).
 *
 * @param conn - Connection to use
 * @param queries - Array of queries to execute
 * @param options - Batch execution options
 * @returns Array of successful row results
 */
export async function batchAll(
  conn: Connection,
  queries: BatchQuery[],
  options?: BatchOptions
): Promise<Record<string, unknown>[][]> {
  const summary = await batch(conn, queries, options);

  return summary.results
    .filter(
      (r): r is BatchResult & { rows: Record<string, unknown>[] } =>
        r.success && r.rows !== undefined
    )
    .map((r) => r.rows);
}

/**
 * Execute queries and return the first successful result.
 *
 * Useful for trying multiple query variants.
 *
 * @param conn - Connection to use
 * @param queries - Array of queries to try
 * @param options - Batch execution options
 * @returns First successful result or null
 */
export async function batchFirst(
  conn: Connection,
  queries: BatchQuery[],
  options?: Omit<BatchOptions, 'stopOnError'>
): Promise<Record<string, unknown>[] | null> {
  for (const q of queries) {
    try {
      const rows = await conn.queryAll(q.query, {
        params: q.params,
        signal: options?.signal,
        pageSize: options?.pageSize,
      });
      return rows;
    } catch {
      // Try next query
      continue;
    }
  }
  return null;
}

/**
 * Execute a query for each item in an array.
 *
 * @param conn - Connection to use
 * @param queryTemplate - Query with $item parameter placeholder
 * @param items - Array of items to substitute
 * @param options - Batch execution options
 * @returns Batch summary
 *
 * @example
 * ```typescript
 * const summary = await batchMap(
 *   conn,
 *   'CREATE (n:Person {name: $name})',
 *   [{ name: 'Alice' }, { name: 'Bob' }]
 * );
 * ```
 */
export async function batchMap(
  conn: Connection,
  queryTemplate: string,
  items: QueryParams[],
  options?: BatchOptions
): Promise<BatchSummary> {
  const queries: BatchQuery[] = items.map((params) => ({
    query: queryTemplate,
    params,
  }));

  return batch(conn, queries, options);
}

/**
 * Execute queries in parallel with limited concurrency.
 *
 * Unlike the sequential batch(), this executes multiple queries concurrently
 * up to the specified limit.
 *
 * Note: Results may be returned out of order.
 *
 * @param conn - Connection to use
 * @param queries - Array of queries to execute
 * @param options - Batch execution options with concurrency
 * @returns Batch summary (results in completion order)
 */
export async function batchParallel(
  conn: Connection,
  queries: BatchQuery[],
  options?: BatchOptions & { concurrency: number }
): Promise<BatchSummary> {
  const concurrency = options?.concurrency ?? 5;
  const results: BatchResult[] = [];
  const startTime = Date.now();
  let successful = 0;
  let failed = 0;

  async function executeQuery(index: number): Promise<void> {
    const q = queries[index];
    if (!q) return;
    const queryStart = Date.now();

    try {
      const queryResult = await conn.query(q.query, {
        params: q.params,
        signal: options?.signal,
        pageSize: options?.pageSize,
      });

      const rows: Record<string, unknown>[] = [];
      for await (const row of queryResult) {
        rows.push(rowToObject(row));
      }

      results.push({
        index,
        query: q.query,
        success: true,
        rows,
        durationMs: Date.now() - queryStart,
      });
      successful++;
    } catch (error) {
      results.push({
        index,
        query: q.query,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - queryStart,
      });
      failed++;
    }
  }

  // Process queries with limited concurrency using a simple semaphore pattern
  const executing: Set<Promise<void>> = new Set();

  for (let i = 0; i < queries.length; i++) {
    if (options?.signal?.aborted) {
      break;
    }

    // Wait if we're at the concurrency limit
    while (executing.size >= concurrency) {
      await Promise.race(executing);
    }

    const promise = executeQuery(i).finally(() => {
      executing.delete(promise);
    });
    executing.add(promise);
  }

  // Wait for remaining queries to complete
  await Promise.all(executing);

  // Sort results by index for consistent output
  results.sort((a, b) => a.index - b.index);

  return {
    total: queries.length,
    successful,
    failed,
    totalDurationMs: Date.now() - startTime,
    results,
  };
}
