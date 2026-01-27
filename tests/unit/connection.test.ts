import { describe, it, expect, beforeEach } from 'vitest';
import { Connection } from '../../src/connection.js';
import { MockTransport } from '../../src/transport.js';
import { RespType } from '../../src/protocol.js';

describe('Connection', () => {
  let transport: MockTransport;
  let connection: Connection;

  beforeEach(async () => {
    transport = new MockTransport();

    // Queue HELLO response
    transport.queueResponse({
      status_class: '00000',
      status_subclass: '000',
      result: {
        type: RespType.STATUS,
      },
    });

    connection = await Connection.connectWithTransport(
      {
        host: 'localhost',
        port: 3141,
        pageSize: 100,
      },
      transport
    );
  });

  describe('query', () => {
    it('should execute simple query and return result', async () => {
      // Queue SCHEMA response
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.SCHEMA,
          columns: [{ name: 'num', type: 'INT64' }],
        },
      });

      // Queue BINDINGS response (after PULL)
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.BINDINGS,
          rows: [{ num: 42 }],
          final: true,
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
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.SCHEMA,
          columns: [{ name: 'result', type: 'STRING' }],
        },
      });

      // Queue BINDINGS response immediately (inline)
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.BINDINGS,
          rows: [{ result: 'hello' }],
          final: true,
        },
      });

      const result = await connection.query('RETURN "hello" AS result');
      const firstRow = await result.firstObject();

      expect(firstRow).toBeDefined();
      expect(firstRow?.['result']).toBe('hello');
    });

    it('should handle query error from server', async () => {
      // Queue ERROR response
      transport.queueResponse({
        status_class: '42000',
        status_subclass: '000',
        result: {
          type: RespType.ERROR,
          code: 'SyntaxError',
          message: 'Unexpected token',
        },
      });

      await expect(connection.query('INVALID SYNTAX')).rejects.toThrow();
    });
  });

  describe('queryAll', () => {
    it('should return all rows as array', async () => {
      // Queue SCHEMA response
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.SCHEMA,
          columns: [{ name: 'n', type: 'INT64' }],
        },
      });

      // Queue BINDINGS response
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.BINDINGS,
          rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
          final: true,
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
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.SCHEMA,
          columns: [{ name: 'n', type: 'NODE' }],
        },
      });

      // Queue BINDINGS response
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.BINDINGS,
          rows: [{ n: { id: '1', labels: ['Test'] } }],
          final: true,
        },
      });

      const rows = await connection.queryAll('USE firewall; MATCH (n) RETURN n LIMIT 5');

      expect(rows).toHaveLength(1);
    });

    it('should not hang when no inline frame and PULL is required', async () => {
      // This tests the specific scenario where:
      // 1. SCHEMA is received
      // 2. No inline BINDINGS (timeout fires)
      // 3. PULL is sent
      // 4. BINDINGS is received

      // Queue SCHEMA response
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.SCHEMA,
          columns: [{ name: 'value', type: 'STRING' }],
        },
      });

      // Don't queue BINDINGS yet - simulate delay

      // Start queryAll (non-blocking)
      const queryPromise = connection.queryAll('MATCH (n) RETURN n');

      // Wait for SCHEMA to be processed and inline check to timeout
      await new Promise((r) => setTimeout(r, 50));

      // Now queue BINDINGS (after PULL would have been sent)
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.BINDINGS,
          rows: [{ value: 'data' }],
          final: true,
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
      // Queue STATUS response
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.STATUS,
        },
      });

      await expect(connection.exec('CREATE (n:Test)')).resolves.not.toThrow();
    });

    it('should handle SCHEMA response for exec (drains inline bindings)', async () => {
      // Some exec statements return SCHEMA + BINDINGS
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.SCHEMA,
          columns: [],
        },
      });

      // Queue empty BINDINGS
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.BINDINGS,
          rows: [],
          final: true,
        },
      });

      await expect(connection.exec('CREATE (n:Test)')).resolves.not.toThrow();
    });
  });

  describe('ping', () => {
    it('should ping successfully', async () => {
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.STATUS,
        },
      });

      await expect(connection.ping()).resolves.not.toThrow();
    });

    it('should handle ping error', async () => {
      transport.queueResponse({
        status_class: '58000',
        status_subclass: '000',
        result: {
          type: RespType.ERROR,
          message: 'Server error',
        },
      });

      await expect(connection.ping()).rejects.toThrow();
    });
  });

  describe('transaction', () => {
    it('should begin and commit transaction', async () => {
      // BEGIN response
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.STATUS,
        },
      });

      const tx = await connection.begin();
      expect(connection.inTransaction).toBe(true);

      // COMMIT response
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.STATUS,
        },
      });

      await tx.commit();
      expect(connection.inTransaction).toBe(false);
    });

    it('should begin and rollback transaction', async () => {
      // BEGIN response
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.STATUS,
        },
      });

      const tx = await connection.begin();

      // ROLLBACK response
      transport.queueResponse({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.STATUS,
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
});
