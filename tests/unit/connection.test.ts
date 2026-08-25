import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Connection } from '../../src/connection.js';
import { MockTransport } from '../../src/transport.js';
import { SecurityError, TransportError, ERR_NO_ROWS_MESSAGE } from '../../src/errors.js';
import { MAX_PAGE_SIZE } from '../../src/config.js';

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
