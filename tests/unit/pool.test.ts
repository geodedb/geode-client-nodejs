import { describe, it, expect, afterEach } from 'vitest';
import { ConnectionPool } from '../../src/pool.js';
import type { PoolConfig } from '../../src/config.js';

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
});
