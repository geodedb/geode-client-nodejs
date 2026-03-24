/**
 * Transaction Management
 *
 * Provides transaction and savepoint support.
 */

import type { Connection, QueryOptions } from './connection.js';
import type { QueryResult } from './result.js';
import { ErrNoTx, ErrTxDone } from './errors.js';

/**
 * Transaction represents an active database transaction.
 */
export class Transaction {
  private _conn: Connection;
  private _done = false;
  private _savepoints: string[] = [];

  constructor(conn: Connection) {
    this._conn = conn;
  }

  /**
   * Check if transaction is complete (committed or rolled back).
   */
  get isDone(): boolean {
    return this._done;
  }

  /**
   * Get the list of active savepoints.
   */
  get savepoints(): readonly string[] {
    return this._savepoints;
  }

  /**
   * Execute a query within the transaction.
   */
  async query(query: string, options?: QueryOptions): Promise<QueryResult> {
    this.checkDone();
    return this._conn.query(query, options);
  }

  /**
   * Execute a query and return all rows.
   */
  async queryAll(query: string, options?: QueryOptions): Promise<Record<string, unknown>[]> {
    this.checkDone();
    return this._conn.queryAll(query, options);
  }

  /**
   * Execute a statement that doesn't return rows.
   */
  async exec(query: string, options?: QueryOptions): Promise<void> {
    this.checkDone();
    return this._conn.exec(query, options);
  }

  /**
   * Create a savepoint.
   */
  async savepoint(name: string, signal?: AbortSignal): Promise<void> {
    this.checkDone();
    await this._conn._savepoint(name, signal);
    this._savepoints.push(name);
  }

  /**
   * Rollback to a savepoint.
   */
  async rollbackTo(name: string, signal?: AbortSignal): Promise<void> {
    this.checkDone();

    const idx = this._savepoints.indexOf(name);
    if (idx === -1) {
      throw new Error(`Savepoint not found: ${name}`);
    }

    await this._conn._rollbackTo(name, signal);

    // Remove this savepoint and all savepoints created after it
    this._savepoints = this._savepoints.slice(0, idx);
  }

  /**
   * Release a savepoint.
   *
   * Note: Geode doesn't have explicit RELEASE SAVEPOINT, but we track it client-side.
   */
  release(name: string): void {
    this.checkDone();

    const idx = this._savepoints.indexOf(name);
    if (idx === -1) {
      throw new Error(`Savepoint not found: ${name}`);
    }

    // Remove the savepoint
    this._savepoints.splice(idx, 1);
  }

  /**
   * Commit the transaction.
   */
  async commit(signal?: AbortSignal): Promise<void> {
    this.checkDone();
    this._done = true;
    await this._conn._commit(signal);
    this._savepoints = [];
  }

  /**
   * Rollback the transaction.
   */
  async rollback(signal?: AbortSignal): Promise<void> {
    this.checkDone();
    this._done = true;
    await this._conn._rollback(signal);
    this._savepoints = [];
  }

  /**
   * Execute a function within the transaction with automatic commit/rollback.
   */
  async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    this.checkDone();

    try {
      const result = await fn(this);
      await this.commit();
      return result;
    } catch (e) {
      if (!this._done) {
        await this.rollback();
      }
      throw e;
    }
  }

  /**
   * Check if transaction is already done.
   */
  private checkDone(): void {
    if (this._done) {
      throw ErrTxDone();
    }
    if (!this._conn.inTransaction) {
      throw ErrNoTx();
    }
  }
}

/**
 * Execute a function within a new transaction.
 *
 * Automatically commits on success or rolls back on error.
 */
export async function withTransaction<T>(
  conn: Connection,
  fn: (tx: Transaction) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const tx = await conn.begin(signal);
  return tx.run(fn);
}
