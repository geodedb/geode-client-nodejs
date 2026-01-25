/**
 * Query Result Handling
 *
 * Implements async iteration over query results with pagination.
 */

import type { ColumnInfo, Row } from './types.js';
import { parseRow, rowToObject } from './types.js';
import type { Connection } from './connection.js';

/**
 * Query result with async iteration support.
 */
export class QueryResult implements AsyncIterable<Row> {
  private _conn: Connection;
  private _columns: ColumnInfo[];
  private _buffer: Record<string, unknown>[];
  private _final: boolean;
  private _ordered: boolean;
  private _orderKeys: string[];
  private _pageSize: number;
  private _signal?: AbortSignal;
  private _closed = false;
  private _bufferIndex = 0;
  private _rowCount = 0;

  constructor(
    conn: Connection,
    columns: ColumnInfo[],
    initialRows: Record<string, unknown>[],
    final: boolean,
    ordered: boolean,
    orderKeys: string[],
    pageSize: number,
    signal?: AbortSignal
  ) {
    this._conn = conn;
    this._columns = columns;
    this._buffer = initialRows;
    this._final = final;
    this._ordered = ordered;
    this._orderKeys = orderKeys;
    this._pageSize = pageSize;
    this._signal = signal;
  }

  /**
   * Get column definitions.
   */
  get columns(): readonly ColumnInfo[] {
    return this._columns;
  }

  /**
   * Get column names.
   */
  get columnNames(): string[] {
    return this._columns.map((c) => c.name);
  }

  /**
   * Check if results are ordered.
   */
  get ordered(): boolean {
    return this._ordered;
  }

  /**
   * Get order keys (if ordered).
   */
  get orderKeys(): readonly string[] {
    return this._orderKeys;
  }

  /**
   * Check if all results have been fetched.
   */
  get complete(): boolean {
    return this._final && this._bufferIndex >= this._buffer.length;
  }

  /**
   * Check if result is closed.
   */
  get isClosed(): boolean {
    return this._closed;
  }

  /**
   * Get the number of rows returned so far.
   */
  get rowCount(): number {
    return this._rowCount;
  }

  /**
   * Async iterator implementation.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<Row> {
    try {
      while (!this._closed) {
        // Check signal
        if (this._signal?.aborted) {
          break;
        }

        // Return buffered rows
        while (this._bufferIndex < this._buffer.length) {
          const rawRow = this._buffer[this._bufferIndex];
          if (rawRow) {
            this._bufferIndex++;
            this._rowCount++;
            yield parseRow(rawRow, this._columns);
          }
        }

        // If final, we're done
        if (this._final) {
          break;
        }

        // Fetch next page
        const { rows, final } = await this._conn._fetchNextPage(this._pageSize, this._signal);
        this._buffer = rows;
        this._bufferIndex = 0;
        this._final = final;
      }
    } finally {
      this.close();
    }
  }

  /**
   * Get all remaining rows as an array.
   */
  async toArray(): Promise<Row[]> {
    const rows: Row[] = [];
    for await (const row of this) {
      rows.push(row);
    }
    return rows;
  }

  /**
   * Get all remaining rows as plain objects.
   */
  async toObjects(): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for await (const row of this) {
      rows.push(rowToObject(row));
    }
    return rows;
  }

  /**
   * Get the first row (or null if empty).
   */
  async first(): Promise<Row | null> {
    for await (const row of this) {
      this.close();
      return row;
    }
    return null;
  }

  /**
   * Get the first row as plain object (or null if empty).
   */
  async firstObject(): Promise<Record<string, unknown> | null> {
    const row = await this.first();
    return row ? rowToObject(row) : null;
  }

  /**
   * Apply a function to each row.
   */
  async forEach(fn: (row: Row, index: number) => void | Promise<void>): Promise<void> {
    let index = 0;
    for await (const row of this) {
      await fn(row, index++);
    }
  }

  /**
   * Map rows to a new array.
   */
  async map<T>(fn: (row: Row, index: number) => T | Promise<T>): Promise<T[]> {
    const results: T[] = [];
    let index = 0;
    for await (const row of this) {
      results.push(await fn(row, index++));
    }
    return results;
  }

  /**
   * Filter rows.
   */
  async filter(predicate: (row: Row, index: number) => boolean | Promise<boolean>): Promise<Row[]> {
    const results: Row[] = [];
    let index = 0;
    for await (const row of this) {
      if (await predicate(row, index++)) {
        results.push(row);
      }
    }
    return results;
  }

  /**
   * Reduce rows to a single value.
   */
  async reduce<T>(fn: (acc: T, row: Row, index: number) => T | Promise<T>, initial: T): Promise<T> {
    let acc = initial;
    let index = 0;
    for await (const row of this) {
      acc = await fn(acc, row, index++);
    }
    return acc;
  }

  /**
   * Close the result set.
   */
  close(): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this._conn._releaseResult(this);
  }

  /**
   * Internal close (called by connection).
   */
  _close(): void {
    this._closed = true;
  }
}

/**
 * Iterator for synchronous access to query results.
 *
 * This wraps the async iterator for cases where results are pre-fetched.
 */
export class QueryResultIterator {
  private _result: QueryResult;
  private _iterator: AsyncIterator<Row>;

  constructor(result: QueryResult) {
    this._result = result;
    this._iterator = result[Symbol.asyncIterator]();
  }

  /**
   * Get the next row.
   */
  async next(): Promise<{ done: boolean; value?: Row }> {
    const result: IteratorResult<Row, void> = await this._iterator.next();
    return {
      done: result.done ?? false,
      value: result.done ? undefined : result.value,
    };
  }

  /**
   * Close the iterator.
   */
  close(): void {
    this._result.close();
  }
}
