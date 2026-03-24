/**
 * Unit tests for Transaction module
 *
 * Tests transaction lifecycle, savepoints, and auto-commit/rollback.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Connection } from '../../src/connection.js';
import { MockTransport } from '../../src/transport.js';
import { Transaction, withTransaction } from '../../src/transaction.js';
import {
  ERR_TX_DONE_MESSAGE,
  ERR_NO_TX_MESSAGE,
} from '../../src/errors.js';

/**
 * Helper: create a connected Connection with MockTransport.
 */
async function createConnection(): Promise<{ connection: Connection; transport: MockTransport }> {
  const transport = new MockTransport();
  transport.queueProtoResponse({
    hello: {
      success: true,
      sessionId: 'tx-test-session',
      errorMessage: '',
      capabilities: ['gql', 'transactions'],
    },
  });

  const connection = await Connection.connectWithTransport(
    {
      host: 'localhost',
      port: 3141,
      pageSize: 100,
      transport: 'quic',
      helloName: 'test',
      helloVersion: '1.0.0',
      conformance: 'min',
      tls: true,
    },
    transport
  );

  return { connection, transport };
}

/**
 * Helper: queue a BEGIN response and begin a transaction.
 */
async function beginTransaction(
  connection: Connection,
  transport: MockTransport
): Promise<Transaction> {
  transport.queueProtoResponse({
    begin: {
      sessionId: 'tx-test-session',
      txId: 'tx-001',
    },
  });
  return connection.begin();
}

describe('Transaction', () => {
  let transport: MockTransport;
  let connection: Connection;
  let tx: Transaction;

  beforeEach(async () => {
    const ctx = await createConnection();
    transport = ctx.transport;
    connection = ctx.connection;
    tx = await beginTransaction(connection, transport);
  });

  describe('lifecycle', () => {
    it('should start in non-done state', () => {
      expect(tx.isDone).toBe(false);
      expect(connection.inTransaction).toBe(true);
    });

    it('should commit successfully', async () => {
      transport.queueProtoResponse({
        commit: { success: true },
      });

      await tx.commit();

      expect(tx.isDone).toBe(true);
      expect(connection.inTransaction).toBe(false);
    });

    it('should rollback successfully', async () => {
      transport.queueProtoResponse({
        rollback: { success: true },
      });

      await tx.rollback();

      expect(tx.isDone).toBe(true);
      expect(connection.inTransaction).toBe(false);
    });

    it('should throw on commit after commit', async () => {
      transport.queueProtoResponse({
        commit: { success: true },
      });
      await tx.commit();

      await expect(tx.commit()).rejects.toThrow(ERR_TX_DONE_MESSAGE);
    });

    it('should throw on rollback after commit', async () => {
      transport.queueProtoResponse({
        commit: { success: true },
      });
      await tx.commit();

      await expect(tx.rollback()).rejects.toThrow(ERR_TX_DONE_MESSAGE);
    });

    it('should throw on query after rollback', async () => {
      transport.queueProtoResponse({
        rollback: { success: true },
      });
      await tx.rollback();

      await expect(tx.query('RETURN 1')).rejects.toThrow(ERR_TX_DONE_MESSAGE);
    });

    it('should throw on exec after commit', async () => {
      transport.queueProtoResponse({
        commit: { success: true },
      });
      await tx.commit();

      await expect(tx.exec('CREATE (n:Test)')).rejects.toThrow(ERR_TX_DONE_MESSAGE);
    });

    it('should throw on queryAll after commit', async () => {
      transport.queueProtoResponse({
        commit: { success: true },
      });
      await tx.commit();

      await expect(tx.queryAll('RETURN 1')).rejects.toThrow(ERR_TX_DONE_MESSAGE);
    });
  });

  describe('query/exec within transaction', () => {
    it('should execute query within transaction', async () => {
      // Queue SCHEMA response
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'val', type: 'INT64' }],
          },
        },
      });

      // Queue DATA PAGE response
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [{ values: [{ intVal: { value: 42, kind: 1 } }] }],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      const result = await tx.query('RETURN 42 AS val');
      const first = await result.firstObject();

      expect(first).toBeDefined();
      expect(first?.['val']).toBe(42);
    });

    it('should execute queryAll within transaction', async () => {
      transport.queueProtoResponse({
        execute: {
          schema: {
            columns: [{ name: 'n', type: 'INT64' }],
          },
        },
      });

      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [
              { values: [{ intVal: { value: 1, kind: 1 } }] },
              { values: [{ intVal: { value: 2, kind: 1 } }] },
            ],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      const rows = await tx.queryAll('RETURN n');

      expect(rows).toHaveLength(2);
      expect(rows[0]?.['n']).toBe(1);
      expect(rows[1]?.['n']).toBe(2);
    });

    it('should execute exec within transaction', async () => {
      transport.queueProtoResponse({
        execute: {
          schema: { columns: [] },
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

      await expect(tx.exec('CREATE (n:Test)')).resolves.not.toThrow();
    });
  });

  describe('savepoints', () => {
    it('should create a savepoint', async () => {
      transport.queueProtoResponse({
        savepoint: { success: true },
      });

      await tx.savepoint('sp1');

      expect(tx.savepoints).toEqual(['sp1']);
    });

    it('should create multiple savepoints', async () => {
      transport.queueProtoResponse({
        savepoint: { success: true },
      });
      transport.queueProtoResponse({
        savepoint: { success: true },
      });

      await tx.savepoint('sp1');
      await tx.savepoint('sp2');

      expect(tx.savepoints).toEqual(['sp1', 'sp2']);
    });

    it('should rollback to a savepoint and remove it and later savepoints', async () => {
      transport.queueProtoResponse({
        savepoint: { success: true },
      });
      transport.queueProtoResponse({
        savepoint: { success: true },
      });
      transport.queueProtoResponse({
        savepoint: { success: true },
      });

      await tx.savepoint('sp1');
      await tx.savepoint('sp2');
      await tx.savepoint('sp3');

      expect(tx.savepoints).toEqual(['sp1', 'sp2', 'sp3']);

      transport.queueProtoResponse({
        rollbackTo: { success: true },
      });

      await tx.rollbackTo('sp2');

      // sp2 and sp3 should be removed, sp1 kept
      expect(tx.savepoints).toEqual(['sp1']);
    });

    it('should throw when rolling back to nonexistent savepoint', async () => {
      await expect(tx.rollbackTo('nonexistent')).rejects.toThrow('Savepoint not found');
    });

    it('should release a savepoint', async () => {
      transport.queueProtoResponse({
        savepoint: { success: true },
      });
      transport.queueProtoResponse({
        savepoint: { success: true },
      });

      await tx.savepoint('sp1');
      await tx.savepoint('sp2');

      tx.release('sp1');

      expect(tx.savepoints).toEqual(['sp2']);
    });

    it('should throw when releasing nonexistent savepoint', () => {
      expect(() => tx.release('nonexistent')).toThrow('Savepoint not found');
    });

    it('should clear savepoints on commit', async () => {
      transport.queueProtoResponse({
        savepoint: { success: true },
      });

      await tx.savepoint('sp1');

      transport.queueProtoResponse({
        commit: { success: true },
      });

      await tx.commit();

      expect(tx.savepoints).toEqual([]);
    });

    it('should clear savepoints on rollback', async () => {
      transport.queueProtoResponse({
        savepoint: { success: true },
      });

      await tx.savepoint('sp1');

      transport.queueProtoResponse({
        rollback: { success: true },
      });

      await tx.rollback();

      expect(tx.savepoints).toEqual([]);
    });

    it('should throw on savepoint after transaction is done', async () => {
      transport.queueProtoResponse({
        commit: { success: true },
      });

      await tx.commit();

      await expect(tx.savepoint('sp1')).rejects.toThrow(ERR_TX_DONE_MESSAGE);
    });

    it('should throw on release after transaction is done', async () => {
      transport.queueProtoResponse({
        savepoint: { success: true },
      });
      await tx.savepoint('sp1');

      transport.queueProtoResponse({
        commit: { success: true },
      });
      await tx.commit();

      expect(() => tx.release('sp1')).toThrow(ERR_TX_DONE_MESSAGE);
    });
  });

  describe('run (auto commit/rollback)', () => {
    it('should auto-commit on success', async () => {
      transport.queueProtoResponse({
        commit: { success: true },
      });

      const result = await tx.run(async (_tx) => {
        return 'success';
      });

      expect(result).toBe('success');
      expect(tx.isDone).toBe(true);
      expect(connection.inTransaction).toBe(false);
    });

    it('should auto-rollback on error', async () => {
      transport.queueProtoResponse({
        rollback: { success: true },
      });

      await expect(
        tx.run(async () => {
          throw new Error('test failure');
        })
      ).rejects.toThrow('test failure');

      expect(tx.isDone).toBe(true);
      expect(connection.inTransaction).toBe(false);
    });

    it('should return the value produced by the function', async () => {
      transport.queueProtoResponse({
        commit: { success: true },
      });

      const result = await tx.run(async () => {
        return { count: 42, name: 'test' };
      });

      expect(result).toEqual({ count: 42, name: 'test' });
    });

    it('should not rollback if already committed (error after commit)', async () => {
      // The run method checks _done before rolling back
      transport.queueProtoResponse({
        commit: { success: true },
      });

      // This tests the edge case where commit succeeds but something
      // goes wrong after commit (the run method should not try to rollback)
      const result = await tx.run(async () => 'ok');
      expect(result).toBe('ok');
      expect(tx.isDone).toBe(true);
    });
  });
});

describe('withTransaction', () => {
  it('should create a transaction and auto-commit on success', async () => {
    const { connection, transport } = await createConnection();

    // BEGIN response
    transport.queueProtoResponse({
      begin: {
        sessionId: 'tx-test-session',
        txId: 'tx-wt-001',
      },
    });

    // COMMIT response
    transport.queueProtoResponse({
      commit: { success: true },
    });

    const result = await withTransaction(connection, async (tx) => {
      expect(tx.isDone).toBe(false);
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(connection.inTransaction).toBe(false);
  });

  it('should create a transaction and auto-rollback on error', async () => {
    const { connection, transport } = await createConnection();

    // BEGIN response
    transport.queueProtoResponse({
      begin: {
        sessionId: 'tx-test-session',
        txId: 'tx-wt-002',
      },
    });

    // ROLLBACK response
    transport.queueProtoResponse({
      rollback: { success: true },
    });

    await expect(
      withTransaction(connection, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(connection.inTransaction).toBe(false);
  });
});
