/**
 * Geode Connection
 *
 * Connection management and query execution.
 */

import type { GeodeConfig } from './config.js';
import { validateConfig } from './config.js';
import {
  TransportError,
  ErrClosed,
  ErrQueryInProgress,
  ErrTxInProgress,
  type ConnectionState,
} from './errors.js';
import type { Transport } from './transport.js';
import { createTransport } from './transport.js';
import {
  buildHelloMessage,
  buildRunGQLMessage,
  buildPullMessage,
  buildBeginMessage,
  buildCommitMessage,
  buildRollbackMessage,
  buildSavepointMessage,
  buildRollbackToMessage,
  buildPingMessage,
  parseFrame,
  isErrorFrame,
  isSchemaFrame,
  frameToError,
  getColumnsFromSchema,
  rewritePlaceholders,
  RespType,
} from './protocol.js';
import { validateQuery, validateParamValue, validateSavepointName } from './validate.js';
import { rowToObject } from './types.js';
import { Transaction } from './transaction.js';
import { QueryResult } from './result.js';
import type { PreparedStatement } from './prepared.js';
import type { QueryPlan, QueryProfile, ExplainOptions } from './explain.js';
import type { BatchQuery, BatchSummary, BatchOptions } from './batch.js';

/**
 * Query parameters type.
 */
export type QueryParams = Record<string, unknown>;

/**
 * Query options.
 */
export interface QueryOptions {
  /** Query parameters */
  params?: QueryParams;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Page size for result pagination */
  pageSize?: number;
}

/**
 * Connection to a Geode database.
 */
export class Connection {
  private _config: GeodeConfig;
  private _transport: Transport;
  private _state: ConnectionState = 'idle';
  private _inTransaction = false;
  private _activeResult: QueryResult | null = null;
  private _requestId = 0;

  private constructor(config: GeodeConfig, transport: Transport) {
    this._config = config;
    this._transport = transport;
  }

  /**
   * Create a new connection to the Geode server.
   */
  static async connect(config: GeodeConfig): Promise<Connection> {
    validateConfig(config);

    const transport = await createTransport(config);
    const conn = new Connection(config, transport);

    try {
      await conn.hello();
      return conn;
    } catch (e) {
      await transport.close();
      throw e;
    }
  }

  /**
   * Create a connection with a custom transport (for testing).
   */
  static async connectWithTransport(
    config: GeodeConfig,
    transport: Transport
  ): Promise<Connection> {
    const conn = new Connection(config, transport);
    await conn.hello();
    return conn;
  }

  /**
   * Get connection configuration.
   */
  get config(): Readonly<GeodeConfig> {
    return this._config;
  }

  /**
   * Get current connection state.
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Check if connection is in a transaction.
   */
  get inTransaction(): boolean {
    return this._inTransaction;
  }

  /**
   * Check if connection is closed.
   */
  get isClosed(): boolean {
    return this._state === 'closed' || this._transport.isClosed();
  }

  /**
   * Perform the HELLO handshake.
   *
   * Note: The server may return an ERROR frame with "Authentication required"
   * even when no authentication is configured. This is a known server behavior
   * that should be treated as a successful connection (matching other clients).
   */
  private async hello(): Promise<void> {
    const msg = buildHelloMessage(this._config);
    await this._transport.send(msg);

    const data = await this._transport.receive();
    const frame = parseFrame(data);

    // Don't throw on authentication errors during HELLO when no auth is configured
    // The server may return this error but still accept the connection
    if (isErrorFrame(frame)) {
      const statusClass = frame.status_class ?? frame.result.code;
      // 28000 is "invalid authorization specification" - ignore if no credentials provided
      const hasCredentials = Boolean(this._config.username) || Boolean(this._config.password);
      if (statusClass !== '28000' || hasCredentials) {
        throw frameToError(frame);
      }
      // Otherwise, continue - the connection is still valid
    }
  }

  /**
   * Execute a query that returns rows.
   */
  async query(query: string, options?: QueryOptions): Promise<QueryResult> {
    this.checkState('query');

    validateQuery(query);

    let finalQuery = query;
    let params = options?.params ?? {};

    // Handle positional parameters (?)
    if (query.includes('?') && Array.isArray(options?.params)) {
      const result = rewritePlaceholders(query, options.params as unknown[]);
      finalQuery = result.query;
      params = result.params;
    }

    // Validate parameters
    for (const [_key, value] of Object.entries(params)) {
      validateParamValue(value);
    }

    const signal = options?.signal;

    try {
      this._state = 'fetching';

      // Send RUN_GQL
      await this._transport.send(buildRunGQLMessage(finalQuery, params), signal);

      // Read SCHEMA response
      const schemaData = await this._transport.receive(signal);
      const schemaFrame = parseFrame(schemaData);

      if (isErrorFrame(schemaFrame)) {
        this._state = this._inTransaction ? 'in_transaction' : 'idle';
        throw frameToError(schemaFrame);
      }

      if (!isSchemaFrame(schemaFrame)) {
        this._state = this._inTransaction ? 'in_transaction' : 'idle';
        throw new TransportError({
          operation: 'query',
          cause: new Error(`Expected SCHEMA frame, got ${schemaFrame.result.type}`),
        });
      }

      const columns = getColumnsFromSchema(schemaFrame);

      // Inline RUN+PULL: check if a bindings frame already arrived.
      const inlineFrame = await this._tryReceiveInlineFrame(signal);
      if (inlineFrame) {
        if (isErrorFrame(inlineFrame)) {
          this._state = this._inTransaction ? 'in_transaction' : 'idle';
          throw frameToError(inlineFrame);
        }

        const result = new QueryResult(
          this,
          columns,
          inlineFrame.result.rows ?? [],
          inlineFrame.result.final ?? true,
          inlineFrame.result.ordered ?? false,
          inlineFrame.result.order_keys ?? [],
          options?.pageSize ?? this._config.pageSize,
          signal
        );

        this._activeResult = result;
        return result;
      }

      // Send first PULL
      this._requestId++;
      const pageSize = options?.pageSize ?? this._config.pageSize;
      await this._transport.send(buildPullMessage(this._requestId, pageSize), signal);

      // Read first BINDINGS response
      const bindingsData = await this._transport.receive(signal);
      const bindingsFrame = parseFrame(bindingsData);

      if (isErrorFrame(bindingsFrame)) {
        this._state = this._inTransaction ? 'in_transaction' : 'idle';
        throw frameToError(bindingsFrame);
      }

      // Create result
      const result = new QueryResult(
        this,
        columns,
        bindingsFrame.result.rows ?? [],
        bindingsFrame.result.final ?? true,
        bindingsFrame.result.ordered ?? false,
        bindingsFrame.result.order_keys ?? [],
        pageSize,
        signal
      );

      this._activeResult = result;
      return result;
    } catch (e) {
      this._state = this._inTransaction ? 'in_transaction' : 'idle';
      throw e;
    }
  }

  /**
   * Execute a query and return all rows as an array.
   */
  async queryAll(query: string, options?: QueryOptions): Promise<Record<string, unknown>[]> {
    const result = await this.query(query, options);
    const rows: Record<string, unknown>[] = [];

    for await (const row of result) {
      rows.push(rowToObject(row));
    }

    return rows;
  }

  /**
   * Execute a query that doesn't return rows.
   */
  async exec(query: string, options?: QueryOptions): Promise<void> {
    this.checkState('exec');

    validateQuery(query);

    let finalQuery = query;
    let params = options?.params ?? {};

    // Handle positional parameters
    if (query.includes('?') && Array.isArray(options?.params)) {
      const result = rewritePlaceholders(query, options.params as unknown[]);
      finalQuery = result.query;
      params = result.params;
    }

    // Validate parameters
    for (const [_key, value] of Object.entries(params)) {
      validateParamValue(value);
    }

    const signal = options?.signal;

    try {
      this._state = 'executing';

      // Send RUN_GQL
      await this._transport.send(buildRunGQLMessage(finalQuery, params), signal);

      // Read response
      const data = await this._transport.receive(signal);
      const frame = parseFrame(data);

      if (isErrorFrame(frame)) {
        throw frameToError(frame);
      }

      // Drain any inline BINDINGS frame to keep the stream aligned.
      if (frame.result.type === RespType.SCHEMA) {
        const inlineFrame = await this._tryReceiveInlineFrame(signal);
        if (inlineFrame && isErrorFrame(inlineFrame)) {
          throw frameToError(inlineFrame);
        }
      }
    } finally {
      this._state = this._inTransaction ? 'in_transaction' : 'idle';
    }
  }

  /**
   * Fetch the next page of results (internal).
   */
  async _fetchNextPage(
    pageSize: number,
    signal?: AbortSignal
  ): Promise<{
    rows: Record<string, unknown>[];
    final: boolean;
  }> {
    this._requestId++;
    await this._transport.send(buildPullMessage(this._requestId, pageSize), signal);

    const data = await this._transport.receive(signal);
    const frame = parseFrame(data);

    if (isErrorFrame(frame)) {
      throw frameToError(frame);
    }

    const resultType = frame.result.type;
    if (resultType === RespType.BINDINGS) {
      return {
        rows: frame.result.rows ?? [],
        final: frame.result.final ?? true,
      };
    }

    // PROFILE, RESULT, STATUS frames indicate no more data
    return {
      rows: [],
      final: true,
    };
  }

  private async _tryReceiveInlineFrame(
    signal?: AbortSignal
  ): Promise<ReturnType<typeof parseFrame> | null> {
    if (signal?.aborted) {
      return null;
    }
    const controller = new AbortController();
    // Use 10ms timeout to check for inline data - gives time for data in network
    // buffers to be processed while still being fast enough for latency-sensitive queries
    const timeoutId = setTimeout(() => controller.abort(), 10);
    try {
      const data = await this._transport.receive(controller.signal);
      return parseFrame(data);
    } catch (err) {
      if (err instanceof TransportError && err.cause?.message === 'Aborted') {
        return null;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Release active result (internal).
   */
  _releaseResult(result: QueryResult): void {
    if (this._activeResult === result) {
      this._activeResult = null;
      this._state = this._inTransaction ? 'in_transaction' : 'idle';
    }
  }

  /**
   * Begin a transaction.
   */
  async begin(signal?: AbortSignal): Promise<Transaction> {
    this.checkState('begin');

    if (this._inTransaction) {
      throw ErrTxInProgress;
    }

    await this._transport.send(buildBeginMessage(), signal);

    const data = await this._transport.receive(signal);
    const frame = parseFrame(data);

    if (isErrorFrame(frame)) {
      throw frameToError(frame);
    }

    this._inTransaction = true;
    this._state = 'in_transaction';

    return new Transaction(this);
  }

  /**
   * Commit the current transaction (internal).
   */
  async _commit(signal?: AbortSignal): Promise<void> {
    await this._transport.send(buildCommitMessage(), signal);

    const data = await this._transport.receive(signal);
    const frame = parseFrame(data);

    if (isErrorFrame(frame)) {
      throw frameToError(frame);
    }

    this._inTransaction = false;
    this._state = 'idle';
  }

  /**
   * Rollback the current transaction (internal).
   */
  async _rollback(signal?: AbortSignal): Promise<void> {
    await this._transport.send(buildRollbackMessage(), signal);

    const data = await this._transport.receive(signal);
    const frame = parseFrame(data);

    if (isErrorFrame(frame)) {
      throw frameToError(frame);
    }

    this._inTransaction = false;
    this._state = 'idle';
  }

  /**
   * Create a savepoint (internal).
   */
  async _savepoint(name: string, signal?: AbortSignal): Promise<void> {
    validateSavepointName(name);

    await this._transport.send(buildSavepointMessage(name), signal);

    const data = await this._transport.receive(signal);
    const frame = parseFrame(data);

    if (isErrorFrame(frame)) {
      throw frameToError(frame);
    }
  }

  /**
   * Rollback to a savepoint (internal).
   */
  async _rollbackTo(name: string, signal?: AbortSignal): Promise<void> {
    validateSavepointName(name);

    await this._transport.send(buildRollbackToMessage(name), signal);

    const data = await this._transport.receive(signal);
    const frame = parseFrame(data);

    if (isErrorFrame(frame)) {
      throw frameToError(frame);
    }
  }

  /**
   * Ping the server to check connection health.
   */
  async ping(signal?: AbortSignal): Promise<void> {
    if (this._state === 'closed') {
      throw ErrClosed;
    }

    await this._transport.send(buildPingMessage(), signal);

    const data = await this._transport.receive(signal);
    const frame = parseFrame(data);

    if (isErrorFrame(frame)) {
      throw frameToError(frame);
    }
  }

  /**
   * Reset the connection session.
   */
  async reset(signal?: AbortSignal): Promise<void> {
    if (this._state === 'closed') {
      throw ErrClosed;
    }

    // Rollback any active transaction
    if (this._inTransaction) {
      await this._rollback(signal);
    }

    this._state = 'idle';
    this._activeResult = null;
  }

  /**
   * Close the connection.
   */
  async close(): Promise<void> {
    if (this._state === 'closed') {
      return;
    }

    this._state = 'closed';

    // Close active result
    if (this._activeResult) {
      this._activeResult._close();
      this._activeResult = null;
    }

    await this._transport.close();
  }

  /**
   * Create a prepared statement.
   *
   * @param query - Query text with parameters
   * @returns Prepared statement
   */
  async prepare(query: string): Promise<PreparedStatement> {
    // Dynamic import to avoid circular dependencies
    const { PreparedStatement } = await import('./prepared.js');
    return new PreparedStatement(this, query);
  }

  /**
   * Get the query execution plan without executing.
   *
   * @param query - Query to explain
   * @param options - Options including parameters
   * @returns Query execution plan
   */
  async explain(query: string, options?: ExplainOptions): Promise<QueryPlan> {
    const { explain: doExplain } = await import('./explain.js');
    return doExplain(this, query, options);
  }

  /**
   * Execute a query with profiling.
   *
   * @param query - Query to profile
   * @param options - Options including parameters
   * @returns Query execution profile
   */
  async profile(query: string, options?: ExplainOptions): Promise<QueryProfile> {
    const { profile: doProfile } = await import('./explain.js');
    return doProfile(this, query, options);
  }

  /**
   * Execute multiple queries in a batch.
   *
   * @param queries - Array of queries to execute
   * @param options - Batch execution options
   * @returns Batch execution summary
   */
  async batch(queries: BatchQuery[], options?: BatchOptions): Promise<BatchSummary> {
    const { batch: doBatch } = await import('./batch.js');
    return doBatch(this, queries, options);
  }

  /**
   * Check connection state before operation.
   */
  private checkState(operation: string): void {
    if (this._state === 'closed') {
      throw ErrClosed;
    }

    if (this._state === 'fetching' || this._activeResult) {
      throw ErrQueryInProgress;
    }

    if (operation === 'begin' && this._inTransaction) {
      throw ErrTxInProgress;
    }
  }
}
