/**
 * Geode Connection
 *
 * Connection management and query execution using protobuf wire protocol.
 */

import { withAbortTimeout, type AbortHandle } from './abort-utils.js';
import type { GeodeConfig } from './config.js';
import { validateConfig } from './config.js';
import {
  DriverError,
  TransportError,
  StatusClass,
  ErrClosed,
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
 * How the server delivers the pages that follow the first one.
 *
 * `push`  the server streams every page as an `execute` response until
 *         `final = true` and expects NO PULL (the normal path,
 *         `quic_connection_handler.zig:7544-7566`).
 * `pull`  the server parked the result and answers one page per PULL (the
 *         node-scan stream path with inline results disabled).
 */
type PageDelivery = 'push' | 'pull';

/**
 * Upper bound on the pages drained from an abandoned result. Draining keeps the
 * connection in phase, but an unbounded drain would let a huge result set stall
 * a caller that already walked away, so past this point the connection is torn
 * down instead (CWE-400).
 */
const MAX_DRAIN_PAGES = 4096;

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
  private _delivery: PageDelivery = 'push';

  /**
   * FIFO exchange lock.
   *
   * The connection owns ONE bidirectional stream and the wire protocol carries
   * no request/response correlation id, so two overlapping exchanges would read
   * each other's answers. Callers therefore queue instead of racing: an
   * exchange holds the lock for its FULL request -> final-response round trip,
   * and a streaming QueryResult keeps holding it until it is closed or drained
   * (ENG-3916).
   */
  private _exchangeHeld = false;
  private _exchangeWaiters: Array<() => void> = [];
  /** Lock release handed to the active streaming result, if any. */
  private _activeRelease: (() => void) | null = null;

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

  /**
   * Take the exchange lock, returning its (idempotent) release function.
   *
   * Registration is synchronous, so waiters are served strictly in call order.
   */
  private acquireExchange(): Promise<() => void> {
    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      const next = this._exchangeWaiters.shift();
      if (next) {
        next();
        return;
      }
      this._exchangeHeld = false;
    };

    if (!this._exchangeHeld) {
      this._exchangeHeld = true;
      return Promise.resolve(release);
    }

    return new Promise<() => void>((resolve) => {
      this._exchangeWaiters.push(() => resolve(release));
    });
  }

  /** Run one complete exchange under the connection's exchange lock. */
  private async withExchange<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquireExchange();
    try {
      if (this._state === 'closed') {
        throw ErrClosed();
      }
      return await fn();
    } finally {
      release();
    }
  }

  /** Wake every queued exchange so it can observe the closed state. */
  private drainExchangeWaiters(): void {
    const waiters = this._exchangeWaiters;
    this._exchangeWaiters = [];
    this._exchangeHeld = false;
    this._activeRelease = null;
    for (const wake of waiters) {
      wake();
    }
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

    const resultPageSize = options?.pageSize ?? this._config.pageSize;
    validatePageSize(resultPageSize);

    const release = await this.acquireExchange();
    let handedOver = false;

    try {
      if (this._state === 'closed') {
        throw ErrClosed();
      }

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
      let gotPushedPage = false;

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
          gotPushedPage = true;
        }
      }

      if (gotPushedPage) {
        // The server pushed a page, so it pushes the REST of them too, until
        // final = true. Sending a PULL here would orphan every remaining
        // pushed page on a stream with no correlation ids (ENG-3916).
        this._delivery = 'push';
      } else {
        // Nothing was pushed: the server parked the result awaiting a PULL
        // (node-scan stream / inline results disabled).
        this._delivery = 'pull';
        const pulled = await this._pullFirstPage(
          'query',
          resultPageSize,
          inline.status === 'pending',
          signal
        );
        initialRows = pulled.rows;
        isFinal = pulled.final;
        isOrdered = pulled.ordered;
        orderKeys = pulled.orderKeys;
      }

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

      if (!isFinal) {
        // The server still owes pages: the result keeps the exchange lock so
        // nothing else can read them off the stream (ENG-3916 RC-1/RC-5).
        this._activeRelease = release;
        handedOver = true;
      }

      return result;
    } catch (e) {
      this._restoreIdleState();
      throw e;
    } finally {
      if (!handedOver) {
        release();
      }
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

    return this.withExchange(async () => {
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
            this._delivery = 'pull';
            const pulled = await this._pullFirstPage('exec', this._config.pageSize, true, signal);
            if (!pulled.final) {
              await this._drainRemainingPages(signal);
            }
          } else if (inline.status === 'received') {
            const inlineExec = inline.response;
            if (isErrorResponse(inlineExec)) {
              throw protoErrorToDriverError(inlineExec, inlineExec.status?.statusClass);
            }
            // QUAL-T7: the server pushes the remaining pages; read them all so
            // the connection is back in phase before exec() returns.
            if (isDataPageResponse(inlineExec) && !inlineExec.page!.final) {
              this._delivery = 'push';
              await this._drainRemainingPages(signal);
            }
          }
        }
      } finally {
        this._restoreIdleState();
      }
    });
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

    // The server PUSHES every page of a result it started delivering inline
    // (`quic_connection_handler.zig:7544-7566`) and expects no PULL. Sending
    // one anyway orphans the pushed pages AND the PULL's own reply on a stream
    // with no correlation ids, which desyncs the connection for good
    // (ENG-3916 / ENG-3918).
    if (this._delivery === 'push') {
      return this._readNextPage('fetch_next_page', signal);
    }

    this._requestId++;
    const pullMsg = buildPullRequest(this._requestId, pageSize, this._sessionId);
    await this._sendWithTimeout(pullMsg, signal);

    return this._readNextPage('fetch_next_page', signal);
  }

  /**
   * Read the next page off the stream.
   *
   * Accepts either envelope: the server pushes pages as `execute` responses and
   * wraps a PULL's answer in `pull`. Anything else means the stream is out of
   * phase with the request being served, so the connection fails closed instead
   * of silently swallowing the message.
   */
  private async _readNextPage(
    operation: string,
    signal?: AbortSignal
  ): Promise<{
    rows: Record<string, unknown>[];
    final: boolean;
  }> {
    for (;;) {
      const response = await this._receiveWithTimeout(signal);
      const execResp = response.pull?.response ?? response.execute;

      if (!execResp) {
        throw await this._protocolDesync(operation, 'Invalid page response');
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

      if (isSchemaResponse(execResp)) {
        // A schema belongs to a DIFFERENT statement: reading on would hand
        // this caller another query's rows.
        throw await this._protocolDesync(operation, 'Unexpected schema response');
      }

      if (!execResp.metrics && !execResp.explain && !execResp.profile) {
        // Status-only response: the server's terminal acknowledgement for a
        // statement that produces no further rows (mirrors the reference client,
        // `src/client/quic_query_runner.zig:216-233`).
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

  /**
   * Drain remaining data pages until final=true to prevent query corruption
   * (QUAL-T7). Honours the current delivery mode: pushed pages are read,
   * parked results are pulled one page at a time.
   */
  private async _drainRemainingPages(signal?: AbortSignal): Promise<void> {
    for (let page = 0; page < MAX_DRAIN_PAGES; page++) {
      const { final } = await this._fetchNextPage(this._config.pageSize, signal);
      if (final) {
        return;
      }
    }

    throw await this._protocolDesync('drain', 'Result exceeded the drain page limit');
  }

  /**
   * @internal Release the active result, returning the connection to idle.
   *
   * A result abandoned before `final = true` leaves pages the server still owes
   * on the stream. They are drained here - under the exchange lock the result
   * still holds - so the next caller cannot read them as its own (ENG-3916).
   * The returned promise settles once the connection is back in phase.
   */
  _releaseResult(result: QueryResult, final: boolean): Promise<void> {
    if (this._activeResult !== result) {
      return Promise.resolve();
    }

    this._activeResult = null;
    const release = this._activeRelease;
    this._activeRelease = null;
    this._restoreIdleState();

    if (!release) {
      return Promise.resolve();
    }

    if (final || this._state === 'closed') {
      release();
      return Promise.resolve();
    }

    return this._drainRemainingPages()
      .catch(async (e: unknown) => {
        // The stream could not be brought back in phase: a connection that
        // still owes responses must never be reused (or pooled).
        await this._forceClose();
        void e;
      })
      .finally(() => {
        release();
      });
  }

  /** Begin a transaction. */
  async begin(signal?: AbortSignal): Promise<Transaction> {
    this.checkState('begin');

    if (this._inTransaction) {
      throw ErrTxInProgress();
    }

    return this.withExchange(async () => {
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
    });
  }

  /** @internal Commit the current transaction. Called by Transaction. */
  async _commit(signal?: AbortSignal): Promise<void> {
    return this.withExchange(async () => {
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
    });
  }

  /** @internal Rollback the current transaction. Called by Transaction. */
  async _rollback(signal?: AbortSignal): Promise<void> {
    return this.withExchange(() => this._rollbackExchange(signal));
  }

  /** Send ROLLBACK and consume its answer. The exchange lock must be held. */
  private async _rollbackExchange(signal?: AbortSignal): Promise<void> {
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

    return this.withExchange(async () => {
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
    });
  }

  /** @internal Rollback to a previously created savepoint. Called by Transaction. */
  async _rollbackTo(name: string, signal?: AbortSignal): Promise<void> {
    validateSavepointName(name);

    return this.withExchange(async () => {
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
    });
  }

  /** Ping the server to check connection health. */
  async ping(signal?: AbortSignal): Promise<void> {
    if (this._state === 'closed') {
      throw ErrClosed();
    }

    return this.withExchange(async () => {
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
    });
  }

  /** Reset the connection session. */
  async reset(signal?: AbortSignal): Promise<void> {
    if (this._state === 'closed') {
      throw ErrClosed();
    }

    // Take over the exchange lock an unfinished streaming result is holding:
    // its outstanding pages must be drained before the connection is reused.
    const retained = this._activeRelease;
    this._activeRelease = null;
    if (this._activeResult) {
      this._activeResult._close();
      this._activeResult = null;
    }

    const release = retained ?? (await this.acquireExchange());
    try {
      if (this.isClosed) {
        throw ErrClosed();
      }
      if (retained) {
        await this._drainRemainingPages(signal);
      }
      if (this._inTransaction) {
        await this._rollbackExchange(signal);
      }
      this._state = 'idle';
    } catch (e) {
      await this._forceClose();
      throw e;
    } finally {
      release();
    }
  }

  /** Close the connection. */
  async close(): Promise<void> {
    if (this._state === 'closed') {
      return;
    }

    this._state = 'closed';
    this._abandonActiveResult();
    this.drainExchangeWaiters();

    await this._transport.close();
  }

  /** Drop the active result and hand its exchange lock back. */
  private _abandonActiveResult(): void {
    if (this._activeResult) {
      this._activeResult._close();
      this._activeResult = null;
    }
    const release = this._activeRelease;
    this._activeRelease = null;
    if (release) {
      release();
    }
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

  /**
   * Check connection state before operation.
   *
   * Concurrent requests are NOT rejected any more: they queue on the exchange
   * lock (ENG-3916). Only genuinely illegal states fail fast here.
   */
  private checkState(operation: string): void {
    if (this._state === 'closed') {
      throw ErrClosed();
    }

    if (operation === 'begin' && this._inTransaction) {
      throw ErrTxInProgress();
    }
  }

  /** Send a protobuf message with request timeout enforcement. */
  private async _sendWithTimeout(msg: QuicClientMessage, signal?: AbortSignal): Promise<void> {
    const handle = this._withRequestTimeout(signal);
    try {
      await this._transport.sendProto(msg, handle.signal);
    } catch (e) {
      await this._closeOnTransportError(e, handle.timedOut());
      throw e;
    } finally {
      handle.cleanup();
    }
  }

  /** Receive a protobuf message with request timeout enforcement. */
  private async _receiveWithTimeout(signal?: AbortSignal): Promise<QuicServerMessage> {
    const handle = this._withRequestTimeout(signal);
    try {
      return await this._transport.receiveProto(handle.signal);
    } catch (e) {
      // A failed receive always leaves a response owed on a stream that carries
      // no correlation ids, so the connection is unusable either way: a
      // deadline abort is just as poisonous as a transport fault (ENG-3918).
      await this._closeOnTransportError(e, true);
      throw e;
    } finally {
      handle.cleanup();
    }
  }

  /** Create a combined abort signal from requestTimeout and optional caller signal (CWE-703). */
  private _withRequestTimeout(signal?: AbortSignal): AbortHandle {
    return withAbortTimeout(signal, this._config.requestTimeout);
  }

  /**
   * Tear the connection down after a transport failure.
   *
   * `responseOwed` marks the cases where the server may still answer: a request
   * deadline that elapsed, or any aborted receive. Those leave the stream out
   * of phase, so the connection must not be reused (or returned to the pool)
   * even though the underlying socket is still open (ENG-3918).
   */
  private async _closeOnTransportError(err: unknown, responseOwed = false): Promise<void> {
    if (!(err instanceof TransportError)) {
      return;
    }

    if (err.cause?.message === 'Aborted' && !responseOwed) {
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

    this._abandonActiveResult();
    this.drainExchangeWaiters();

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
