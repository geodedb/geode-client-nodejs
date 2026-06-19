/**
 * Connection Pool
 *
 * Manages a pool of connections for efficient resource utilization.
 */

import { Connection } from './connection.js';
import type { PoolConfig } from './config.js';
import { TransportError, ErrClosed } from './errors.js';
import type { QueryOptions } from './connection.js';
import type { QueryResult } from './result.js';
import { Transaction, withTransaction } from './transaction.js';

/**
 * Connection wrapper for pool management.
 */
interface PooledConnection {
  connection: Connection;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
}

/**
 * Rate limiter configuration.
 */
export interface RateLimiterConfig {
  /** Maximum number of connection attempts per window (default: 10) */
  maxAttempts: number;
  /** Time window in milliseconds (default: 1000) */
  windowMs: number;
  /** Initial backoff delay in milliseconds (default: 100) */
  initialBackoffMs: number;
  /** Maximum backoff delay in milliseconds (default: 30000) */
  maxBackoffMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
}

/**
 * Default rate limiter configuration.
 */
const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  maxAttempts: 10,
  windowMs: 1000,
  initialBackoffMs: 100,
  maxBackoffMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Simple sliding window rate limiter.
 */
class RateLimiter {
  private _config: RateLimiterConfig;
  private _attempts: number[] = [];
  private _consecutiveFailures = 0;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this._config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config };
  }

  /**
   * Check if a new attempt is allowed.
   */
  isAllowed(): boolean {
    const now = Date.now();
    const windowStart = now - this._config.windowMs;

    // Remove old attempts outside the window
    this._attempts = this._attempts.filter((t) => t > windowStart);

    return this._attempts.length < this._config.maxAttempts;
  }

  /**
   * Record an attempt.
   */
  recordAttempt(): void {
    this._attempts.push(Date.now());
  }

  /**
   * Record a successful connection (resets backoff).
   */
  recordSuccess(): void {
    this._consecutiveFailures = 0;
  }

  /**
   * Record a failed connection attempt.
   */
  recordFailure(): void {
    this._consecutiveFailures++;
  }

  /**
   * Get the current backoff delay based on consecutive failures.
   */
  getBackoffDelay(): number {
    if (this._consecutiveFailures === 0) {
      return 0;
    }

    const delay =
      this._config.initialBackoffMs *
      Math.pow(this._config.backoffMultiplier, this._consecutiveFailures - 1);

    return Math.min(delay, this._config.maxBackoffMs);
  }

  /**
   * Wait for the backoff period.
   */
  async waitForBackoff(): Promise<void> {
    const delay = this.getBackoffDelay();
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Connection pool for managing multiple connections.
 */
export class ConnectionPool {
  private _config: PoolConfig;
  private _connections: PooledConnection[] = [];
  private _pendingConnections = 0;
  private _waitQueue: Array<{
    resolve: (conn: Connection) => void;
    reject: (err: Error) => void;
    signal?: AbortSignal;
  }> = [];
  private _closed = false;
  private _maintenanceInterval?: NodeJS.Timeout;
  private _rateLimiter: RateLimiter;

  // Pool configuration with defaults
  private _minConnections: number;
  private _maxConnections: number;
  private _acquireTimeout: number;
  private _idleTimeout: number;

  constructor(config: PoolConfig, rateLimiterConfig?: Partial<RateLimiterConfig>) {
    this._config = config;
    this._minConnections = config.minConnections ?? 1;
    this._maxConnections = config.maxConnections ?? 3;
    this._acquireTimeout = config.acquireTimeout ?? 30000;
    this._idleTimeout = config.idleTimeout ?? 60000;
    this._rateLimiter = new RateLimiter(rateLimiterConfig);

    // Start maintenance interval
    this._maintenanceInterval = setInterval(() => {
      this.maintenance();
    }, 10000);
    // PERF-8: Allow process to exit cleanly even if pool is alive
    if (this._maintenanceInterval.unref) {
      this._maintenanceInterval.unref();
    }
  }

  /**
   * Create a new connection pool.
   */
  static async create(config: PoolConfig): Promise<ConnectionPool> {
    const pool = new ConnectionPool(config);

    // Initialize minimum connections
    const initPromises: Promise<void>[] = [];
    for (let i = 0; i < pool._minConnections; i++) {
      initPromises.push(pool.addConnection());
    }

    try {
      await Promise.all(initPromises);
    } catch (e) {
      // Close any successfully created connections
      await pool.close();
      throw e;
    }

    return pool;
  }

  /**
   * Get pool statistics.
   */
  get stats(): {
    total: number;
    available: number;
    inUse: number;
    waiting: number;
  } {
    // PERF-13: Single pass instead of two separate filter().length calls
    let inUse = 0;
    for (const c of this._connections) {
      if (c.inUse) {
        inUse++;
      }
    }
    const total = this._connections.length;

    return {
      total,
      available: total - inUse,
      inUse,
      waiting: this._waitQueue.length,
    };
  }

  /**
   * Check if pool is closed.
   */
  get isClosed(): boolean {
    return this._closed;
  }

  /**
   * Acquire a connection from the pool.
   */
  async acquire(signal?: AbortSignal): Promise<Connection> {
    if (this._closed) {
      throw ErrClosed();
    }

    if (signal?.aborted) {
      throw new TransportError({ operation: 'acquire', cause: new Error('Aborted') });
    }

    // Try to find an available connection
    const available = this._connections.find((c) => !c.inUse && !c.connection.isClosed);
    if (available) {
      available.inUse = true;
      available.lastUsedAt = Date.now();
      return available.connection;
    }

    // Try to create a new connection if under max
    if (this._connections.length < this._maxConnections) {
      try {
        await this.addConnection();
        const newConn = this._connections.find((c) => !c.inUse && !c.connection.isClosed);
        if (newConn) {
          newConn.inUse = true;
          newConn.lastUsedAt = Date.now();
          return newConn.connection;
        }
      } catch {
        // Failed to create, fall through to wait
      }
    }

    // Wait for a connection to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this._waitQueue.findIndex((w) => w.resolve === resolve && w.reject === reject);
        if (idx !== -1) {
          this._waitQueue.splice(idx, 1);
        }
        reject(
          new TransportError({
            operation: 'acquire',
            cause: new Error('Connection pool acquire timeout'),
          })
        );
      }, this._acquireTimeout);

      let onAbort: (() => void) | null = null;
      const cleanup = () => {
        clearTimeout(timeout);
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      if (signal) {
        onAbort = () => {
          cleanup();
          const idx = this._waitQueue.findIndex(
            (w) => w.resolve === resolve && w.reject === reject
          );
          if (idx !== -1) {
            this._waitQueue.splice(idx, 1);
          }
          reject(new TransportError({ operation: 'acquire', cause: new Error('Aborted') }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this._waitQueue.push({
        resolve: (conn) => {
          cleanup();
          resolve(conn);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
        signal,
      });
    });
  }

  /**
   * Release a connection back to the pool.
   */
  async release(conn: Connection): Promise<void> {
    const pooledConn = this._connections.find((c) => c.connection === conn);
    if (!pooledConn) {
      return;
    }

    // Reset connection state if needed
    try {
      if (conn.inTransaction) {
        await conn.reset();
      }
    } catch {
      // Connection is bad, remove it
      await this.removeConnection(pooledConn);
      await this.fulfillWaiters();
      return;
    }

    if (conn.isClosed) {
      await this.removeConnection(pooledConn);
      await this.fulfillWaiters();
      return;
    }

    pooledConn.inUse = false;
    pooledConn.lastUsedAt = Date.now();

    // Check if anyone is waiting
    const waiter = this._waitQueue.shift();
    if (waiter) {
      pooledConn.inUse = true;
      pooledConn.lastUsedAt = Date.now();
      waiter.resolve(conn);
    }
  }

  /**
   * Execute a function with a connection from the pool.
   */
  async withConnection<T>(fn: (conn: Connection) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const conn = await this.acquire(signal);
    try {
      return await fn(conn);
    } finally {
      await this.release(conn);
    }
  }

  /**
   * Execute a query using a pooled connection.
   */
  async query(query: string, options?: QueryOptions): Promise<QueryResult> {
    return this.withConnection((conn) => conn.query(query, options), options?.signal);
  }

  /**
   * Execute a query and return all rows.
   */
  async queryAll(query: string, options?: QueryOptions): Promise<Record<string, unknown>[]> {
    return this.withConnection((conn) => conn.queryAll(query, options), options?.signal);
  }

  /**
   * Execute a query using a pooled connection and return the first row.
   * Throws ErrNoRows when the result set is empty.
   */
  async queryRow(query: string, options?: QueryOptions): Promise<Record<string, unknown>> {
    return this.withConnection((conn) => conn.queryRow(query, options), options?.signal);
  }

  /**
   * Execute a statement that doesn't return rows.
   */
  async exec(query: string, options?: QueryOptions): Promise<void> {
    return this.withConnection((conn) => conn.exec(query, options), options?.signal);
  }

  /**
   * Execute a function within a transaction.
   */
  async withTransaction<T>(fn: (tx: Transaction) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.withConnection((conn) => withTransaction(conn, fn, signal), signal);
  }

  /**
   * Ping to verify pool health.
   */
  async ping(signal?: AbortSignal): Promise<void> {
    return this.withConnection((conn) => conn.ping(signal), signal);
  }

  /**
   * Close the pool and all connections.
   */
  async close(): Promise<void> {
    if (this._closed) {
      return;
    }

    this._closed = true;

    // Clear maintenance interval
    if (this._maintenanceInterval) {
      clearInterval(this._maintenanceInterval);
      this._maintenanceInterval = undefined;
    }

    // Reject all waiters
    for (const waiter of this._waitQueue) {
      waiter.reject(ErrClosed());
    }
    this._waitQueue = [];

    // Close all connections
    const closePromises = this._connections.map(async (c) => {
      try {
        await c.connection.close();
      } catch {
        // Ignore close errors
      }
    });

    await Promise.all(closePromises);
    this._connections = [];
  }

  /**
   * Add a new connection to the pool with rate limiting and exponential backoff.
   */
  private async addConnection(): Promise<void> {
    // QUAL-T5: Guard against exceeding maxConnections, including in-flight
    // connection attempts from concurrent acquires or maintenance.
    if (this._connections.length + this._pendingConnections >= this._maxConnections) {
      return;
    }

    this._pendingConnections++;

    try {
      // Check rate limit
      if (!this._rateLimiter.isAllowed()) {
        throw new TransportError({
          operation: 'connect',
          cause: new Error('Connection rate limit exceeded'),
        });
      }

      // Wait for backoff if there were previous failures
      await this._rateLimiter.waitForBackoff();

      // Record the attempt
      this._rateLimiter.recordAttempt();

      const conn = await Connection.connect(this._config);
      this._rateLimiter.recordSuccess();
      this._connections.push({
        connection: conn,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: false,
      });
    } catch (e) {
      this._rateLimiter.recordFailure();
      throw e;
    } finally {
      this._pendingConnections--;
    }
  }

  /**
   * Remove a connection from the pool.
   */
  private async removeConnection(pooledConn: PooledConnection): Promise<void> {
    const idx = this._connections.indexOf(pooledConn);
    if (idx !== -1) {
      this._connections.splice(idx, 1);
    }
    try {
      await pooledConn.connection.close();
    } catch {
      // Ignore close errors
    }
  }

  private async fulfillWaiters(): Promise<void> {
    while (this._waitQueue.length > 0) {
      const available = this._connections.find((c) => !c.inUse && !c.connection.isClosed);
      if (available) {
        available.inUse = true;
        available.lastUsedAt = Date.now();
        const waiter = this._waitQueue.shift();
        waiter?.resolve(available.connection);
        continue;
      }

      if (this._connections.length + this._pendingConnections >= this._maxConnections) {
        return;
      }

      try {
        await this.addConnection();
      } catch {
        return;
      }
    }
  }

  /**
   * Perform pool maintenance.
   */
  private maintenance(): void {
    if (this._closed) {
      return;
    }

    const now = Date.now();

    // Remove idle connections that have exceeded the idle timeout,
    // but only if the total active (non-closed) count exceeds minConnections.
    const idleConnections = this._connections
      .filter((c) => !c.inUse && now - c.lastUsedAt > this._idleTimeout)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

    const activeCount = this._connections.filter((c) => !c.connection.isClosed).length;
    const toRemove = Math.max(0, activeCount - this._minConnections);
    for (let i = 0; i < toRemove; i++) {
      const conn = idleConnections[i];
      if (conn) {
        this.removeConnection(conn).catch(() => {
          // Ignore removal errors
        });
      }
    }

    // Remove closed connections
    for (const conn of this._connections.filter((c) => c.connection.isClosed)) {
      this.removeConnection(conn).catch(() => {
        // Ignore removal errors
      });
    }

    // Ensure minimum connections
    const available = this._connections.filter((c) => !c.connection.isClosed).length;
    const toCreate = this._minConnections - (available + this._pendingConnections);
    for (let i = 0; i < toCreate; i++) {
      this.addConnection().catch(() => {
        // Ignore creation errors during maintenance
      });
    }
  }
}
