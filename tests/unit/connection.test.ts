import { describe, it, expect, beforeEach } from 'vitest';
import { Connection } from '../../src/connection.js';
import { MockTransport } from '../../src/transport.js';
import { SecurityError, TransportError } from '../../src/errors.js';
import { MAX_PAGE_SIZE } from '../../src/config.js';
import type { QuicServerMessage } from '../../src/proto.js';

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
});
