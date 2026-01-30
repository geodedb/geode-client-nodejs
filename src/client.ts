/**
 * Geode Client
 *
 * High-level client for interacting with Geode graph database.
 */

import { Connection, type QueryOptions, type QueryParams } from './connection.js';
import { ConnectionPool } from './pool.js';
import type { GeodeConfig, PoolConfig } from './config.js';
import { parseDSN } from './config.js';
import type { QueryResult } from './result.js';
import { Transaction, withTransaction } from './transaction.js';
import type { PreparedStatement } from './prepared.js';
import type { QueryPlan, QueryProfile, ExplainOptions } from './explain.js';
import type { BatchQuery, BatchSummary, BatchOptions } from './batch.js';
import type { AuthClient } from './auth.js';
import {
  validateLabel,
  validatePropertyName,
  validateRelationshipType,
} from './validate.js';

/**
 * Client configuration options.
 */
export interface ClientOptions extends Partial<GeodeConfig> {
  /** Use connection pooling */
  pooling?: boolean;
  /** Pool-specific options */
  pool?: {
    min?: number;
    max?: number;
    acquireTimeout?: number;
    idleTimeout?: number;
  };
}

/**
 * Geode Client - main entry point for database operations.
 */
export class GeodeClient {
  private _config: GeodeConfig;
  private _pool?: ConnectionPool;
  private _connection?: Connection;

  private constructor(config: GeodeConfig) {
    this._config = config;
  }

  /**
   * Create a new client from a DSN string.
   */
  static async connect(dsn: string, options?: ClientOptions): Promise<GeodeClient> {
    const config = parseDSN(dsn);

    // Apply additional options
    if (options) {
      Object.assign(config, options);
    }

    const usePool = options?.pooling ?? true;
    const client = new GeodeClient(config);

    if (usePool) {
      const poolConfig: PoolConfig = {
        ...config,
        minConnections: options?.pool?.min,
        maxConnections: options?.pool?.max,
        acquireTimeout: options?.pool?.acquireTimeout,
        idleTimeout: options?.pool?.idleTimeout,
      };
      client._pool = await ConnectionPool.create(poolConfig);
    } else {
      client._connection = await Connection.connect(config);
    }

    return client;
  }

  /**
   * Create a new client from configuration.
   */
  static async connectWithConfig(
    config: GeodeConfig,
    options?: ClientOptions
  ): Promise<GeodeClient> {
    const usePool = options?.pooling ?? true;
    const client = new GeodeClient(config);

    if (usePool) {
      const poolConfig: PoolConfig = {
        ...config,
        minConnections: options?.pool?.min,
        maxConnections: options?.pool?.max,
        acquireTimeout: options?.pool?.acquireTimeout,
        idleTimeout: options?.pool?.idleTimeout,
      };
      client._pool = await ConnectionPool.create(poolConfig);
    } else {
      client._connection = await Connection.connect(config);
    }

    return client;
  }

  /**
   * Get the client configuration.
   */
  get config(): Readonly<GeodeConfig> {
    return this._config;
  }

  /**
   * Check if client is closed.
   */
  get isClosed(): boolean {
    if (this._pool) {
      return this._pool.isClosed;
    }
    return this._connection?.isClosed ?? true;
  }

  /**
   * Get pool statistics (if using pooling).
   */
  get poolStats(): { total: number; available: number; inUse: number; waiting: number } | null {
    return this._pool?.stats ?? null;
  }

  /**
   * Execute a query and return results.
   */
  async query(query: string, options?: QueryOptions): Promise<QueryResult> {
    if (this._pool) {
      return this._pool.query(query, options);
    }
    if (!this._connection) {
      throw new Error('Client is not connected');
    }
    return this._connection.query(query, options);
  }

  /**
   * Execute a query and return all rows as objects.
   */
  async queryAll(query: string, options?: QueryOptions): Promise<Record<string, unknown>[]> {
    if (this._pool) {
      return this._pool.queryAll(query, options);
    }
    if (!this._connection) {
      throw new Error('Client is not connected');
    }
    return this._connection.queryAll(query, options);
  }

  /**
   * Execute a query and return the first row.
   */
  async queryFirst(query: string, options?: QueryOptions): Promise<Record<string, unknown> | null> {
    const result = await this.query(query, options);
    return result.firstObject();
  }

  /**
   * Execute a query and return a scalar value.
   */
  async queryScalar<T = unknown>(
    query: string,
    column: string,
    options?: QueryOptions
  ): Promise<T | null> {
    const row = await this.queryFirst(query, options);
    if (!row) {
      return null;
    }
    return row[column] as T;
  }

  /**
   * Execute a statement that doesn't return rows.
   */
  async exec(query: string, options?: QueryOptions): Promise<void> {
    if (this._pool) {
      return this._pool.exec(query, options);
    }
    if (!this._connection) {
      throw new Error('Client is not connected');
    }
    return this._connection.exec(query, options);
  }

  /**
   * Execute multiple statements.
   */
  async execBatch(queries: Array<{ query: string; params?: QueryParams }>): Promise<void> {
    for (const q of queries) {
      await this.exec(q.query, { params: q.params });
    }
  }

  /**
   * Execute a function within a transaction.
   */
  async withTransaction<T>(fn: (tx: Transaction) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this._pool) {
      return this._pool.withTransaction(fn, signal);
    }
    if (!this._connection) {
      throw new Error('Client is not connected');
    }
    return withTransaction(this._connection, fn, signal);
  }

  /**
   * Get a raw connection from the pool (or the single connection).
   *
   * The connection must be released after use.
   */
  async getConnection(signal?: AbortSignal): Promise<Connection> {
    if (this._pool) {
      return this._pool.acquire(signal);
    }
    if (!this._connection) {
      throw new Error('Client is not connected');
    }
    return this._connection;
  }

  /**
   * Release a connection back to the pool.
   *
   * Only needed when using getConnection() with pooling.
   */
  async releaseConnection(conn: Connection): Promise<void> {
    if (this._pool) {
      return this._pool.release(conn);
    }
    // No-op for single connection mode
  }

  /**
   * Execute a function with a dedicated connection.
   */
  async withConnection<T>(fn: (conn: Connection) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this._pool) {
      return this._pool.withConnection(fn, signal);
    }
    if (!this._connection) {
      throw new Error('Client is not connected');
    }
    return fn(this._connection);
  }

  /**
   * Ping the server to check connectivity.
   */
  async ping(signal?: AbortSignal): Promise<void> {
    if (this._pool) {
      return this._pool.ping(signal);
    }
    if (!this._connection) {
      throw new Error('Client is not connected');
    }
    return this._connection.ping(signal);
  }

  /**
   * Close the client and release all resources.
   */
  async close(): Promise<void> {
    if (this._pool) {
      await this._pool.close();
      this._pool = undefined;
    }
    if (this._connection) {
      await this._connection.close();
      this._connection = undefined;
    }
  }

  // Convenience methods for common graph operations

  /**
   * Create a node with labels and properties.
   */
  async createNode(
    labels: string | string[],
    properties?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Validate labels
    const labelArray = Array.isArray(labels) ? labels : [labels];
    for (const label of labelArray) {
      validateLabel(label);
    }
    const labelStr = labelArray.join(':');

    // Validate property keys if provided
    if (properties) {
      for (const key of Object.keys(properties)) {
        validatePropertyName(key);
      }
    }

    const propsStr = properties ? ' $props' : '';

    const result = await this.queryFirst(
      `CREATE (n:${labelStr}${propsStr}) RETURN n`,
      properties ? { params: { props: properties } } : undefined
    );

    return result?.['n'] as Record<string, unknown>;
  }

  /**
   * Find nodes by label and optional property filter.
   */
  async findNodes(
    label: string,
    filter?: Record<string, unknown>,
    options?: { limit?: number; skip?: number }
  ): Promise<Record<string, unknown>[]> {
    // Validate label
    validateLabel(label);

    // Validate filter property keys
    if (filter) {
      for (const key of Object.keys(filter)) {
        validatePropertyName(key);
      }
    }

    let query = `MATCH (n:${label})`;

    if (filter && Object.keys(filter).length > 0) {
      const conditions = Object.keys(filter)
        .map((k) => `n.${k} = $${k}`)
        .join(' AND ');
      query += ` WHERE ${conditions}`;
    }

    query += ' RETURN n';

    if (options?.skip) {
      query += ` SKIP ${options.skip}`;
    }
    if (options?.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const rows = await this.queryAll(query, { params: filter });
    return rows.map((r) => r['n'] as Record<string, unknown>);
  }

  /**
   * Find a single node by label and property.
   */
  async findNode(
    label: string,
    property: string,
    value: unknown
  ): Promise<Record<string, unknown> | null> {
    // Validation happens in findNodes, but validate property here for better error messages
    validatePropertyName(property);
    const rows = await this.findNodes(label, { [property]: value }, { limit: 1 });
    return rows[0] ?? null;
  }

  /**
   * Create a relationship between two nodes.
   */
  async createRelationship(
    startLabel: string,
    startProp: string,
    startValue: unknown,
    type: string,
    endLabel: string,
    endProp: string,
    endValue: unknown,
    properties?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Validate all identifiers
    validateLabel(startLabel);
    validateLabel(endLabel);
    validateRelationshipType(type);
    validatePropertyName(startProp);
    validatePropertyName(endProp);

    // Validate property keys if provided
    if (properties) {
      for (const key of Object.keys(properties)) {
        validatePropertyName(key);
      }
    }

    const propsStr = properties ? ' $props' : '';

    const result = await this.queryFirst(
      `MATCH (a:${startLabel}), (b:${endLabel})
       WHERE a.${startProp} = $startValue AND b.${endProp} = $endValue
       CREATE (a)-[r:${type}${propsStr}]->(b)
       RETURN r`,
      {
        params: {
          startValue,
          endValue,
          ...(properties ? { props: properties } : {}),
        },
      }
    );

    return result?.['r'] as Record<string, unknown>;
  }

  /**
   * Delete a node by label and property.
   */
  async deleteNode(label: string, property: string, value: unknown): Promise<number> {
    // Validate identifiers
    validateLabel(label);
    validatePropertyName(property);

    const result = await this.queryFirst(
      `MATCH (n:${label}) WHERE n.${property} = $value DETACH DELETE n RETURN count(n) AS deleted`,
      { params: { value } }
    );
    return (result?.['deleted'] as number) ?? 0;
  }

  /**
   * Update node properties.
   */
  async updateNode(
    label: string,
    matchProp: string,
    matchValue: unknown,
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    // Validate identifiers
    validateLabel(label);
    validatePropertyName(matchProp);

    // Validate update property keys
    for (const key of Object.keys(updates)) {
      validatePropertyName(key);
    }

    const setStatements = Object.keys(updates)
      .map((k) => `n.${k} = $${k}`)
      .join(', ');

    const result = await this.queryFirst(
      `MATCH (n:${label}) WHERE n.${matchProp} = $matchValue SET ${setStatements} RETURN n`,
      { params: { matchValue, ...updates } }
    );

    return result?.['n'] as Record<string, unknown> | null;
  }

  /**
   * Count nodes by label.
   */
  async countNodes(label: string, filter?: Record<string, unknown>): Promise<number> {
    // Validate label
    validateLabel(label);

    // Validate filter property keys
    if (filter) {
      for (const key of Object.keys(filter)) {
        validatePropertyName(key);
      }
    }

    let query = `MATCH (n:${label})`;

    if (filter && Object.keys(filter).length > 0) {
      const conditions = Object.keys(filter)
        .map((k) => `n.${k} = $${k}`)
        .join(' AND ');
      query += ` WHERE ${conditions}`;
    }

    query += ' RETURN count(n) AS count';

    const result = await this.queryFirst(query, { params: filter });
    return (result?.['count'] as number) ?? 0;
  }

  // Advanced operations

  /**
   * Create a prepared statement.
   *
   * @param query - Query text with parameters
   * @returns Prepared statement
   *
   * @example
   * ```typescript
   * const stmt = client.prepare('MATCH (n:Person {name: $name}) RETURN n');
   * const result1 = await stmt.query({ name: 'Alice' });
   * const result2 = await stmt.query({ name: 'Bob' });
   * stmt.close();
   * ```
   */
  async prepare(query: string): Promise<PreparedStatement> {
    const conn = await this.getConnection();
    try {
      return conn.prepare(query);
    } finally {
      await this.releaseConnection(conn);
    }
  }

  /**
   * Get the query execution plan without executing.
   *
   * @param query - Query to explain
   * @param options - Options including parameters
   * @returns Query execution plan
   *
   * @example
   * ```typescript
   * const plan = await client.explain('MATCH (n:Person)-[:KNOWS]->(m) RETURN n, m');
   * console.log('Estimated cost:', plan.totalCost);
   * ```
   */
  async explain(query: string, options?: ExplainOptions): Promise<QueryPlan> {
    const conn = await this.getConnection(options?.signal);
    try {
      return await conn.explain(query, options);
    } finally {
      await this.releaseConnection(conn);
    }
  }

  /**
   * Execute a query with profiling.
   *
   * @param query - Query to profile
   * @param options - Options including parameters
   * @returns Query execution profile
   *
   * @example
   * ```typescript
   * const profile = await client.profile('MATCH (n:Person) RETURN count(n)');
   * console.log('Execution time:', profile.totalTimeMs, 'ms');
   * ```
   */
  async profile(query: string, options?: ExplainOptions): Promise<QueryProfile> {
    const conn = await this.getConnection(options?.signal);
    try {
      return await conn.profile(query, options);
    } finally {
      await this.releaseConnection(conn);
    }
  }

  /**
   * Execute multiple queries in a batch.
   *
   * @param queries - Array of queries to execute
   * @param options - Batch execution options
   * @returns Batch execution summary
   *
   * @example
   * ```typescript
   * const summary = await client.batch([
   *   { query: 'CREATE (a:Person {name: "Alice"})' },
   *   { query: 'CREATE (b:Person {name: "Bob"})' },
   * ]);
   * console.log(`${summary.successful}/${summary.total} succeeded`);
   * ```
   */
  async batch(queries: BatchQuery[], options?: BatchOptions): Promise<BatchSummary> {
    const conn = await this.getConnection(options?.signal);
    try {
      return await conn.batch(queries, options);
    } finally {
      await this.releaseConnection(conn);
    }
  }

  /**
   * Get an auth client for user and role management.
   *
   * @returns Auth client
   *
   * @example
   * ```typescript
   * const auth = await client.auth();
   * await auth.createUser('alice', { password: 'secret123' });
   * await auth.assignRole('alice', 'analyst');
   * ```
   */
  async auth(): Promise<AuthClient> {
    const { AuthClient } = await import('./auth.js');
    const conn = await this.getConnection();
    return new AuthClient(conn);
  }
}

/**
 * Create a Geode client from a DSN string.
 *
 * @example
 * ```typescript
 * const client = await createClient('geode://localhost:3141');
 * const rows = await client.queryAll('MATCH (n) RETURN n LIMIT 10');
 * await client.close();
 * ```
 */
export async function createClient(dsn: string, options?: ClientOptions): Promise<GeodeClient> {
  return GeodeClient.connect(dsn, options);
}

/**
 * Create a Geode client from configuration.
 */
export async function createClientWithConfig(
  config: GeodeConfig,
  options?: ClientOptions
): Promise<GeodeClient> {
  return GeodeClient.connectWithConfig(config, options);
}
