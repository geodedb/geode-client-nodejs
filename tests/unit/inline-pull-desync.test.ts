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
