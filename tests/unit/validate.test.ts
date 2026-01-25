import { describe, it, expect } from 'vitest';
import {
  validateQuery,
  validateParamName,
  validateParamValue,
  validateHostname,
  validatePort,
  validatePageSize,
  validateSavepointName,
  sanitizeForLog,
} from '../../src/validate.js';
import { SecurityError } from '../../src/errors.js';

describe('validate', () => {
  describe('validateQuery', () => {
    it('should accept valid queries', () => {
      expect(() => validateQuery('MATCH (n) RETURN n')).not.toThrow();
      expect(() => validateQuery('CREATE (n:Person {name: "Alice"})')).not.toThrow();
      expect(() => validateQuery('MATCH (n)\nWHERE n.age > 21\nRETURN n')).not.toThrow();
    });

    it('should reject empty query', () => {
      expect(() => validateQuery('')).toThrow(SecurityError);
    });

    it('should reject query with null bytes', () => {
      expect(() => validateQuery('MATCH (n)\0RETURN n')).toThrow(SecurityError);
    });

    it('should reject query with control characters', () => {
      expect(() => validateQuery('MATCH (n)\x01RETURN n')).toThrow(SecurityError);
    });

    it('should allow common whitespace', () => {
      expect(() => validateQuery('MATCH (n)\n\t\r RETURN n')).not.toThrow();
    });

    it('should reject query exceeding max length', () => {
      const longQuery = 'MATCH (n) RETURN n'.repeat(100000);
      expect(() => validateQuery(longQuery)).toThrow(SecurityError);
    });
  });

  describe('validateParamName', () => {
    it('should accept valid parameter names', () => {
      expect(() => validateParamName('id')).not.toThrow();
      expect(() => validateParamName('user_name')).not.toThrow();
      expect(() => validateParamName('_private')).not.toThrow();
      expect(() => validateParamName('camelCase123')).not.toThrow();
    });

    it('should reject empty parameter name', () => {
      expect(() => validateParamName('')).toThrow(SecurityError);
    });

    it('should reject parameter name starting with digit', () => {
      expect(() => validateParamName('123abc')).toThrow(SecurityError);
    });

    it('should reject parameter name with special characters', () => {
      expect(() => validateParamName('foo-bar')).toThrow(SecurityError);
      expect(() => validateParamName('foo.bar')).toThrow(SecurityError);
      expect(() => validateParamName('foo@bar')).toThrow(SecurityError);
    });

    it('should reject reserved keywords', () => {
      expect(() => validateParamName('match')).toThrow(SecurityError);
      expect(() => validateParamName('RETURN')).toThrow(SecurityError);
      expect(() => validateParamName('Where')).toThrow(SecurityError);
      expect(() => validateParamName('create')).toThrow(SecurityError);
    });

    it('should reject parameter name exceeding max length', () => {
      const longName = 'a'.repeat(200);
      expect(() => validateParamName(longName)).toThrow(SecurityError);
    });
  });

  describe('validateParamValue', () => {
    it('should accept primitive values', () => {
      expect(() => validateParamValue(null)).not.toThrow();
      expect(() => validateParamValue(undefined)).not.toThrow();
      expect(() => validateParamValue(42)).not.toThrow();
      expect(() => validateParamValue(3.14)).not.toThrow();
      expect(() => validateParamValue(true)).not.toThrow();
      expect(() => validateParamValue('hello')).not.toThrow();
    });

    it('should accept arrays', () => {
      expect(() => validateParamValue([1, 2, 3])).not.toThrow();
      expect(() => validateParamValue(['a', 'b', 'c'])).not.toThrow();
      expect(() => validateParamValue([{ a: 1 }, { b: 2 }])).not.toThrow();
    });

    it('should accept objects', () => {
      expect(() => validateParamValue({ name: 'Alice', age: 30 })).not.toThrow();
      expect(() => validateParamValue({ nested: { deep: true } })).not.toThrow();
    });

    it('should reject string with null bytes', () => {
      expect(() => validateParamValue('hello\0world')).toThrow(SecurityError);
    });

    it('should reject circular references', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj['self'] = obj;
      expect(() => validateParamValue(obj)).toThrow(SecurityError);
    });

    it('should reject deeply nested values', () => {
      let obj: Record<string, unknown> = { value: 1 };
      for (let i = 0; i < 50; i++) {
        obj = { nested: obj };
      }
      expect(() => validateParamValue(obj)).toThrow(SecurityError);
    });
  });

  describe('validateHostname', () => {
    it('should accept valid hostnames', () => {
      expect(() => validateHostname('localhost')).not.toThrow();
      expect(() => validateHostname('example.com')).not.toThrow();
      expect(() => validateHostname('sub.domain.example.com')).not.toThrow();
      expect(() => validateHostname('my-server')).not.toThrow();
    });

    it('should accept valid IPv4 addresses', () => {
      expect(() => validateHostname('127.0.0.1')).not.toThrow();
      expect(() => validateHostname('192.168.1.1')).not.toThrow();
      expect(() => validateHostname('0.0.0.0')).not.toThrow();
    });

    it('should accept valid IPv6 addresses', () => {
      expect(() => validateHostname('::1')).not.toThrow();
      expect(() => validateHostname('[::1]')).not.toThrow();
      expect(() => validateHostname('2001:db8::1')).not.toThrow();
    });

    it('should reject empty hostname', () => {
      expect(() => validateHostname('')).toThrow(SecurityError);
    });

    it('should reject hostname exceeding max length', () => {
      const longHostname = 'a'.repeat(300) + '.com';
      expect(() => validateHostname(longHostname)).toThrow(SecurityError);
    });

    it('should reject invalid IPv4 addresses', () => {
      expect(() => validateHostname('256.1.1.1')).toThrow(SecurityError);
      expect(() => validateHostname('1.1.1.999')).toThrow(SecurityError);
    });

    it('should reject hostnames with invalid characters', () => {
      expect(() => validateHostname('foo_bar.com')).toThrow(SecurityError);
      expect(() => validateHostname('foo bar.com')).toThrow(SecurityError);
    });
  });

  describe('validatePort', () => {
    it('should accept valid ports', () => {
      expect(() => validatePort(1)).not.toThrow();
      expect(() => validatePort(80)).not.toThrow();
      expect(() => validatePort(443)).not.toThrow();
      expect(() => validatePort(3141)).not.toThrow();
      expect(() => validatePort(65535)).not.toThrow();
    });

    it('should reject port below 1', () => {
      expect(() => validatePort(0)).toThrow(SecurityError);
      expect(() => validatePort(-1)).toThrow(SecurityError);
    });

    it('should reject port above 65535', () => {
      expect(() => validatePort(65536)).toThrow(SecurityError);
      expect(() => validatePort(100000)).toThrow(SecurityError);
    });

    it('should reject non-integer ports', () => {
      expect(() => validatePort(3.14)).toThrow(SecurityError);
      expect(() => validatePort(NaN)).toThrow(SecurityError);
    });
  });

  describe('validatePageSize', () => {
    it('should accept valid page sizes', () => {
      expect(() => validatePageSize(1)).not.toThrow();
      expect(() => validatePageSize(100)).not.toThrow();
      expect(() => validatePageSize(1000)).not.toThrow();
      expect(() => validatePageSize(100000)).not.toThrow();
    });

    it('should reject page size below 1', () => {
      expect(() => validatePageSize(0)).toThrow(SecurityError);
      expect(() => validatePageSize(-1)).toThrow(SecurityError);
    });

    it('should reject page size above max', () => {
      expect(() => validatePageSize(200000)).toThrow(SecurityError);
    });

    it('should reject non-integer page sizes', () => {
      expect(() => validatePageSize(100.5)).toThrow(SecurityError);
    });
  });

  describe('validateSavepointName', () => {
    it('should accept valid savepoint names', () => {
      expect(() => validateSavepointName('sp1')).not.toThrow();
      expect(() => validateSavepointName('my_savepoint')).not.toThrow();
      expect(() => validateSavepointName('_private')).not.toThrow();
    });

    it('should reject empty savepoint name', () => {
      expect(() => validateSavepointName('')).toThrow(SecurityError);
    });

    it('should reject savepoint name exceeding max length', () => {
      const longName = 'a'.repeat(200);
      expect(() => validateSavepointName(longName)).toThrow(SecurityError);
    });

    it('should reject savepoint name with invalid characters', () => {
      expect(() => validateSavepointName('save-point')).toThrow(SecurityError);
      expect(() => validateSavepointName('save.point')).toThrow(SecurityError);
      expect(() => validateSavepointName('123sp')).toThrow(SecurityError);
    });
  });

  describe('sanitizeForLog', () => {
    it('should mask password patterns', () => {
      const input = 'connection: password=secret123';
      const result = sanitizeForLog(input);
      expect(result).toBe('connection: password=***');
      expect(result).not.toContain('secret123');
    });

    it('should mask token patterns', () => {
      const input = 'auth: token=abc123xyz';
      const result = sanitizeForLog(input);
      expect(result).toBe('auth: token=***');
    });

    it('should mask secret patterns', () => {
      const input = 'config: secret=mySecret';
      const result = sanitizeForLog(input);
      expect(result).toBe('config: secret=***');
    });

    it('should mask api_key patterns', () => {
      const input = 'api_key=key123';
      const result = sanitizeForLog(input);
      expect(result).toBe('api_key=***');
    });

    it('should handle case insensitivity', () => {
      // Test with values that don't overlap with keywords
      const input = 'PASSWORD=mypass123 TOKEN=abc123 SECRET=xyz789';
      const result = sanitizeForLog(input);
      // Keywords should be preserved (lowercased), values should be masked
      expect(result).not.toContain('mypass123');
      expect(result).not.toContain('abc123');
      expect(result).not.toContain('xyz789');
      expect(result).toContain('password=***');
      expect(result).toContain('token=***');
      expect(result).toContain('secret=***');
    });

    it('should leave non-sensitive data unchanged', () => {
      const input = 'host=localhost port=3141 user=admin';
      const result = sanitizeForLog(input);
      expect(result).toBe(input);
    });
  });
});
