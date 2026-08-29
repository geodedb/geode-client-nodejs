/**
 * ENG-3916: inline/PULL desync regression tests.
 *
 * The QUIC wire protocol is a FIFO stream without request/response
 * correlation. When the client abandons the in-flight inline exchange (the
 * page the server always sends after SCHEMA) and speculatively sends a PULL,
 * the late inline page is consumed as the PULL answer and the real
 * PullResponse stays queued in the transport. The connection is then one
 * message out of phase forever: the next query fails with
 * "Invalid execute response" and every query after that silently receives the
 * PREVIOUS query's schema and rows -- cross-query data leakage, made worse by
 * the fact that such a poisoned connection is returned to the pool.
 *
 * These tests drive a scripted fake transport that reproduces the real server
 * ordering: EXECUTE is answered with SCHEMA followed by the first data page
 * (optionally delayed), and every PULL is answered with its own
 * `pull`-wrapped response.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Connection } from '../../src/connection.js';
import { MockTransport } from '../../src/transport.js';
import type { Transport } from '../../src/transport.js';
import { ConnectionPool } from '../../src/pool.js';
import { TransportError } from '../../src/errors.js';
import type { GeodeConfig, PoolConfig } from '../../src/config.js';
import type { QuicClientMessage, QuicServerMessage } from '../../src/proto.js';
import { ScriptedGeodeServer, scriptedConfig } from './helpers/scripted-server.js';

vi.mock('../../src/transport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/transport.js')>();
  return { ...actual, createTransport: vi.fn() };
});

const { createTransport } = await import('../../src/transport.js');

/** A single scripted query answer. */
interface QueryScript {
  /** Column name the query returns. */
  column: string;
  /** Single string value the single row carries. */
  value: string;
  /** Delay before the data page is emitted, in milliseconds. */
  pageDelayMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fake transport that mimics the Geode QUIC server:
 *  - HELLO is answered immediately.
 *  - EXECUTE is answered with SCHEMA, then (after `pageDelayMs`) a final page.
 *  - PULL is always answered with a `pull`-wrapped response. Because the
 *    result was already delivered inline the answer is an empty final page.
 * Emissions are strictly ordered, exactly like a single server stream.
 */
class ScriptedServerTransport implements Transport {
  readonly sent: QuicClientMessage[] = [];

  private _scripts: QueryScript[];
  private _queue: QuicServerMessage[] = [];
  private _readers: Array<{
    resolve: (msg: QuicServerMessage) => void;
    reject: (err: Error) => void;
  }> = [];
  private _closed = false;
  private _chain: Promise<void> = Promise.resolve();

  constructor(scripts: QueryScript[]) {
    this._scripts = [...scripts];
  }

  async sendProto(msg: QuicClientMessage, signal?: AbortSignal): Promise<void> {
    if (this._closed) {
      throw new TransportError({ operation: 'sendProto', cause: new Error('Transport closed') });
    }
    if (signal?.aborted) {
      throw new TransportError({ operation: 'sendProto', cause: new Error('Aborted') });
    }

    this.sent.push(msg);

    if (msg.hello) {
      this._emit(0, {
        hello: {
          success: true,
          sessionId: 'scripted-session',
          errorMessage: '',
          capabilities: [],
        },
      });
      return;
    }

    if (msg.execute) {
      const script = this._scripts.shift();
      if (!script) {
        throw new TransportError({
          operation: 'sendProto',
          cause: new Error('scripted transport ran out of query scripts'),
        });
      }
      this._emit(0, {
        execute: { schema: { columns: [{ name: script.column, type: 'STRING' }] } },
      });
      this._emit(script.pageDelayMs ?? 0, {
        execute: {
          page: {
            rows: [{ values: [{ stringVal: { value: script.value, kind: 1 } }] }],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });
      return;
    }

    if (msg.pull) {
      // The result was fully delivered inline, so the server answers the PULL
      // with its own (empty, final) pull-wrapped page.
      this._emit(0, {
        pull: { response: { page: { rows: [], final: true, ordered: false, orderKeys: [] } } },
      });
      return;
    }

    throw new TransportError({
      operation: 'sendProto',
      cause: new Error('scripted transport received an unsupported message'),
    });
  }

  async receiveProto(signal?: AbortSignal): Promise<QuicServerMessage> {
    if (this._closed) {
      throw new TransportError({ operation: 'receiveProto', cause: new Error('Transport closed') });
    }
    if (signal?.aborted) {
      throw new TransportError({ operation: 'receiveProto', cause: new Error('Aborted') });
    }

    const queued = this._queue.shift();
    if (queued) {
      return queued;
    }

    return new Promise<QuicServerMessage>((resolve, reject) => {
      let onAbort: (() => void) | null = null;
      const reader = {
        resolve: (msg: QuicServerMessage) => {
          if (onAbort && signal) signal.removeEventListener('abort', onAbort);
          resolve(msg);
        },
        reject: (err: Error) => {
          if (onAbort && signal) signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      };
      this._readers.push(reader);

      if (signal) {
        onAbort = () => {
          const idx = this._readers.indexOf(reader);
          if (idx !== -1) this._readers.splice(idx, 1);
          reject(new TransportError({ operation: 'receiveProto', cause: new Error('Aborted') }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async close(): Promise<void> {
    this._closed = true;
    const readers = this._readers;
    this._readers = [];
    for (const r of readers) {
      r.reject(
        new TransportError({ operation: 'receiveProto', cause: new Error('Transport closed') })
      );
    }
  }

  isClosed(): boolean {
    return this._closed;
  }

  getAddress(): string {
    return 'scripted:3141';
  }

  /** Queue a server emission, preserving strict stream ordering. */
  private _emit(delayMs: number, msg: QuicServerMessage): void {
    this._chain = this._chain.then(async () => {
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      if (this._closed) {
        return;
      }
      const reader = this._readers.shift();
      if (reader) {
        reader.resolve(msg);
      } else {
        this._queue.push(msg);
      }
    });
  }
}

const baseConfig = (overrides: Partial<GeodeConfig> = {}): GeodeConfig => ({
  host: 'localhost',
  port: 3141,
  pageSize: 100,
  transport: 'quic',
  helloName: 'test',
  helloVersion: '1.0.0',
  conformance: 'min',
  requestTimeout: 2000,
  ...overrides,
});

/** Column names of the first row of a result set. */
const columnsOf = (rows: Record<string, unknown>[]): string[] => Object.keys(rows[0] ?? {});

describe('ENG-3916: inline page / PULL desync', () => {
  let connection: Connection | null = null;
  let pool: ConnectionPool | null = null;

  afterEach(async () => {
    if (connection) {
      await connection.close();
      connection = null;
    }
    if (pool) {
      await pool.close();
      pool = null;
    }
    vi.mocked(createTransport).mockReset();
  });

  it('(a) keeps the connection in phase when the inline page lands after the inline deadline', async () => {
    const transport = new ScriptedServerTransport([
      { column: 'a', value: 'first', pageDelayMs: 80 },
      { column: 'b', value: 'second' },
    ]);

    connection = await Connection.connectWithTransport(
      baseConfig({ inlineTimeout: 10 }),
      transport
    );

    const first = await connection.queryAll('RETURN "first" AS a');
    expect(columnsOf(first)).toEqual(['a']);
    expect(first[0]?.['a']).toBe('first');

    // The second query must get its OWN schema and rows, not the leftovers
    // of the first exchange.
    const second = await connection.queryAll('RETURN "second" AS b');
    expect(columnsOf(second)).toEqual(['b']);
    expect(second[0]?.['b']).toBe('second');
  });

  it('(b) never serves a query the previous query’s schema or rows', async () => {
    const scripts: QueryScript[] = [
      { column: 'a', value: 'one', pageDelayMs: 80 },
      { column: 'b', value: 'two' },
      { column: 'c', value: 'three' },
    ];
    const transport = new ScriptedServerTransport(scripts);

    connection = await Connection.connectWithTransport(
      baseConfig({ inlineTimeout: 10 }),
      transport
    );

    const outcomes: Array<{ script: QueryScript; rows?: Record<string, unknown>[] }> = [];
    for (const script of scripts) {
      try {
        const rows = await connection.queryAll(`RETURN "${script.value}" AS ${script.column}`);
        outcomes.push({ script, rows });
      } catch {
        // A failure is acceptable (fail closed); serving another query's data
        // is not. Recorded without rows so the assertions below skip it.
        outcomes.push({ script });
      }
    }

    for (const outcome of outcomes) {
      if (!outcome.rows) {
        continue;
      }
      expect(columnsOf(outcome.rows)).toEqual([outcome.script.column]);
      expect(outcome.rows[0]?.[outcome.script.column]).toBe(outcome.script.value);
    }

    // Every query resolved: the exchange must never be abandoned mid-flight.
    expect(outcomes.every((o) => o.rows !== undefined)).toBe(true);
  });

  it('(c) fails closed on an unexpected message type instead of desyncing', async () => {
    const transport = new MockTransport();
    transport.queueProtoResponse({
      hello: { success: true, sessionId: 's', errorMessage: '', capabilities: [] },
    });

    connection = await Connection.connectWithTransport(baseConfig(), transport);

    // A stale PING response (or any non-execute message) means the stream is
    // out of phase: the connection must not be usable afterwards.
    transport.queueProtoResponse({ ping: { ok: true } });

    await expect(connection.query('RETURN 1 AS x')).rejects.toThrow(TransportError);
    expect(connection.isClosed).toBe(true);
  });

  it('(c) drops a desynced connection instead of returning it to the pool', async () => {
    const transport = new MockTransport();
    transport.queueProtoResponse({
      hello: { success: true, sessionId: 's', errorMessage: '', capabilities: [] },
    });
    vi.mocked(createTransport).mockResolvedValue(transport);

    const poolConfig: PoolConfig = {
      ...baseConfig(),
      minConnections: 1,
      maxConnections: 1,
      acquireTimeout: 1000,
    };
    pool = await ConnectionPool.create(poolConfig);
    expect(pool.stats.total).toBe(1);

    const conn = await pool.acquire();
    transport.queueProtoResponse({ ping: { ok: true } });
    await expect(conn.query('RETURN 1 AS x')).rejects.toThrow(TransportError);
    await pool.release(conn);

    expect(pool.stats.total).toBe(0);
  });

  it('(d) control: a fast inline page is served without a speculative PULL', async () => {
    const transport = new ScriptedServerTransport([{ column: 'a', value: 'fast' }]);

    connection = await Connection.connectWithTransport(
      baseConfig({ inlineTimeout: 1000 }),
      transport
    );

    const rows = await connection.queryAll('RETURN "fast" AS a');
    expect(columnsOf(rows)).toEqual(['a']);
    expect(rows[0]?.['a']).toBe('fast');
    expect(transport.sent.filter((m) => m.pull !== undefined)).toHaveLength(0);
  });
});

/**
 * ENG-3916 (RC-2) / ENG-3918: the server PUSHES every page.
 *
 * `quic_connection_handler.zig:7544-7566` streams SCHEMA followed by EVERY data
 * page as `execute` responses until `final = true`. The client reads exactly ONE
 * pushed page and then sends a speculative PULL for the rest
 * (`connection.ts:_fetchNextPage`), so each PULL's real `pull`-wrapped reply is
 * orphaned in the transport: an N-page result leaves N-1 unread server messages
 * behind. The connection is then permanently out of phase and the next query
 * fails with "Invalid execute response" / "Expected schema response".
 *
 * The fix is to read the pushed pages until `final = true` (what the reference
 * Zig client does) and to drain-or-mark-broken when a result is abandoned early.
 */
describe('ENG-3916: server-pushed multi-page results', () => {
  let connection: Connection | null = null;

  afterEach(async () => {
    if (connection) {
      await connection.close();
      connection = null;
    }
  });

  // Regression: three pushed pages, read to completion.
  it('reads every pushed page and leaves nothing unread on the connection [regression]', async () => {
    const server = new ScriptedGeodeServer([
      { column: 'a', pages: [['r1', 'r2'], ['r3', 'r4'], ['r5']] },
      { column: 'b', pages: [['b1']] },
    ]);

    connection = await Connection.connectWithTransport(scriptedConfig(), server);

    const rows = await connection.queryAll('MATCH (n) RETURN n.name AS a');
    expect(rows.map((r) => r['a'])).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);

    // Every server message for that exchange must have been consumed: anything
    // left over is read by the NEXT request.
    expect(server.unconsumed).toBe(0);

    // And the connection must still be usable, with its OWN schema and rows.
    const second = await connection.queryAll('RETURN "b1" AS b');
    expect(columnsOf(second)).toEqual(['b']);
    expect(second[0]?.['b']).toBe('b1');
  });

  it('does not send a speculative PULL for a result the server already pushed', async () => {
    const server = new ScriptedGeodeServer([
      {
        column: 'a',
        pages: [
          ['r1', 'r2'],
          ['r3', 'r4'],
        ],
      },
    ]);

    connection = await Connection.connectWithTransport(scriptedConfig(), server);

    const rows = await connection.queryAll('MATCH (n) RETURN n.name AS a');
    expect(rows).toHaveLength(4);
    expect(server.sentKinds.filter((k) => k === 'pull')).toHaveLength(0);
  });

  // ENG-3918 "Expected schema response": abandoning a result mid-stream leaves
  // the remaining pushed pages queued on the connection.
  it('leaves no undrained pages when a multi-page result is abandoned after first() [regression]', async () => {
    const server = new ScriptedGeodeServer([
      { column: 'a', pages: [['r1', 'r2'], ['r3', 'r4'], ['r5']] },
      { column: 'b', pages: [['b1']] },
    ]);

    connection = await Connection.connectWithTransport(scriptedConfig(), server);

    const result = await connection.query('MATCH (n) RETURN n.name AS a');
    const first = await result.first();
    expect(first).not.toBeNull();
    result.close();

    // After the caller walks away the connection must be self-consistent:
    // either drained (still usable) or marked broken. A connection that reports
    // itself healthy while pages are still owed is what poisons the pool.
    const state = connection.isClosed
      ? 'broken'
      : server.unconsumed === 0
        ? 'drained'
        : `desynced: ${server.unconsumed} undrained server messages`;
    expect(state).not.toMatch(/^desynced/);

    if (!connection.isClosed) {
      const second = await connection.queryAll('RETURN "b1" AS b');
      expect(columnsOf(second)).toEqual(['b']);
      expect(second[0]?.['b']).toBe('b1');
    }
  });
});
