/**
 * Geode Connection
 *
 * Connection management and query execution using protobuf wire protocol.
 */

import { withAbortTimeout } from './abort-utils.js';
import type { GeodeConfig } from './config.js';
import { validateConfig } from './config.js';
import {
  DriverError,
  TransportError,
  StatusClass,
  ErrClosed,
  ErrQueryInProgress,
  ErrTxInProgress,
  ErrNoRows,
  type ConnectionState,
} from './errors.js';
import type { Transport } from './transport.js';
import { createTransport } from './transport.js';
import {
  buildHelloRequest,
  buildExecuteRequest,
  buildPullRequest,
  buildPingRequest,
  buildBeginRequest,
  buildCommitRequest,
  buildRollbackRequest,
  buildSavepointRequest,
  buildRollbackToRequest,
  rowToRecord,
  type QuicClientMessage,
  type QuicServerMessage,
  type ExecutionResponse,
  type ColumnDefinition,
  type DataPage,
} from './proto.js';
import {
  validateQuery,
  validateParamValue,
  validateSavepointName,
  validatePageSize,
} from './validate.js';
import { Transaction } from './transaction.js';
import { QueryResult } from './result.js';
import type { PreparedStatement } from './prepared.js';
import type { QueryPlan, QueryProfile, ExplainOptions } from './explain.js';
import type { BatchQuery, BatchSummary, BatchOptions } from './batch.js';
import type { ColumnInfo, GQLType } from './types.js';
import { parseGQLType } from './types.js';

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

/** Convert a protobuf ExecutionResponse error to a DriverError. */
function protoErrorToDriverError(response: ExecutionResponse, statusClass?: string): DriverError {
  const err = response.error;
  return new DriverError({
    statusClass: (statusClass ?? err?.code ?? StatusClass.SYSTEM) as typeof StatusClass.SYSTEM,
    subclass: '000',
    code: err?.code ?? 'UnknownError',
    message: err?.message ?? 'Unknown error',
    anchor: err?.anchor,
    additional: [],
    findings: response.status?.flaggerFindings ?? [],
  });
}

function isErrorResponse(response: ExecutionResponse): boolean {
  return response.error !== undefined;
}

function isSchemaResponse(response: ExecutionResponse): boolean {
  return response.schema !== undefined;
}

function isDataPageResponse(response: ExecutionResponse): boolean {
  return response.page !== undefined;
}

function columnsToColumnInfo(columns: ColumnDefinition[]): ColumnInfo[] {
  return columns.map((col) => ({
    name: col.name,
    type: col.type as GQLType,
    kind: parseGQLType(col.type),
  }));
}

function dataPageToRows(page: DataPage, columns: ColumnDefinition[]): Record<string, unknown>[] {
  return page.rows.map((row) => rowToRecord(row, columns));
}

/**
 * Outcome of the inline read that follows a SCHEMA response.
 *
 * `pending` means the inline deadline expired while the response was still in
 * flight: it has NOT been consumed and the caller must reconcile it before
 * returning (ENG-3916).
 */
type InlineRead =
  | { status: 'received'; response: ExecutionResponse }
  | { status: 'empty' }
  | { status: 'pending' };

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
  private _sessionId = '';
  private _columns: ColumnDefinition[] = [];

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

  /** Get connection configuration. */
  get config(): Readonly<GeodeConfig> {
    return this._config;
  }

  /** Get current connection state. */
  get state(): ConnectionState {
    return this._state;
  }

  /** Check if connection is in a transaction. */
  get inTransaction(): boolean {
    return this._inTransaction;
  }

  /** Check if connection is closed. */
  get isClosed(): boolean {
    return this._state === 'closed' || this._transport.isClosed();
  }

  /** Get session ID. */
  get sessionId(): string {
    return this._sessionId;
  }

  /** Perform the HELLO handshake. */
  private async hello(): Promise<void> {
    const msg = buildHelloRequest(
      this._config.username ?? '',
      this._config.password ?? '',
      this._config.helloName,
      this._config.helloVersion,
      this._config.conformance,
      this._config.tenant, // tenant_id (proto field 3); set only when provided
      this._config.graph,
      this._config.role // FLE role (proto field 8); set only when provided
    );

    await this._sendWithTimeout(msg);
    const response = await this._receiveWithTimeout();

    if (response.hello) {
      if (!response.hello.success) {
        // Check if this is an auth error when no credentials were provided
        const hasCredentials = Boolean(this._config.username) || Boolean(this._config.password);
        if (!hasCredentials && response.hello.errorMessage.includes('Authentication')) {
          // Ignore auth errors when no credentials - server may still accept connection
          this._sessionId = response.hello.sessionId || '';
          return;
        }
        throw new DriverError({
          statusClass: StatusClass.AUTH,
          subclass: '000',
          code: 'AuthenticationFailed',
          message: response.hello.errorMessage || 'Authentication failed',
        });
      }
      this._sessionId = response.hello.sessionId;
    } else {
      throw new TransportError({
        operation: 'hello',
        cause: new Error('Invalid HELLO response'),
      });
    }
  }

  /** Execute a query that returns rows. */
  async query(query: string, options?: QueryOptions): Promise<QueryResult> {
    this.checkState('query');

    validateQuery(query);

    const params = options?.params ?? {};

    // Validate parameters
    for (const [_key, value] of Object.entries(params)) {
      validateParamValue(value);
    }

    const signal = options?.signal;

    // Validate pageSize early before sending anything (CWE-20)
    if (options?.pageSize !== undefined) {
      validatePageSize(options.pageSize);
    }

    try {
      this._state = 'fetching';

      // Send Execute request
      const msg = buildExecuteRequest(this._sessionId, query, params);
      await this._sendWithTimeout(msg, signal);

      // Read response - should be schema or error
      const response = await this._receiveWithTimeout(signal);

      if (!response.execute) {
        throw await this._protocolDesync('query', 'Invalid execute response');
      }

      const execResp = response.execute;

      if (isErrorResponse(execResp)) {
        this._restoreIdleState();
        throw protoErrorToDriverError(execResp, execResp.status?.statusClass);
      }

      if (!isSchemaResponse(execResp)) {
        throw await this._protocolDesync('query', 'Expected schema response');
      }

      this._columns = execResp.schema!.columns;
      const columns = columnsToColumnInfo(this._columns);

      // Check if there's an inline data page
      let initialRows: Record<string, unknown>[] = [];
      let isFinal = false;
      let isOrdered = false;
      let orderKeys: string[] = [];

      // Read the inline response the server sends after SCHEMA
      const inline = await this._readInlineExecute('query', signal);
      if (inline.status === 'received') {
        const inlineExec = inline.response;
        if (isErrorResponse(inlineExec)) {
          this._restoreIdleState();
          throw protoErrorToDriverError(inlineExec, inlineExec.status?.statusClass);
        }
        if (isDataPageResponse(inlineExec)) {
          const page = inlineExec.page!;
          initialRows = dataPageToRows(page, this._columns);
          isFinal = page.final;
          isOrdered = page.ordered;
          orderKeys = page.orderKeys;
        }
      }

      if (!isFinal && initialRows.length === 0) {
        // No inline data (yet) - send PULL request to get the first page.
        const pageSize = options?.pageSize ?? this._config.pageSize;
        validatePageSize(pageSize);
        const pulled = await this._pullFirstPage(
          'query',
          pageSize,
          inline.status === 'pending',
          signal
        );
        initialRows = pulled.rows;
        isFinal = pulled.final;
        isOrdered = pulled.ordered;
        orderKeys = pulled.orderKeys;
      }

      // Create result
      const resultPageSize = options?.pageSize ?? this._config.pageSize;
      validatePageSize(resultPageSize);

      const result = new QueryResult(
        this,
        columns,
        initialRows,
        isFinal,
        isOrdered,
        orderKeys,
        resultPageSize,
        signal
      );

      this._activeResult = result;
      return result;
    } catch (e) {
      this._restoreIdleState();
      throw e;
    }
  }

  /** Execute a query and return all rows as an array. */
  async queryAll(query: string, options?: QueryOptions): Promise<Record<string, unknown>[]> {
    const result = await this.query(query, options);
    // Fast path: collect raw records directly from the buffer
    // without intermediate GQLValue allocation and toJS() conversion.
    // The raw records are already plain JS objects from rowToRecord/protoValueToJS.
    return result._collectRawRecords();
  }

  /**
   * Execute a query and return exactly the first row. Throws ErrNoRows when
   * the result set is empty, mirroring database/sql's ErrNoRows.
   */
  async queryRow(query: string, options?: QueryOptions): Promise<Record<string, unknown>> {
    const rows = await this.queryAll(query, options);
    const first = rows[0];
    if (first === undefined) {
      throw ErrNoRows();
    }
    return first;
  }

  /** Execute a query that doesn't return rows. */
  async exec(query: string, options?: QueryOptions): Promise<void> {
    this.checkState('exec');

    validateQuery(query);

    const params = options?.params ?? {};

    // Validate parameters
    for (const [_key, value] of Object.entries(params)) {
      validateParamValue(value);
    }

    const signal = options?.signal;

    try {
      this._state = 'executing';

      // Send Execute request
      const msg = buildExecuteRequest(this._sessionId, query, params);
      await this._sendWithTimeout(msg, signal);

      // Read response
      const response = await this._receiveWithTimeout(signal);

      if (!response.execute) {
        throw await this._protocolDesync('exec', 'Invalid execute response');
      }

      const execResp = response.execute;

      if (isErrorResponse(execResp)) {
        throw protoErrorToDriverError(execResp, execResp.status?.statusClass);
      }

      // If there's a schema, drain any data pages
      if (isSchemaResponse(execResp)) {
        this._columns = execResp.schema!.columns;
        const inline = await this._readInlineExecute('exec', signal);
        if (inline.status === 'pending') {
          // The inline page is still in flight: reconcile it (and the PULL
          // that reconciliation sends) before returning, otherwise the next
          // request on this connection reads it (ENG-3916).
          const pulled = await this._pullFirstPage('exec', this._config.pageSize, true, signal);
          if (!pulled.final) {
            await this._drainRemainingPages(signal);
          }
        } else if (inline.status === 'received') {
          const inlineExec = inline.response;
          if (isErrorResponse(inlineExec)) {
            throw protoErrorToDriverError(inlineExec, inlineExec.status?.statusClass);
          }
          // QUAL-T7: Drain remaining pages if the inline response is not final
          if (isDataPageResponse(inlineExec) && !inlineExec.page!.final) {
            await this._drainRemainingPages(signal);
          }
        }
      }
    } finally {
      this._restoreIdleState();
    }
  }

  /** @internal Fetch the next page of results. Called by QueryResult. */
  async _fetchNextPage(
    pageSize: number,
    signal?: AbortSignal
  ): Promise<{
    rows: Record<string, unknown>[];
    final: boolean;
  }> {
    validatePageSize(pageSize);
    this._requestId++;
    const pullMsg = buildPullRequest(this._requestId, pageSize, this._sessionId);
    await this._sendWithTimeout(pullMsg, signal);

    while (true) {
      const response = await this._receiveWithTimeout(signal);

      // Server sends pull data in pull.response, not execute
      const execResp = response.pull?.response ?? response.execute;

      if (!execResp) {
        throw await this._protocolDesync('fetch_next_page', 'Invalid pull response');
      }

      if (isErrorResponse(execResp)) {
        throw protoErrorToDriverError(execResp, execResp.status?.statusClass);
      }

      if (isDataPageResponse(execResp)) {
        const page = execResp.page!;
        return {
          rows: dataPageToRows(page, this._columns),
          final: page.final,
        };
      }

      if (execResp.heartbeat) {
        return { rows: [], final: true };
      }
    }
  }

  /**
   * Wait for the response the server sends after SCHEMA.
   *
   * Returns `null` when the inline deadline (`inlineTimeout`) expires. That
   * response is then STILL in flight - the caller must reconcile it before
   * returning, because the transport is a FIFO stream without request/response
   * correlation and anything left behind is read by the next request
   * (ENG-3916).
   */
  private async _tryReceiveInline(signal?: AbortSignal): Promise<QuicServerMessage | null> {
    const inlineTimeoutMs = this._config.inlineTimeout ?? 5000;
    const { signal: timeoutSignal, cleanup } = withAbortTimeout(signal, inlineTimeoutMs);

    try {
      return await this._transport.receiveProto(timeoutSignal);
    } catch (err) {
      const aborted = err instanceof TransportError && err.cause?.message === 'Aborted';
      if (aborted && !signal?.aborted) {
        // Only the inline deadline fired; the caller's own abort propagates.
        return null;
      }
      await this._closeOnTransportError(err);
      throw err;
    } finally {
      cleanup();
    }
  }

  /** Read inline execute responses until a page, error, heartbeat, or the inline deadline. */
  private async _readInlineExecute(operation: string, signal?: AbortSignal): Promise<InlineRead> {
    while (true) {
      const inlineResponse = await this._tryReceiveInline(signal);
      if (!inlineResponse) {
        return { status: 'pending' };
      }
      const inlineExec = inlineResponse.execute;
      if (!inlineExec) {
        // Anything other than an execute response here means the stream is
        // out of phase with the request that is being served.
        throw await this._protocolDesync(operation, 'Invalid inline response');
      }
      if (isErrorResponse(inlineExec) || isDataPageResponse(inlineExec)) {
        return { status: 'received', response: inlineExec };
      }
      if (inlineExec.heartbeat) {
        return { status: 'empty' };
      }
    }
  }

  /**
   * Send a PULL and consume responses until every outstanding response has
   * been accounted for.
   *
   * The wire protocol is a FIFO stream with no request/response correlation
   * id, so the client must reconcile the whole exchange before it returns:
   * a response left in the transport is read by the NEXT request, which then
   * sees this query's schema and rows (ENG-3916). Up to two responses can be
   * outstanding here:
   *
   *  - the inline page the server sends after SCHEMA, when the inline read
   *    gave up waiting for it (`inlinePending`), and
   *  - the answer to the PULL sent below, which QUIC servers always send as a
   *    `pull`-wrapped message.
   *
   * Because the server writes its responses in order, a `pull`-wrapped answer
   * also proves that nothing is still coming for the EXECUTE, which is what
   * makes the reconciliation exact.
   *
   * When the exchange cannot be reconciled - a timeout, an abort or a
   * transport failure while a response is still owed - the connection is
   * closed instead of returned to the caller (and to the pool).
   *
   * NOTE (server team, ENG-3916): the durable fix is a request/response
   * correlation id in the proto. Until the wire protocol carries one, the
   * client can only reconcile by message type plus stream ordering.
   */
  private async _pullFirstPage(
    operation: string,
    pageSize: number,
    inlinePending: boolean,
    signal?: AbortSignal
  ): Promise<{
    rows: Record<string, unknown>[];
    final: boolean;
    ordered: boolean;
    orderKeys: string[];
  }> {
    let inlineOutstanding = inlinePending;
    let ackOutstanding = this._pullIsAcknowledged;

    let rows: Record<string, unknown>[] = [];
    let final = false;
    let ordered = false;
    let orderKeys: string[] = [];
    let gotPage = false;
    let deferredError: DriverError | null = null;

    try {
      this._requestId++;
      const pullMsg = buildPullRequest(this._requestId, pageSize, this._sessionId);
      await this._sendWithTimeout(pullMsg, signal);

      for (;;) {
        const response = await this._receiveWithTimeout(signal);
        const isPullAck = response.pull !== undefined;
        const pullExec = response.pull?.response ?? response.execute;

        if (!pullExec) {
          throw await this._protocolDesync(operation, 'Invalid pull response');
        }

        if (isPullAck) {
          inlineOutstanding = false;
          ackOutstanding = false;
        } else if (inlineOutstanding) {
          inlineOutstanding = false;
        } else {
          // Servers that answer a PULL with a bare execute response.
          ackOutstanding = false;
        }

        if (isErrorResponse(pullExec)) {
          // Only surfaced when no page arrives at all: a result that was fully
          // delivered inline makes the server answer the trailing PULL with
          // "no active result set", which must not fail the query.
          deferredError ??= protoErrorToDriverError(pullExec, pullExec.status?.statusClass);
        } else if (isDataPageResponse(pullExec)) {
          const page = pullExec.page!;
          const pageRows = dataPageToRows(page, this._columns);
          if (gotPage) {
            rows = rows.concat(pageRows);
          } else {
            rows = pageRows;
            ordered = page.ordered;
            orderKeys = page.orderKeys;
            gotPage = true;
          }
          final = final || page.final;
        }

        if (!inlineOutstanding && !ackOutstanding) {
          break;
        }
      }
    } catch (e) {
      if (inlineOutstanding || ackOutstanding) {
        // Responses are still owed and cannot be matched to a request: the
        // connection would hand them to whoever uses it next (ENG-3916).
        await this._forceClose();
      }
      throw e;
    }

    if (deferredError && !gotPage) {
      this._restoreIdleState();
      throw deferredError;
    }

    return { rows, final, ordered, orderKeys };
  }

  /** Drain remaining data pages until final=true to prevent query corruption (QUAL-T7). */
  private async _drainRemainingPages(signal?: AbortSignal): Promise<void> {
    let done = false;
    while (!done) {
      this._requestId++;
      const pageSize = this._config.pageSize;
      const pullMsg = buildPullRequest(this._requestId, pageSize, this._sessionId);
      await this._sendWithTimeout(pullMsg, signal);

      const response = await this._receiveWithTimeout(signal);
      const pullExec = response.pull?.response ?? response.execute;

      if (!pullExec) {
        throw await this._protocolDesync('exec', 'Invalid pull response');
      }

      if (isErrorResponse(pullExec)) {
        throw protoErrorToDriverError(pullExec, pullExec.status?.statusClass);
      }

      if (isDataPageResponse(pullExec)) {
        done = pullExec.page!.final;
      } else if (pullExec.heartbeat) {
        done = true;
      }
    }
  }

  /** @internal Release the active result, returning the connection to idle. */
  _releaseResult(result: QueryResult): void {
    if (this._activeResult === result) {
      this._activeResult = null;
      this._state = this._inTransaction ? 'in_transaction' : 'idle';
    }
  }

  /** Begin a transaction. */
  async begin(signal?: AbortSignal): Promise<Transaction> {
    this.checkState('begin');

    if (this._inTransaction) {
      throw ErrTxInProgress();
    }

    const msg = buildBeginRequest(false, this._sessionId);
    await this._sendWithTimeout(msg, signal);

    const response = await this._receiveWithTimeout(signal);

    if (response.begin) {
      if (response.begin.sessionId) {
        this._sessionId = response.begin.sessionId;
      }
    } else {
      throw new TransportError({
        operation: 'begin',
        cause: new Error('Invalid BEGIN response'),
      });
    }

    this._inTransaction = true;
    this._state = 'in_transaction';

    return new Transaction(this);
  }

  /** @internal Commit the current transaction. Called by Transaction. */
  async _commit(signal?: AbortSignal): Promise<void> {
    const msg = buildCommitRequest(this._sessionId);
    await this._sendWithTimeout(msg, signal);

    const response = await this._receiveWithTimeout(signal);

    if (!response.commit) {
      throw new TransportError({
        operation: 'commit',
        cause: new Error('Invalid COMMIT response'),
      });
    }

    if (!response.commit.success) {
      throw new DriverError({
        statusClass: StatusClass.TRANSACTION_STATE,
        subclass: '000',
        code: 'CommitFailed',
        message: 'Commit failed',
      });
    }

    this._inTransaction = false;
    this._state = 'idle';
  }

  /** @internal Rollback the current transaction. Called by Transaction. */
  async _rollback(signal?: AbortSignal): Promise<void> {
    const msg = buildRollbackRequest(this._sessionId);
    await this._sendWithTimeout(msg, signal);

    const response = await this._receiveWithTimeout(signal);

    if (!response.rollback) {
      throw new TransportError({
        operation: 'rollback',
        cause: new Error('Invalid ROLLBACK response'),
      });
    }

    this._inTransaction = false;
    this._state = 'idle';
  }

  /** @internal Create a named savepoint. Called by Transaction. */
  async _savepoint(name: string, signal?: AbortSignal): Promise<void> {
    validateSavepointName(name);

    const msg = buildSavepointRequest(name, this._sessionId);
    await this._sendWithTimeout(msg, signal);

    const response = await this._receiveWithTimeout(signal);

    if (!response.savepoint) {
      throw new TransportError({
        operation: 'savepoint',
        cause: new Error('Invalid SAVEPOINT response'),
      });
    }

    if (!response.savepoint.success) {
      throw new DriverError({
        statusClass: StatusClass.TRANSACTION_STATE,
        subclass: '000',
        code: 'SavepointFailed',
        message: `Failed to create savepoint: ${name}`,
      });
    }
  }

  /** @internal Rollback to a previously created savepoint. Called by Transaction. */
  async _rollbackTo(name: string, signal?: AbortSignal): Promise<void> {
    validateSavepointName(name);

    const msg = buildRollbackToRequest(name, this._sessionId);
    await this._sendWithTimeout(msg, signal);

    const response = await this._receiveWithTimeout(signal);

    if (!response.rollbackTo) {
      throw new TransportError({
        operation: 'rollback_to',
        cause: new Error('Invalid ROLLBACK TO response'),
      });
    }

    if (!response.rollbackTo.success) {
      throw new DriverError({
        statusClass: StatusClass.TRANSACTION_STATE,
        subclass: '000',
        code: 'RollbackToFailed',
        message: `Failed to rollback to savepoint: ${name}`,
      });
    }
  }

  /** Ping the server to check connection health. */
  async ping(signal?: AbortSignal): Promise<void> {
    if (this._state === 'closed') {
      throw ErrClosed();
    }

    const msg = buildPingRequest();
    await this._sendWithTimeout(msg, signal);

    const response = await this._receiveWithTimeout(signal);

    if (!response.ping) {
      throw new TransportError({
        operation: 'ping',
        cause: new Error('Invalid PING response'),
      });
    }

    if (!response.ping.ok) {
      throw new TransportError({
        operation: 'ping',
        cause: new Error('Server returned not ok'),
      });
    }
  }

  /** Reset the connection session. */
  async reset(signal?: AbortSignal): Promise<void> {
    if (this._state === 'closed') {
      throw ErrClosed();
    }

    // Rollback any active transaction
    if (this._inTransaction) {
      await this._rollback(signal);
    }

    this._state = 'idle';
    this._activeResult = null;
  }

  /** Close the connection. */
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

  /** Create a prepared statement. */
  async prepare(query: string): Promise<PreparedStatement> {
    const { PreparedStatement } = await import('./prepared.js');
    return new PreparedStatement(this, query);
  }

  /** Get the query execution plan without executing. */
  async explain(query: string, options?: ExplainOptions): Promise<QueryPlan> {
    const { explain: doExplain } = await import('./explain.js');
    return doExplain(this, query, options);
  }

  /** Execute a query with profiling. */
  async profile(query: string, options?: ExplainOptions): Promise<QueryProfile> {
    const { profile: doProfile } = await import('./explain.js');
    return doProfile(this, query, options);
  }

  /** Execute multiple queries in a batch. */
  async batch(queries: BatchQuery[], options?: BatchOptions): Promise<BatchSummary> {
    const { batch: doBatch } = await import('./batch.js');
    return doBatch(this, queries, options);
  }

  /** Check connection state before operation. */
  private checkState(operation: string): void {
    if (this._state === 'closed') {
      throw ErrClosed();
    }

    if (this._state === 'fetching' || this._activeResult) {
      throw ErrQueryInProgress();
    }

    if (operation === 'begin' && this._inTransaction) {
      throw ErrTxInProgress();
    }
  }

  /** Send a protobuf message with request timeout enforcement. */
  private async _sendWithTimeout(msg: QuicClientMessage, signal?: AbortSignal): Promise<void> {
    const { signal: timeoutSignal, cleanup } = this._withRequestTimeout(signal);
    try {
      await this._transport.sendProto(msg, timeoutSignal);
    } catch (e) {
      await this._closeOnTransportError(e);
      throw e;
    } finally {
      cleanup();
    }
  }

  /** Receive a protobuf message with request timeout enforcement. */
  private async _receiveWithTimeout(signal?: AbortSignal): Promise<QuicServerMessage> {
    const { signal: timeoutSignal, cleanup } = this._withRequestTimeout(signal);
    try {
      return await this._transport.receiveProto(timeoutSignal);
    } catch (e) {
      await this._closeOnTransportError(e);
      throw e;
    } finally {
      cleanup();
    }
  }

  /** Create a combined abort signal from requestTimeout and optional caller signal (CWE-703). */
  private _withRequestTimeout(signal?: AbortSignal): { signal?: AbortSignal; cleanup: () => void } {
    return withAbortTimeout(signal, this._config.requestTimeout);
  }

  private async _closeOnTransportError(err: unknown): Promise<void> {
    if (!(err instanceof TransportError) || err.cause?.message === 'Aborted') {
      return;
    }

    await this._forceClose();
  }

  /**
   * Whether the server answers every PULL with its own message.
   *
   * QUIC servers reply to a PULL with a `pull`-wrapped response, so that
   * response has to be consumed before the connection is back in phase. The
   * gRPC transport has no PULL RPC: it serves PULLs from the Execute stream
   * that is already open, so no extra message is produced.
   */
  private get _pullIsAcknowledged(): boolean {
    return this._config.transport !== 'grpc';
  }

  /**
   * Tear the connection down after a protocol desync and build the error.
   *
   * The stream carries no correlation ids, so a message that cannot belong to
   * the request being served means client and server are out of phase: every
   * later response would answer an earlier request, silently handing one
   * caller another caller's rows. Failing closed makes the connection
   * unusable, and the pool drops closed connections instead of reusing them.
   */
  private async _protocolDesync(operation: string, detail: string): Promise<TransportError> {
    await this._forceClose();
    return new TransportError({ operation, cause: new Error(detail) });
  }

  /** Close the transport and drop any active result, ignoring teardown errors. */
  private async _forceClose(): Promise<void> {
    if (this._state === 'closed') {
      return;
    }

    this._state = 'closed';
    this._inTransaction = false;

    if (this._activeResult) {
      this._activeResult._close();
      this._activeResult = null;
    }

    try {
      await this._transport.close();
    } catch {
      // Ignore close errors while tearing down a broken transport.
    }
  }

  /** Return to the resting state, unless the connection was torn down. */
  private _restoreIdleState(): void {
    if (this._state === 'closed') {
      return;
    }

    this._state = this._inTransaction ? 'in_transaction' : 'idle';
  }
}
