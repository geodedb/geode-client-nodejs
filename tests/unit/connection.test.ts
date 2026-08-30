import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection } from '../../src/connection.js';
import { MockTransport } from '../../src/transport.js';
import { SecurityError, TransportError, ERR_NO_ROWS_MESSAGE } from '../../src/errors.js';
import { MAX_PAGE_SIZE } from '../../src/config.js';
import {
  ScriptedGeodeServer,
  scriptedConfig,
  columnsOf,
  sleep,
  type PushScript,
} from './helpers/scripted-server.js';

describe('Connection', () => {
  let transport: MockTransport;
  let connection: Connection;

  beforeEach(async () => {
    transport = new MockTransport();

    // Queue HELLO response
    transport.queueProtoResponse({
      hello: {
        success: true,
        sessionId: 'test-session-123',
        errorMessage: '',
        capabilities: ['gql', 'transactions'],
      },
    });

    connection = await Connection.connectWithTransport(
      {
        host: 'localhost',
        port: 3141,
        pageSize: 100,
        transport: 'quic',
        helloName: 'test-client',
        helloVersion: '1.0.0',
        conformance: 'min',
        tls: true,
      },
      transport
    );
  });

  describe('query', () => {
    it('should execute simple query and return result', async () => {
      // Queue SCHEMA response (execute with schema)
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'num', type: 'INT64' }],
          },
        },
      });

      // Queue DATA PAGE response (execute with page, after PULL)
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [
              {
                values: [{ intVal: { value: 42, kind: 1 } }],
              },
            ],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      const result = await connection.query('RETURN 42 AS num');
      const rows: unknown[] = [];
      for await (const row of result) {
        rows.push(row);
      }

      expect(rows).toHaveLength(1);
    });

    it('should handle inline BINDINGS frame (no PULL needed)', async () => {
      // Queue SCHEMA response
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'result', type: 'STRING' }],
          },
        },
      });

      // Queue DATA PAGE response immediately (inline)
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [
              {
                values: [{ stringVal: { value: 'hello', kind: 1 } }],
              },
            ],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      const result = await connection.query('RETURN "hello" AS result');
      const firstRow = await result.firstObject();

      expect(firstRow).toBeDefined();
      expect(firstRow?.['result']).toBe('hello');
    });

    it('should handle query error from server', async () => {
      // Queue ERROR response
      transport.queueProtoResponse({
        execute: {
          status: {
            statusClass: '42000',
            statusSubclass: '000',
            additionalStatuses: [],
            flaggerFindings: [],
          },
          error: {
            code: 'SyntaxError',
            message: 'Unexpected token',
            type: 'SyntaxError',
            anchor: '',
          },
        },
      });

      await expect(connection.query('INVALID SYNTAX')).rejects.toThrow();
    });
  });

  describe('queryAll', () => {
    it('should return all rows as array', async () => {
      // Queue SCHEMA response
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'n', type: 'INT64' }],
          },
        },
      });

      // Queue DATA PAGE response
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [
              { values: [{ intVal: { value: 1, kind: 1 } }] },
              { values: [{ intVal: { value: 2, kind: 1 } }] },
              { values: [{ intVal: { value: 3, kind: 1 } }] },
            ],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      const rows = await connection.queryAll('RETURN n');

      expect(rows).toHaveLength(3);
      expect(rows[0]?.['n']).toBe(1);
      expect(rows[1]?.['n']).toBe(2);
      expect(rows[2]?.['n']).toBe(3);
    });

    it('should handle USE database prefix - CRITICAL BUG REPRODUCTION', async () => {
      // This test verifies that queries with USE prefix work correctly
      // This was the specific failing case reported in the bug

      // Queue SCHEMA response
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'n', type: 'NODE' }],
          },
        },
      });

      // Queue DATA PAGE response with node value
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [
              {
                values: [
                  {
                    nodeVal: {
                      id: 1,
                      labels: ['Test'],
                      properties: [],
                    },
                  },
                ],
              },
            ],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      const rows = await connection.queryAll('USE firewall; MATCH (n) RETURN n LIMIT 5');

      expect(rows).toHaveLength(1);
    });

    it('should not hang when no inline frame and PULL is required', async () => {
      // This tests the specific scenario where:
      // 1. SCHEMA is received
      // 2. No inline DATA PAGE (timeout fires)
      // 3. PULL is sent
      // 4. DATA PAGE is received

      // Queue SCHEMA response
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'value', type: 'STRING' }],
          },
        },
      });

      // Don't queue DATA PAGE yet - simulate delay

      // Start queryAll (non-blocking)
      const queryPromise = connection.queryAll('MATCH (n) RETURN n');

      // Wait for SCHEMA to be processed and inline check to timeout
      await new Promise((r) => setTimeout(r, 50));

      // Now queue DATA PAGE (after PULL would have been sent)
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [
              {
                values: [{ stringVal: { value: 'data', kind: 1 } }],
              },
            ],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      // Query should complete successfully
      const rows = await queryPromise;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.['value']).toBe('data');
    });
  });

  describe('exec', () => {
    it('should execute statement without returning rows', async () => {
      // Queue SCHEMA response (CREATE typically returns empty schema + empty page)
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [],
          },
        },
      });

      // Queue empty DATA PAGE
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      await expect(connection.exec('CREATE (n:Test)')).resolves.not.toThrow();
    });

    it('should handle SCHEMA response for exec (drains inline bindings)', async () => {
      // Some exec statements return SCHEMA + DATA PAGE
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [],
          },
        },
      });

      // Queue empty DATA PAGE
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      await expect(connection.exec('CREATE (n:Test)')).resolves.not.toThrow();
    });
  });

  describe('QUAL-T7: exec drains multi-page results', () => {
    it('should drain remaining pages when exec receives non-final inline data', async () => {
      // Queue SCHEMA response
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'id', type: 'INT64' }],
          },
        },
      });

      // Queue non-final inline DATA PAGE (page 1 of 2)
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [{ values: [{ intVal: { value: 1, kind: 1 } }] }],
            final: false,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      // Queue final DATA PAGE (page 2 of 2) - this should be drained by exec()
      transport.queueProtoResponse({
        pull: {
          response: {
            page: {
              rows: [{ values: [{ intVal: { value: 2, kind: 1 } }] }],
              final: true,
              ordered: false,
              orderKeys: [],
            },
          },
        },
      });

      // exec() should drain all pages without error
      await expect(connection.exec('CREATE (n:Test) RETURN n')).resolves.not.toThrow();

      // Connection should be idle and ready for next query
      expect(connection.state).toBe('idle');

      // Verify next query works correctly (no corruption)
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'val', type: 'STRING' }],
          },
        },
      });
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [{ values: [{ stringVal: { value: 'ok', kind: 1 } }] }],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      const rows = await connection.queryAll('RETURN "ok" AS val');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.['val']).toBe('ok');
    });

    it('should handle exec with final inline data (no drain needed)', async () => {
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [],
          },
        },
      });

      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      await expect(connection.exec('CREATE (n:Test)')).resolves.not.toThrow();
      expect(connection.state).toBe('idle');
    });
  });

  describe('QUAL-T4: configurable inline timeout', () => {
    it('should use custom inlineTimeout from config', async () => {
      const customTransport = new MockTransport();
      customTransport.queueProtoResponse({
        hello: {
          success: true,
          sessionId: 'inline-timeout-session',
          errorMessage: '',
          capabilities: [],
        },
      });

      // Create connection with very short inline timeout
      const customConnection = await Connection.connectWithTransport(
        {
          host: 'localhost',
          port: 3141,
          pageSize: 100,
          transport: 'quic',
          helloName: 'test',
          helloVersion: '1.0.0',
          conformance: 'min',
          inlineTimeout: 50, // 50ms instead of default 5000ms
        },
        customTransport
      );

      // Queue SCHEMA response
      customTransport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'n', type: 'INT64' }],
          },
        },
      });

      // Don't queue inline data - the short timeout should fire quickly
      // Then queue the PULL response that will be needed after timeout
      const startTime = Date.now();

      // Start query - inline timeout will fire at 50ms, then PULL will be sent
      const queryPromise = connection.queryAll.call(customConnection, 'RETURN 1 AS n');

      // Wait for inline timeout to fire (50ms), then queue PULL response.
      // The server answers a PULL with a `pull`-wrapped response (ENG-3916):
      // that wrapper is what tells the client the exchange is complete.
      await new Promise((r) => setTimeout(r, 80));

      customTransport.queueProtoResponse({
        pull: {
          response: {
            page: {
              rows: [{ values: [{ intVal: { value: 1, kind: 1 } }] }],
              final: true,
              ordered: false,
              orderKeys: [],
            },
          },
        },
      });

      const rows = await queryPromise;
      const elapsed = Date.now() - startTime;

      expect(rows).toHaveLength(1);
      // The inline timeout should have been ~50ms, not 5000ms
      // Allow generous margin but it should be well under the default 5s
      expect(elapsed).toBeLessThan(3000);
      expect(customTransport.getSentProtoMessages().some((m) => m.pull !== undefined)).toBe(true);

      // ENG-3916: the connection must still be in phase for the next query.
      customTransport.queueProtoResponse({
        execute: { schema: { columns: [{ name: 'label', type: 'STRING' }] } },
      });
      customTransport.queueProtoResponse({
        execute: {
          page: {
            rows: [{ values: [{ stringVal: { value: 'next', kind: 1 } }] }],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      const nextRows = await connection.queryAll.call(customConnection, 'RETURN "next" AS label');
      expect(nextRows).toHaveLength(1);
      expect(nextRows[0]).toEqual({ label: 'next' });
    });
  });

  describe('ping', () => {
    it('should ping successfully', async () => {
      transport.queueProtoResponse({
        ping: {
          ok: true,
        },
      });

      await expect(connection.ping()).resolves.not.toThrow();
    });

    it('should handle ping error', async () => {
      transport.queueProtoResponse({
        ping: {
          ok: false,
        },
      });

      await expect(connection.ping()).rejects.toThrow();
    });
  });

  describe('transaction', () => {
    it('should begin and commit transaction', async () => {
      // BEGIN response
      transport.queueProtoResponse({
        begin: {
          sessionId: 'test-session-123',
          txId: 'tx-001',
        },
      });

      const tx = await connection.begin();
      expect(connection.inTransaction).toBe(true);

      // COMMIT response
      transport.queueProtoResponse({
        commit: {
          success: true,
        },
      });

      await tx.commit();
      expect(connection.inTransaction).toBe(false);
    });

    it('should begin and rollback transaction', async () => {
      // BEGIN response
      transport.queueProtoResponse({
        begin: {
          sessionId: 'test-session-123',
          txId: 'tx-002',
        },
      });

      const tx = await connection.begin();

      // ROLLBACK response
      transport.queueProtoResponse({
        rollback: {
          success: true,
        },
      });

      await tx.rollback();
      expect(connection.inTransaction).toBe(false);
    });
  });

  describe('close', () => {
    it('should close connection', async () => {
      await connection.close();
      expect(connection.isClosed).toBe(true);
    });

    it('should be idempotent', async () => {
      await connection.close();
      await connection.close(); // Should not throw
    });
  });

  describe('queryRow', () => {
    it('returns the first row when rows exist', async () => {
      vi.spyOn(connection, 'queryAll').mockResolvedValue([{ n: 1 }, { n: 2 }]);
      const row = await connection.queryRow('MATCH (n) RETURN n');
      expect(row).toEqual({ n: 1 });
    });

    it('throws ErrNoRows when no rows are returned', async () => {
      vi.spyOn(connection, 'queryAll').mockResolvedValue([]);
      await expect(connection.queryRow('MATCH (n) RETURN n')).rejects.toThrow(ERR_NO_ROWS_MESSAGE);
    });
  });

  describe('pageSize validation', () => {
    it('should reject negative pageSize override', async () => {
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'num', type: 'INT64' }],
          },
        },
      });

      await expect(connection.query('RETURN 1 AS num', { pageSize: -1 })).rejects.toThrow(
        SecurityError
      );
    });

    it('should reject pageSize above MAX_PAGE_SIZE', async () => {
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'num', type: 'INT64' }],
          },
        },
      });

      await expect(
        connection.query('RETURN 1 AS num', { pageSize: MAX_PAGE_SIZE + 1 })
      ).rejects.toThrow(SecurityError);
    });
  });

  describe('request timeout', () => {
    it('should abort when requestTimeout is exceeded', async () => {
      const timeoutTransport = new MockTransport();
      timeoutTransport.queueProtoResponse({
        hello: {
          success: true,
          sessionId: 'timeout-session',
          errorMessage: '',
          capabilities: [],
        },
      });

      const timeoutConnection = await Connection.connectWithTransport(
        {
          host: 'localhost',
          port: 3141,
          pageSize: 100,
          transport: 'quic',
          helloName: 'test',
          helloVersion: '1.0.0',
          conformance: 'min',
          requestTimeout: 10,
        },
        timeoutTransport
      );

      // Don't queue any response - the timeout should fire
      await expect(timeoutConnection.exec('RETURN 1')).rejects.toThrow(TransportError);
    });

    it('should honor already-aborted signals with requestTimeout', async () => {
      const timeoutTransport = new MockTransport();
      timeoutTransport.queueProtoResponse({
        hello: {
          success: true,
          sessionId: 'timeout-session-2',
          errorMessage: '',
          capabilities: [],
        },
      });

      const timeoutConnection = await Connection.connectWithTransport(
        {
          host: 'localhost',
          port: 3141,
          pageSize: 100,
          transport: 'quic',
          helloName: 'test',
          helloVersion: '1.0.0',
          conformance: 'min',
          requestTimeout: 1000,
        },
        timeoutTransport
      );

      const controller = new AbortController();
      controller.abort();

      await expect(
        timeoutConnection.exec('RETURN 1', { signal: controller.signal })
      ).rejects.toThrow(TransportError);
    });
  });

  // GAP-0841: connect() must forward tenant + role from config into the HELLO
  // handshake so multi-tenant and FLE work from the Node.js client.
  describe('hello handshake tenant/role forwarding', () => {
    it('forwards tenant and role into the HELLO request when configured', async () => {
      const helloTransport = new MockTransport();
      helloTransport.queueProtoResponse({
        hello: {
          success: true,
          sessionId: 'session-tenant',
          errorMessage: '',
          capabilities: ['gql'],
        },
      });

      await Connection.connectWithTransport(
        {
          host: 'localhost',
          port: 3141,
          pageSize: 100,
          transport: 'quic',
          helloName: 'test',
          helloVersion: '1.0.0',
          conformance: 'min',
          tenant: 'tenant-a',
          role: 'fle-admin',
          graph: 'mygraph',
        },
        helloTransport
      );

      const sent = helloTransport.getSentProtoMessages();
      expect(sent.length).toBeGreaterThan(0);
      const hello = sent[0]?.hello;
      expect(hello?.tenantId).toBe('tenant-a');
      expect(hello?.role).toBe('fle-admin');
      expect(hello?.graph).toBe('mygraph');
    });

    it('omits tenant and role from the HELLO request when not configured', async () => {
      const helloTransport = new MockTransport();
      helloTransport.queueProtoResponse({
        hello: {
          success: true,
          sessionId: 'session-plain',
          errorMessage: '',
          capabilities: ['gql'],
        },
      });

      await Connection.connectWithTransport(
        {
          host: 'localhost',
          port: 3141,
          pageSize: 100,
          transport: 'quic',
          helloName: 'test',
          helloVersion: '1.0.0',
          conformance: 'min',
        },
        helloTransport
      );

      const hello = helloTransport.getSentProtoMessages()[0]?.hello;
      expect(hello?.tenantId).toBeUndefined();
      expect(hello?.role).toBeUndefined();
    });
  });
});

/**
 * ENG-3916 (RC-1): a Connection owns ONE bidirectional stream with no
 * request/response correlation, but nothing serializes the exchanges on it.
 * `checkState` only guards `fetching`/`_activeResult`; `exec` sets
 * `_state = 'executing'` (connection.ts:382) and `ping`/`_commit`/`_rollback`/
 * `_savepoint`/`_rollbackTo` are unguarded, so two callers can interleave a
 * request/response pair on the same stream. On the real QUIC transport the
 * second concurrent `sendProto` also throws "WritableStream is locked"
 * (transport.ts:451-482).
 *
 * The fix queues exchanges (an async mutex covering the FULL request ->
 * final-response round trip) instead of failing fast, so callers that share a
 * connection are serialized rather than rejected or interleaved.
 */
describe('ENG-3916: per-connection exchange serialization', () => {
  let connection: Connection | null = null;

  afterEach(async () => {
    if (connection) {
      await connection.close();
      connection = null;
    }
  });

  // Regression: four concurrent queries on ONE connection must all complete.
  it('serializes four concurrent queryAll calls on one connection [regression]', async () => {
    const scripts: PushScript[] = [
      { column: 'c0', pages: [['v0']] },
      { column: 'c1', pages: [['v1']] },
      { column: 'c2', pages: [['v2']] },
      { column: 'c3', pages: [['v3']] },
    ];
    const server = new ScriptedGeodeServer(scripts);
    const conn = await Connection.connectWithTransport(scriptedConfig(), server);
    connection = conn;

    const settled = await Promise.allSettled(
      scripts.map((s) => conn.queryAll(`RETURN "${s.pages[0]![0]!}" AS ${s.column}`))
    );

    const failures = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason as Error).message);
    expect(failures).toEqual([]);

    // Every scripted answer must have been delivered exactly once, each with
    // its own column and value (order-independent).
    const delivered = settled
      .filter(
        (r): r is PromiseFulfilledResult<Record<string, unknown>[]> => r.status === 'fulfilled'
      )
      .map((r) => {
        const rows = r.value;
        const column = columnsOf(rows)[0];
        return `${column ?? '<none>'}=${String(rows[0]?.[column ?? ''])}`;
      })
      .sort();
    expect(delivered).toEqual(['c0=v0', 'c1=v1', 'c2=v2', 'c3=v3']);
    expect(server.unconsumed).toBe(0);
    expect(connection.isClosed).toBe(false);
  });

  it('serializes a concurrent exec and query instead of interleaving them', async () => {
    const server = new ScriptedGeodeServer([
      { column: 'created', pages: [['ok']] },
      { column: 'b', pages: [['b1']] },
    ]);
    connection = await Connection.connectWithTransport(scriptedConfig(), server);

    const execPromise = connection.exec('CREATE (n:Thing)');
    const queryPromise = connection.queryAll('RETURN "b1" AS b');
    const [execResult, queryResult] = await Promise.allSettled([execPromise, queryPromise]);

    expect(execResult.status).toBe('fulfilled');
    expect(queryResult.status).toBe('fulfilled');
    if (queryResult.status === 'fulfilled') {
      // The query must get its OWN schema and rows, never the exec's.
      expect(columnsOf(queryResult.value)).toEqual(['b']);
      expect(queryResult.value[0]?.['b']).toBe('b1');
    }
    expect(server.unconsumed).toBe(0);
  });

  it('serializes a ping issued while a query is in flight', async () => {
    const server = new ScriptedGeodeServer([{ column: 'a', pages: [['a1']] }]);
    connection = await Connection.connectWithTransport(scriptedConfig(), server);

    const queryPromise = connection.queryAll('RETURN "a1" AS a');
    const pingPromise = connection.ping();
    const [query, ping] = await Promise.allSettled([queryPromise, pingPromise]);

    expect(ping.status).toBe('fulfilled');
    expect(query.status).toBe('fulfilled');
    if (query.status === 'fulfilled') {
      expect(columnsOf(query.value)).toEqual(['a']);
      expect(query.value[0]?.['a']).toBe('a1');
    }
    expect(server.unconsumed).toBe(0);
  });
});

/**
 * ENG-3918 (RC-3): `_closeOnTransportError` (connection.ts:923-929) exempts
 * every error whose cause message is 'Aborted', and the request-timeout signal
 * built by `withAbortTimeout` (abort-utils.ts:43) aborts with exactly that
 * cause. A request that times out therefore leaves the connection open, `idle`
 * and one exchange behind: the server's late answer is still queued on the
 * stream and is handed to the NEXT caller, who silently receives the PREVIOUS
 * query's schema and rows.
 *
 * The fix latches a sticky broken flag on a timed-out exchange (a caller abort
 * is a different case) so the connection fails loud instead of leaking.
 */
describe('ENG-3918: a timed-out exchange must not leak into the next query', () => {
  let connection: Connection | null = null;

  afterEach(async () => {
    if (connection) {
      await connection.close();
      connection = null;
    }
  });

  // Regression: proven silent cross-query data leakage.
  it('never serves a later query the timed-out query’s rows [regression]', async () => {
    const scripts: PushScript[] = [
      { column: 'slow', pages: [['s1']], schemaDelayMs: 400 },
      { column: 'next', pages: [['n1']] },
      { column: 'third', pages: [['t1']] },
    ];
    const server = new ScriptedGeodeServer(scripts);
    connection = await Connection.connectWithTransport(
      scriptedConfig({ requestTimeout: 100 }),
      server
    );

    // 1. The first query times out while the server is still stalled.
    await expect(connection.queryAll('RETURN "s1" AS slow')).rejects.toThrow(TransportError);

    // 2. The server finally answers; its response queues on the connection.
    await sleep(600);

    // 3. Every later query must either fail loud or return its OWN data.
    const outcomes: Array<{ script: PushScript; rows?: Record<string, unknown>[] }> = [];
    for (const script of scripts.slice(1)) {
      try {
        const rows = await connection.queryAll(`RETURN "x" AS ${script.column}`);
        outcomes.push({ script, rows });
      } catch {
        outcomes.push({ script });
      }
    }

    for (const outcome of outcomes) {
      if (!outcome.rows) {
        continue;
      }
      expect(columnsOf(outcome.rows)).toEqual([outcome.script.column]);
      expect(outcome.rows[0]?.[outcome.script.column]).toBe(outcome.script.pages[0]![0]);
    }
  });

  it('marks the connection unusable after a request timeout', async () => {
    const server = new ScriptedGeodeServer([
      { column: 'slow', pages: [['s1']], schemaDelayMs: 400 },
      { column: 'next', pages: [['n1']] },
    ]);
    connection = await Connection.connectWithTransport(
      scriptedConfig({ requestTimeout: 100 }),
      server
    );

    await expect(connection.queryAll('RETURN "s1" AS slow')).rejects.toThrow(TransportError);

    // A desynced connection must not look healthy: the pool's only liveness
    // predicate is Connection.isClosed (pool.ts:232,:326,:494,:543).
    expect(connection.isClosed).toBe(true);
  });

  it('rejects a query issued on a connection left broken by a timeout', async () => {
    const server = new ScriptedGeodeServer([
      { column: 'slow', pages: [['s1']], schemaDelayMs: 400 },
      { column: 'next', pages: [['n1']] },
    ]);
    connection = await Connection.connectWithTransport(
      scriptedConfig({ requestTimeout: 100 }),
      server
    );

    await expect(connection.queryAll('RETURN "s1" AS slow')).rejects.toThrow(TransportError);
    await sleep(600);

    // Fail loud: returning the stalled query's rows here is the ENG-3918 leak.
    await expect(connection.queryAll('RETURN "n1" AS next')).rejects.toThrow();
  });
});
