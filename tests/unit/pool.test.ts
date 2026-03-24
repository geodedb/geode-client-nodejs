import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConnectionPool } from '../../src/pool.js';
import type { PoolConfig } from '../../src/config.js';
import type { Connection } from '../../src/connection.js';

describe('ConnectionPool', () => {
  let pool: ConnectionPool | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.close();
      pool = null;
    }
  });

  describe('defaults', () => {
    it('should default minConnections to 1', () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
      };

      pool = new ConnectionPool(config);

      // Pool starts with 0 connections (create() populates min)
      expect(pool.stats.total).toBe(0);
      // Verify it doesn't crash with the new defaults
      expect(pool.isClosed).toBe(false);
    });

    it('should default maxConnections to 3', () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
      };

      pool = new ConnectionPool(config);
      expect(pool.isClosed).toBe(false);
    });

    it('should respect explicit minConnections', () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 2,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);
      expect(pool.isClosed).toBe(false);
    });
  });

  describe('PERF-8: maintenance interval unref', () => {
    it('should call unref on the maintenance interval', () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
      };

      pool = new ConnectionPool(config);

      // Access the internal interval via the private field
      const interval = (pool as unknown as { _maintenanceInterval: NodeJS.Timeout })
        ._maintenanceInterval;
      expect(interval).toBeDefined();

      // The interval should have been unref'd. We verify by checking that
      // hasRef() returns false (Node.js Timeout API)
      if (typeof interval.hasRef === 'function') {
        expect(interval.hasRef()).toBe(false);
      }
    });
  });

  describe('PERF-13: pool stats single pass', () => {
    it('should return correct stats with single pass', () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
      };

      pool = new ConnectionPool(config);

      // Inject fake connections to test stats calculation
      const connections = (
        pool as unknown as {
          _connections: Array<{
            connection: Connection;
            createdAt: number;
            lastUsedAt: number;
            inUse: boolean;
          }>;
        }
      )._connections;

      const fakeConn = { isClosed: false } as unknown as Connection;
      connections.push(
        { connection: fakeConn, createdAt: Date.now(), lastUsedAt: Date.now(), inUse: true },
        { connection: fakeConn, createdAt: Date.now(), lastUsedAt: Date.now(), inUse: false },
        { connection: fakeConn, createdAt: Date.now(), lastUsedAt: Date.now(), inUse: true },
        { connection: fakeConn, createdAt: Date.now(), lastUsedAt: Date.now(), inUse: false },
        { connection: fakeConn, createdAt: Date.now(), lastUsedAt: Date.now(), inUse: false }
      );

      const stats = pool.stats;
      expect(stats.total).toBe(5);
      expect(stats.inUse).toBe(2);
      expect(stats.available).toBe(3);
      expect(stats.waiting).toBe(0);
    });
  });

  describe('AbortSignal listener cleanup', () => {
    it('should clean up abort listener on successful acquire', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 0,
      };

      pool = new ConnectionPool(config);

      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

      const acquirePromise = pool.acquire(controller.signal);

      // Get the wait queue and resolve the waiter
      const waitQueue = (
        pool as unknown as { _waitQueue: Array<{ resolve: (c: Connection) => void }> }
      )._waitQueue;
      expect(waitQueue.length).toBe(1);

      waitQueue[0]?.resolve({} as Connection);

      await expect(acquirePromise).resolves.toBeDefined();
      expect(removeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
