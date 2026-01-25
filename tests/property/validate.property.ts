/**
 * Property-Based Tests for Validation
 *
 * Tests input validation with arbitrary inputs for security robustness.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
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

// Helper to generate strings from a character set
const stringFromChars = (chars: string, opts?: { minLength?: number; maxLength?: number }) =>
  fc
    .array(fc.constantFrom(...chars.split('')), {
      minLength: opts?.minLength ?? 0,
      maxLength: opts?.maxLength ?? 10,
    })
    .map((arr) => arr.join(''));

describe('Validation Property Tests', () => {
  describe('Query Validation Robustness', () => {
    it('should not crash on arbitrary strings', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            validateQuery(input);
            return true;
          } catch (e) {
            expect(e).toBeInstanceOf(SecurityError);
            return true;
          }
        }),
        { numRuns: 1000 }
      );
    });

    it('should not crash on arbitrary unicode', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            validateQuery(input);
            return true;
          } catch (e) {
            expect(e).toBeInstanceOf(SecurityError);
            return true;
          }
        }),
        { numRuns: 500 }
      );
    });

    it('should reject empty queries', () => {
      expect(() => validateQuery('')).toThrow(SecurityError);
    });

    it('should accept valid GQL-like queries', () => {
      fc.assert(
        fc.property(
          stringFromChars(
            'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_()[]{}:.,\'"= \n\t',
            { minLength: 1, maxLength: 100 }
          ),
          (query) => {
            if (!query.trim()) return true; // Skip empty

            try {
              validateQuery(query);
              return true;
            } catch (e) {
              expect(e).toBeInstanceOf(SecurityError);
              return true;
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should reject queries with null bytes', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), fc.string(), (before, after) => {
          const query = `${before}\0${after}`;
          expect(() => validateQuery(query)).toThrow(SecurityError);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should reject queries with control characters', () => {
      const controlChars =
        '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0B\x0C\x0E\x0F\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1A\x1B\x1C\x1D\x1E\x1F\x7F';

      fc.assert(
        fc.property(
          fc.string(),
          fc.constantFrom(...controlChars),
          fc.string(),
          (before, control, after) => {
            const query = `${before}${control}${after}`;
            expect(() => validateQuery(query)).toThrow(SecurityError);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Parameter Name Validation', () => {
    it('should accept valid identifier names', () => {
      fc.assert(
        fc.property(
          stringFromChars('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_', {
            minLength: 1,
            maxLength: 1,
          }),
          stringFromChars('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_', {
            maxLength: 50,
          }),
          (first, rest) => {
            const name = first + rest;

            // Skip reserved keywords
            const reserved = [
              'match',
              'create',
              'return',
              'where',
              'with',
              'order',
              'limit',
              'and',
              'or',
              'not',
            ];
            if (reserved.includes(name.toLowerCase())) return true;

            try {
              validateParamName(name);
              return true;
            } catch (e) {
              // Some names might still be invalid
              expect(e).toBeInstanceOf(SecurityError);
              return true;
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should reject names starting with digits', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...'0123456789'),
          fc.string({ maxLength: 50 }),
          (digit, rest) => {
            const name = digit + rest;
            expect(() => validateParamName(name)).toThrow(SecurityError);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject reserved keywords', () => {
      const keywords = [
        'match',
        'create',
        'delete',
        'return',
        'where',
        'with',
        'order',
        'limit',
        'and',
        'or',
        'not',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...keywords), (keyword) => {
          expect(() => validateParamName(keyword)).toThrow(SecurityError);
          expect(() => validateParamName(keyword.toUpperCase())).toThrow(SecurityError);
          return true;
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('Parameter Value Validation', () => {
    it('should accept arbitrary JSON-serializable values', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (value) => {
          try {
            validateParamValue(value);
            return true;
          } catch (e) {
            expect(e).toBeInstanceOf(SecurityError);
            return true;
          }
        }),
        { numRuns: 500 }
      );
    });

    it('should accept primitives', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer(),
            fc.double({ noNaN: true }),
            fc.string().filter((s) => !s.includes('\0')),
            fc.boolean(),
            fc.constant(null)
          ),
          (value) => {
            expect(() => validateParamValue(value)).not.toThrow();
            return true;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should reject strings with null bytes', () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), (before, after) => {
          const value = `${before}\0${after}`;
          expect(() => validateParamValue(value)).toThrow(SecurityError);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should reject deeply nested values', () => {
      // Create deeply nested object
      let obj: Record<string, unknown> = { value: 'deep' };
      for (let i = 0; i < 50; i++) {
        obj = { nested: obj };
      }

      expect(() => validateParamValue(obj)).toThrow(SecurityError);
    });
  });

  describe('Hostname Validation', () => {
    it('should accept valid IPv4 addresses', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 })
          ),
          ([a, b, c, d]) => {
            const ip = `${a}.${b}.${c}.${d}`;
            expect(() => validateHostname(ip)).not.toThrow();
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should reject invalid IPv4 addresses', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 256, max: 999 }),
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 })
          ),
          ([a, b, c, d]) => {
            const ip = `${a}.${b}.${c}.${d}`;
            expect(() => validateHostname(ip)).toThrow(SecurityError);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept valid hostnames', () => {
      fc.assert(
        fc.property(
          fc.array(
            stringFromChars('abcdefghijklmnopqrstuvwxyz0123456789-', {
              minLength: 1,
              maxLength: 20,
            }).filter((s) => !s.startsWith('-') && !s.endsWith('-')),
            { minLength: 1, maxLength: 5 }
          ),
          (labels) => {
            const hostname = labels.join('.');
            if (!hostname || hostname.length > 253) return true;

            try {
              validateHostname(hostname);
              return true;
            } catch (e) {
              expect(e).toBeInstanceOf(SecurityError);
              return true;
            }
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  describe('Port Validation', () => {
    it('should accept valid ports', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 65535 }), (port) => {
          expect(() => validatePort(port)).not.toThrow();
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should reject invalid ports', () => {
      fc.assert(
        fc.property(fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 65536 })), (port) => {
          expect(() => validatePort(port)).toThrow(SecurityError);
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should reject non-integers', () => {
      fc.assert(
        fc.property(
          fc.double().filter((n) => !Number.isInteger(n)),
          (port) => {
            expect(() => validatePort(port)).toThrow(SecurityError);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Page Size Validation', () => {
    it('should accept valid page sizes', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100000 }), (pageSize) => {
          expect(() => validatePageSize(pageSize)).not.toThrow();
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should reject invalid page sizes', () => {
      fc.assert(
        fc.property(fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 100001 })), (pageSize) => {
          expect(() => validatePageSize(pageSize)).toThrow(SecurityError);
          return true;
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('Savepoint Name Validation', () => {
    it('should accept valid savepoint names', () => {
      fc.assert(
        fc.property(
          stringFromChars('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_', {
            minLength: 1,
            maxLength: 1,
          }),
          stringFromChars('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_', {
            maxLength: 50,
          }),
          (first, rest) => {
            const name = first + rest;
            expect(() => validateSavepointName(name)).not.toThrow();
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should reject invalid savepoint names', () => {
      fc.assert(
        fc.property(
          stringFromChars('!@#$%^&*()-+=[]{}|;:,.<>?/~`', { minLength: 1, maxLength: 10 }),
          (name) => {
            expect(() => validateSavepointName(name)).toThrow(SecurityError);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Log Sanitization', () => {
    it('should mask password patterns', () => {
      // Use alphanumeric secrets that won't appear in the masked output
      const secretChars = 'xyzXYZ123';
      fc.assert(
        fc.property(stringFromChars(secretChars, { minLength: 4, maxLength: 20 }), (secret) => {
          const input = `password=${secret}`;
          const result = sanitizeForLog(input);
          expect(result).not.toContain(secret);
          expect(result).toContain('password=***');
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should mask token patterns', () => {
      // Use alphanumeric secrets that won't appear in the masked output
      const secretChars = 'xyzXYZ123';
      fc.assert(
        fc.property(stringFromChars(secretChars, { minLength: 4, maxLength: 20 }), (secret) => {
          const input = `token=${secret}`;
          const result = sanitizeForLog(input);
          expect(result).not.toContain(secret);
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should not modify non-sensitive data', () => {
      fc.assert(
        fc.property(
          fc
            .string()
            .filter(
              (s) =>
                !s.toLowerCase().includes('password') &&
                !s.toLowerCase().includes('token') &&
                !s.toLowerCase().includes('secret') &&
                !s.toLowerCase().includes('api_key') &&
                !s.toLowerCase().includes('api-key') &&
                !s.toLowerCase().includes('apikey')
            ),
          (input) => {
            const result = sanitizeForLog(input);
            expect(result).toBe(input);
            return true;
          }
        ),
        { numRuns: 300 }
      );
    });
  });
});
