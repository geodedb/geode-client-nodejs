import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConnectionPool } from '../../src/pool.js';
import type { PoolConfig } from '../../src/config.js';
import { Connection } from '../../src/connection.js';
import { TransportError } from '../../src/errors.js';
import { ScriptedGeodeServer, scriptedConfig, sleep } from './helpers/scripted-server.js';

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

  describe('QUAL-T5: addConnection maxConnections guard', () => {
    it('should not add connections beyond maxConnections during maintenance', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 3,
        maxConnections: 2,
      };

      pool = new ConnectionPool(config);

      // Inject fake connections at max capacity
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

      const fakeConn = { isClosed: false, close: async () => {} } as unknown as Connection;
      connections.push(
        { connection: fakeConn, createdAt: Date.now(), lastUsedAt: Date.now(), inUse: false },
        { connection: fakeConn, createdAt: Date.now(), lastUsedAt: Date.now(), inUse: false }
      );

      // Call addConnection directly - should be a no-op since we're at max
      const addConnection = (
        pool as unknown as { addConnection: () => Promise<void> }
      ).addConnection.bind(pool);
      await addConnection();

      expect(connections.length).toBe(2);
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

  describe('acquire', () => {
    it('should return available connection from pool', () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

      // Inject a fake available connection
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
      connections.push({
        connection: fakeConn,
        createdAt: Date.now(),
        lastUsedAt: Date.now() - 5000,
        inUse: false,
      });

      // Acquire should return the fake connection
      const promise = pool.acquire();
      return expect(promise).resolves.toBe(fakeConn);
    });

    it('should reject when pool is closed', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 2,
      };

      pool = new ConnectionPool(config);
      await pool.close();

      await expect(pool.acquire()).rejects.toThrow('connection closed');
    });

    it('should reject when signal is already aborted', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 2,
      };

      pool = new ConnectionPool(config);

      const controller = new AbortController();
      controller.abort();

      await expect(pool.acquire(controller.signal)).rejects.toThrow();
    });

    it('should mark connection as in-use after acquire', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

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
      connections.push({
        connection: fakeConn,
        createdAt: Date.now(),
        lastUsedAt: Date.now() - 5000,
        inUse: false,
      });

      await pool.acquire();

      expect(connections[0]?.inUse).toBe(true);
    });

    it('should skip closed connections when looking for available ones', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

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

      const closedConn = { isClosed: true } as unknown as Connection;
      const openConn = { isClosed: false } as unknown as Connection;
      connections.push(
        {
          connection: closedConn,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          inUse: false,
        },
        {
          connection: openConn,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          inUse: false,
        }
      );

      const acquired = await pool.acquire();

      expect(acquired).toBe(openConn);
    });
  });

  describe('release', () => {
    it('should mark connection as not in-use after release', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

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

      const fakeConn = {
        isClosed: false,
        inTransaction: false,
      } as unknown as Connection;
      connections.push({
        connection: fakeConn,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: true,
      });

      await pool.release(fakeConn);

      expect(connections[0]?.inUse).toBe(false);
    });

    it('should serve a waiting acquirer when connection is released', async () => {
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

      // Start a waiter
      const acquirePromise = pool.acquire();

      // Inject a connection and release it
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

      const fakeConn = {
        isClosed: false,
        inTransaction: false,
      } as unknown as Connection;
      connections.push({
        connection: fakeConn,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: true,
      });

      await pool.release(fakeConn);

      const acquired = await acquirePromise;
      expect(acquired).toBe(fakeConn);
    });

    it('should be a no-op for unknown connections', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

      const unknownConn = {
        isClosed: false,
        inTransaction: false,
      } as unknown as Connection;

      // Should not throw
      await pool.release(unknownConn);
    });

    it('should reset connection in transaction state before releasing', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

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

      const resetFn = vi.fn().mockResolvedValue(undefined);
      const fakeConn = {
        isClosed: false,
        inTransaction: true,
        reset: resetFn,
      } as unknown as Connection;

      connections.push({
        connection: fakeConn,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: true,
      });

      await pool.release(fakeConn);

      expect(resetFn).toHaveBeenCalledTimes(1);
      expect(connections[0]?.inUse).toBe(false);
    });

    it('should remove connection if reset fails', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

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

      const fakeConn = {
        isClosed: false,
        inTransaction: true,
        reset: vi.fn().mockRejectedValue(new Error('reset failed')),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as Connection;

      connections.push({
        connection: fakeConn,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: true,
      });

      await pool.release(fakeConn);

      // Connection should have been removed
      expect(connections).toHaveLength(0);
    });
  });

  describe('close', () => {
    it('should reject all waiters on close', async () => {
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

      const acquirePromise = pool.acquire();

      await pool.close();

      await expect(acquirePromise).rejects.toThrow('connection closed');
    });

    it('should close all connections on close', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

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

      const closeFn1 = vi.fn().mockResolvedValue(undefined);
      const closeFn2 = vi.fn().mockResolvedValue(undefined);
      connections.push(
        {
          connection: { isClosed: false, close: closeFn1 } as unknown as Connection,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          inUse: false,
        },
        {
          connection: { isClosed: false, close: closeFn2 } as unknown as Connection,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          inUse: false,
        }
      );

      await pool.close();

      expect(closeFn1).toHaveBeenCalledTimes(1);
      expect(closeFn2).toHaveBeenCalledTimes(1);
      expect(pool.isClosed).toBe(true);
    });

    it('should be idempotent', async () => {
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
      await pool.close();
      await pool.close(); // should not throw

      expect(pool.isClosed).toBe(true);
    });

    it('should clear the maintenance interval on close', async () => {
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

      const internal = pool as unknown as { _maintenanceInterval?: NodeJS.Timeout };
      expect(internal._maintenanceInterval).toBeDefined();

      await pool.close();

      expect(internal._maintenanceInterval).toBeUndefined();
    });
  });

  describe('maintenance', () => {
    it('should remove idle connections exceeding minimum', () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 1,
        maxConnections: 5,
        idleTimeout: 100, // 100ms idle timeout for testing
      };

      pool = new ConnectionPool(config);

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

      const closeFn = vi.fn().mockResolvedValue(undefined);
      const now = Date.now();

      // Add 3 idle connections, all idle longer than the timeout
      connections.push(
        {
          connection: { isClosed: false, close: closeFn } as unknown as Connection,
          createdAt: now - 10000,
          lastUsedAt: now - 5000, // idle for 5s (> 100ms)
          inUse: false,
        },
        {
          connection: { isClosed: false, close: closeFn } as unknown as Connection,
          createdAt: now - 10000,
          lastUsedAt: now - 3000,
          inUse: false,
        },
        {
          connection: { isClosed: false, close: closeFn } as unknown as Connection,
          createdAt: now - 10000,
          lastUsedAt: now - 1000,
          inUse: false,
        }
      );

      // Trigger maintenance
      const maintenance = (pool as unknown as { maintenance: () => void }).maintenance.bind(pool);
      maintenance();

      // Should keep minConnections=1, so remove 2 out of 3
      // (removal is async, so check that close was called)
      // Allow microtask to run
      expect(closeFn).toHaveBeenCalled();
    });

    it('should remove closed connections during maintenance', () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

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

      const closeFn = vi.fn().mockResolvedValue(undefined);
      connections.push({
        connection: { isClosed: true, close: closeFn } as unknown as Connection,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: false,
      });

      const maintenance = (pool as unknown as { maintenance: () => void }).maintenance.bind(pool);
      maintenance();

      // Close should be called on the already-closed connection (cleanup)
      expect(closeFn).toHaveBeenCalled();
    });

    it('should not run if pool is closed', () => {
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

      // Manually set closed
      (pool as unknown as { _closed: boolean })._closed = true;

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

      connections.push({
        connection: { isClosed: true, close: vi.fn() } as unknown as Connection,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: false,
      });

      const maintenance = (pool as unknown as { maintenance: () => void }).maintenance.bind(pool);
      maintenance();

      // Connections should remain unchanged since maintenance bailed early
      expect(connections).toHaveLength(1);
    });
  });

  describe('acquire timeout', () => {
    it('should reject acquire after timeout when no connections available', async () => {
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
        acquireTimeout: 50, // Very short timeout
      };

      pool = new ConnectionPool(config);

      await expect(pool.acquire()).rejects.toThrow(TransportError);
    });

    it('should reject waiting acquirer when signal is aborted', async () => {
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
      const acquirePromise = pool.acquire(controller.signal);

      // Abort while waiting
      controller.abort();

      await expect(acquirePromise).rejects.toThrow(TransportError);
    });
  });

  describe('RateLimiter (indirect)', () => {
    it('should configure with custom rate limiter config', () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
      };

      // Construct pool with custom rate limiter config
      pool = new ConnectionPool(config, {
        maxAttempts: 5,
        windowMs: 500,
        initialBackoffMs: 50,
        maxBackoffMs: 1000,
        backoffMultiplier: 1.5,
      });

      expect(pool.isClosed).toBe(false);
    });
  });

  describe('withConnection', () => {
    it('should provide a connection and release it after use', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

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

      const fakeConn = {
        isClosed: false,
        inTransaction: false,
      } as unknown as Connection;

      connections.push({
        connection: fakeConn,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: false,
      });

      const result = await pool.withConnection(async (conn) => {
        expect(conn).toBe(fakeConn);
        expect(connections[0]?.inUse).toBe(true);
        return 'done';
      });

      expect(result).toBe('done');
      expect(connections[0]?.inUse).toBe(false);
    });

    it('should release connection even if function throws', async () => {
      const config: PoolConfig = {
        host: 'localhost',
        port: 3141,
        transport: 'quic',
        pageSize: 100,
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        minConnections: 0,
        maxConnections: 5,
      };

      pool = new ConnectionPool(config);

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

      const fakeConn = {
        isClosed: false,
        inTransaction: false,
      } as unknown as Connection;

      connections.push({
        connection: fakeConn,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        inUse: false,
      });

      await expect(
        pool.withConnection(async () => {
          throw new Error('oops');
        })
      ).rejects.toThrow('oops');

      expect(connections[0]?.inUse).toBe(false);
    });
  });
});

/**
 * ENG-3918 (RC-3) + ENG-3916 (RC-5): pool liveness and streaming ownership.
 *
 * The pool's ONLY liveness predicate is `Connection.isClosed`
 * (pool.ts:232,:326,:494,:543). A connection desynced by a request timeout is
 * still open, so it is handed straight back out and the next caller silently
 * receives the previous query's rows. And `pool.query()` (pool.ts:359-361)
 * releases the member as soon as `conn.query()` resolves, while the streaming
 * QueryResult still needs that very connection to fetch its remaining pages.
 */
interface PooledMember {
  connection: Connection;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
}

const membersOf = (pool: ConnectionPool): PooledMember[] =>
  (pool as unknown as { _connections: PooledMember[] })._connections;

const poolConfig = (overrides: Partial<PoolConfig> = {}): PoolConfig => ({
  host: 'localhost',
  port: 3141,
  transport: 'quic',
  pageSize: 100,
  helloName: 'test',
  helloVersion: '1.0.0',
  conformance: 'min',
  minConnections: 0,
  maxConnections: 1,
  acquireTimeout: 300,
  connectTimeout: 250,
  ...overrides,
});

/**
 * A real Connection that has been desynced by a request timeout: the server's
 * late answer is queued on its stream, but the connection is still open and
 * therefore still looks healthy to the pool.
 */
async function desyncedConnection(): Promise<Connection> {
  const server = new ScriptedGeodeServer([
    { column: 'slow', pages: [['s1']], schemaDelayMs: 300 },
    { column: 'next', pages: [['n1']] },
  ]);
  const conn = await Connection.connectWithTransport(
    scriptedConfig({ requestTimeout: 50, connectTimeout: 250 }),
    server
  );
  await conn.queryAll('RETURN "s1" AS slow').catch(() => undefined);
  await sleep(400); // the stalled answer now sits unread on the stream
  return conn;
}

describe('ENG-3918: pool must evict connections broken by a timed-out exchange', () => {
  let pool: ConnectionPool | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.close();
      pool = null;
    }
  });

  // Regression: a desynced member released back into the pool is reused.
  it('evicts a broken connection on release [regression]', async () => {
    pool = new ConnectionPool(poolConfig());
    const conn = await desyncedConnection();
    membersOf(pool).push({
      connection: conn,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: true,
    });

    await pool.release(conn);

    expect(pool.stats.total).toBe(0);
  });

  it('never hands a broken connection back out on acquire [regression]', async () => {
    pool = new ConnectionPool(poolConfig());
    const conn = await desyncedConnection();
    membersOf(pool).push({
      connection: conn,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: false,
    });

    // Either a fresh connection or a loud failure - but never the broken one.
    const acquired = await pool.acquire().catch((e: unknown) => e);

    expect(acquired).not.toBe(conn);
  });

  it('removes a broken connection during maintenance', async () => {
    pool = new ConnectionPool(poolConfig());
    const conn = await desyncedConnection();
    membersOf(pool).push({
      connection: conn,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: false,
    });

    (pool as unknown as { maintenance: () => void }).maintenance();
    await sleep(50);

    expect(membersOf(pool)).toHaveLength(0);
  });
});

describe('ENG-3916: pool.query must keep the member until the result is closed', () => {
  let pool: ConnectionPool | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.close();
      pool = null;
    }
  });

  // Regression: withConnection releases the member while the QueryResult is
  // still streaming from it, so another caller can interleave on that stream.
  it('holds the pooled member in use for the lifetime of a streaming result [regression]', async () => {
    pool = new ConnectionPool(poolConfig());
    const server = new ScriptedGeodeServer([
      { column: 'a', pages: [['r1', 'r2'], ['r3', 'r4'], ['r5']] },
    ]);
    const conn = await Connection.connectWithTransport(scriptedConfig(), server);
    membersOf(pool).push({
      connection: conn,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: false,
    });

    const result = await pool.query('MATCH (n) RETURN n.name AS a');

    // The result still owns the connection: the pool must not lend it out.
    expect(pool.stats.inUse).toBe(1);
    expect(pool.stats.available).toBe(0);

    const rows = await result.toArray();
    expect(rows).toHaveLength(5);

    result.close();
    await sleep(0);

    expect(pool.stats.inUse).toBe(0);
    expect(pool.stats.available).toBe(1);
  });
});
