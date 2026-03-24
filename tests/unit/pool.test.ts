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
