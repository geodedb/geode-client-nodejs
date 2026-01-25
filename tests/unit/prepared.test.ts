/**
 * Unit tests for Prepared Statements
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreparedStatement, extractParameters, type ParameterInfo } from '../../src/prepared.js';
import type { Connection } from '../../src/connection.js';

// Mock connection - note: avoid naming conflicts with PreparedStatement.query getter
const createMockConnection = () => ({
  query: vi.fn().mockResolvedValue({ [Symbol.asyncIterator]: async function* () {} }),
  queryAll: vi.fn().mockResolvedValue([]),
  exec: vi.fn().mockResolvedValue(undefined),
  state: 'idle' as const,
});

describe('Prepared Statements', () => {
  describe('extractParameters', () => {
    it('should extract positional parameters', () => {
      const params = extractParameters('MATCH (n) WHERE n.x = ? AND n.y = ? RETURN n');

      expect(params).toHaveLength(2);
      expect(params[0]).toEqual({ name: 'p1', position: 1, positional: true });
      expect(params[1]).toEqual({ name: 'p2', position: 2, positional: true });
    });

    it('should extract named parameters', () => {
      const params = extractParameters('MATCH (n) WHERE n.x = $foo AND n.y = $bar RETURN n');

      expect(params).toHaveLength(2);
      expect(params[0]).toEqual({ name: 'foo', position: 1, positional: false });
      expect(params[1]).toEqual({ name: 'bar', position: 2, positional: false });
    });

    it('should handle mixed parameters', () => {
      const params = extractParameters('MATCH (n) WHERE n.x = ? AND n.y = $name RETURN n');

      expect(params).toHaveLength(2);
      expect(params[0]).toEqual({ name: 'p1', position: 1, positional: true });
      expect(params[1]).toEqual({ name: 'name', position: 2, positional: false });
    });

    it('should not extract parameters from string literals', () => {
      const params = extractParameters("MATCH (n) WHERE n.x = '?' AND n.y = $name RETURN n");

      expect(params).toHaveLength(1);
      expect(params[0]).toEqual({ name: 'name', position: 1, positional: false });
    });

    it('should not extract parameters from double-quoted strings', () => {
      const params = extractParameters('MATCH (n) WHERE n.x = "?" AND n.y = $name RETURN n');

      expect(params).toHaveLength(1);
      expect(params[0]).toEqual({ name: 'name', position: 1, positional: false });
    });

    it('should handle escaped quotes in strings', () => {
      const params = extractParameters(
        "MATCH (n) WHERE n.x = 'can\\'t ?' AND n.y = $name RETURN n"
      );

      expect(params).toHaveLength(1);
      expect(params[0].name).toBe('name');
    });

    it('should skip line comments', () => {
      const params = extractParameters(`
        MATCH (n) // WHERE n.x = ?
        WHERE n.y = $name
        RETURN n
      `);

      expect(params).toHaveLength(1);
      expect(params[0].name).toBe('name');
    });

    it('should skip block comments', () => {
      const params = extractParameters(`
        MATCH (n) /* WHERE n.x = ? */
        WHERE n.y = $name
        RETURN n
      `);

      expect(params).toHaveLength(1);
      expect(params[0].name).toBe('name');
    });

    it('should deduplicate named parameters', () => {
      const params = extractParameters('MATCH (n) WHERE n.x = $name OR n.y = $name RETURN n');

      expect(params).toHaveLength(1);
      expect(params[0].name).toBe('name');
    });

    it('should return empty array for no parameters', () => {
      const params = extractParameters('MATCH (n) RETURN n');

      expect(params).toHaveLength(0);
    });

    it('should handle complex parameter names', () => {
      const params = extractParameters(
        'MATCH (n) WHERE n.x = $user_id AND n.y = $item123 RETURN n'
      );

      expect(params).toHaveLength(2);
      expect(params[0].name).toBe('user_id');
      expect(params[1].name).toBe('item123');
    });
  });

  describe('PreparedStatement', () => {
    let mockConn: ReturnType<typeof createMockConnection>;
    let stmt: PreparedStatement;

    beforeEach(() => {
      mockConn = createMockConnection();
    });

    it('should create a prepared statement', () => {
      stmt = new PreparedStatement(mockConn as unknown as Connection, 'MATCH (n) RETURN n');

      expect(stmt.query).toBe('MATCH (n) RETURN n');
      expect(stmt.parameterCount).toBe(0);
      expect(stmt.isClosed).toBe(false);
    });

    it('should track parameters', () => {
      stmt = new PreparedStatement(
        mockConn as unknown as Connection,
        'MATCH (n) WHERE n.x = $name AND n.y = ? RETURN n'
      );

      expect(stmt.parameterCount).toBe(2);
      expect(stmt.positionalCount).toBe(1);
      expect(stmt.namedParameters).toEqual(['name']);
    });

    it('should execute with named parameters', async () => {
      stmt = new PreparedStatement(
        mockConn as unknown as Connection,
        'MATCH (n) WHERE n.x = $name RETURN n'
      );

      await stmt.executeAll({ name: 'Alice' });

      expect(mockConn.queryAll).toHaveBeenCalledWith(
        'MATCH (n) WHERE n.x = $name RETURN n',
        expect.objectContaining({ params: { name: 'Alice' } })
      );
    });

    it('should execute with positional parameters', async () => {
      stmt = new PreparedStatement(
        mockConn as unknown as Connection,
        'MATCH (n) WHERE n.x = ? RETURN n'
      );

      await stmt.executeAll(['Alice']);

      expect(mockConn.queryAll).toHaveBeenCalledWith(
        'MATCH (n) WHERE n.x = ? RETURN n',
        expect.objectContaining({ params: { p1: 'Alice' } })
      );
    });

    it('should throw on missing named parameter', async () => {
      stmt = new PreparedStatement(
        mockConn as unknown as Connection,
        'MATCH (n) WHERE n.x = $name AND n.y = $age RETURN n'
      );

      await expect(stmt.executeAll({ name: 'Alice' })).rejects.toThrow(
        'Missing required parameter: age'
      );
    });

    it('should throw on wrong positional parameter count', async () => {
      stmt = new PreparedStatement(
        mockConn as unknown as Connection,
        'MATCH (n) WHERE n.x = ? AND n.y = ? RETURN n'
      );

      await expect(stmt.executeAll(['Alice'])).rejects.toThrow(
        'Expected 2 positional parameters, got 1'
      );
    });

    it('should throw on missing parameters when parameters expected', async () => {
      stmt = new PreparedStatement(
        mockConn as unknown as Connection,
        'MATCH (n) WHERE n.x = $name RETURN n'
      );

      await expect(stmt.executeAll()).rejects.toThrow('Expected 1 parameters, got 0');
    });

    it('should validate parameters without executing', () => {
      stmt = new PreparedStatement(
        mockConn as unknown as Connection,
        'MATCH (n) WHERE n.x = $name RETURN n'
      );

      expect(() => stmt.validate({ name: 'Alice' })).not.toThrow();
      expect(() => stmt.validate({})).toThrow('Missing required parameter');
    });

    it('should close the statement', () => {
      stmt = new PreparedStatement(mockConn as unknown as Connection, 'MATCH (n) RETURN n');

      expect(stmt.isClosed).toBe(false);
      stmt.close();
      expect(stmt.isClosed).toBe(true);
    });

    it('should throw on executing closed statement', async () => {
      stmt = new PreparedStatement(mockConn as unknown as Connection, 'MATCH (n) RETURN n');
      stmt.close();

      await expect(stmt.executeAll()).rejects.toThrow('PreparedStatement is closed');
    });

    it('should execute exec without returning rows', async () => {
      stmt = new PreparedStatement(
        mockConn as unknown as Connection,
        'CREATE (n:Person {name: $name})'
      );

      await stmt.exec({ name: 'Alice' });

      expect(mockConn.exec).toHaveBeenCalled();
    });

    it('should throw on invalid query', () => {
      expect(() => new PreparedStatement(mockConn as unknown as Connection, '')).toThrow();
    });

    it('should accept no parameters when none expected', async () => {
      stmt = new PreparedStatement(mockConn as unknown as Connection, 'MATCH (n) RETURN n');

      await stmt.executeAll();

      expect(mockConn.queryAll).toHaveBeenCalledWith(
        'MATCH (n) RETURN n',
        expect.objectContaining({ params: {} })
      );
    });

    it('should provide parameter info', () => {
      stmt = new PreparedStatement(
        mockConn as unknown as Connection,
        'MATCH (n) WHERE n.x = ? AND n.y = $name RETURN n'
      );

      expect(stmt.parameters).toHaveLength(2);
      expect(stmt.parameters[0].positional).toBe(true);
      expect(stmt.parameters[1].positional).toBe(false);
    });
  });
});
