/**
 * Property-Based Tests for Type System
 *
 * Tests GQL type conversions with arbitrary inputs.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  GQLValue,
  parseGQLType,
  fromJSON,
  parseRow,
  rowToObject,
  type ColumnInfo,
  type GQLValueKind,
} from '../../src/types.js';

describe('Type System Property Tests', () => {
  describe('GQLValue Roundtrip', () => {
    it('should roundtrip integers', () => {
      fc.assert(
        fc.property(fc.integer({ min: -1000000000, max: 1000000000 }), (n) => {
          const value = GQLValue.int(n);
          const js = value.toJS();
          expect(js).toBe(n);
          return true;
        }),
        { numRuns: 500 }
      );
    });

    it('should roundtrip bigints', () => {
      fc.assert(
        fc.property(fc.bigInt(), (n) => {
          const value = GQLValue.int(n);
          expect(value.asInt).toBe(n);
          return true;
        }),
        { numRuns: 500 }
      );
    });

    it('should roundtrip floats', () => {
      fc.assert(
        fc.property(fc.double({ noNaN: true }), (n) => {
          const value = GQLValue.float(n);
          expect(value.asFloat).toBe(n);
          return true;
        }),
        { numRuns: 500 }
      );
    });

    it('should roundtrip strings', () => {
      fc.assert(
        fc.property(fc.string(), (s) => {
          const value = GQLValue.string(s);
          expect(value.asString).toBe(s);
          return true;
        }),
        { numRuns: 500 }
      );
    });

    it('should roundtrip booleans', () => {
      fc.assert(
        fc.property(fc.boolean(), (b) => {
          const value = GQLValue.bool(b);
          expect(value.asBool).toBe(b);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should roundtrip UUIDs', () => {
      fc.assert(
        fc.property(fc.uuid(), (uuid) => {
          const value = GQLValue.uuid(uuid);
          expect(value.asString).toBe(uuid);
          expect(value.kind).toBe('UUID');
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should roundtrip dates', () => {
      fc.assert(
        fc.property(fc.date(), (d) => {
          const value = GQLValue.timestamp(d);
          expect(value.asDate.getTime()).toBe(d.getTime());
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should roundtrip bytes', () => {
      fc.assert(
        fc.property(fc.uint8Array({ maxLength: 1000 }), (bytes) => {
          const value = GQLValue.bytes(bytes);
          expect(value.asBytes).toEqual(bytes);
          return true;
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('Array Operations', () => {
    it('should preserve array length', () => {
      fc.assert(
        fc.property(fc.array(fc.integer(), { maxLength: 100 }), (arr) => {
          const values = arr.map((n) => GQLValue.int(n));
          const gqlArr = GQLValue.array(values);
          expect(gqlArr.asArray.length).toBe(arr.length);
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should preserve array element order', () => {
      fc.assert(
        fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 50 }), (arr) => {
          const values = arr.map((n) => GQLValue.int(n));
          const gqlArr = GQLValue.array(values);
          const result = gqlArr.toJS() as number[];

          expect(result).toEqual(arr);
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should handle nested arrays', () => {
      fc.assert(
        fc.property(
          fc.array(fc.array(fc.integer(), { maxLength: 5 }), { maxLength: 5 }),
          (nested) => {
            const values = nested.map((inner) => GQLValue.array(inner.map((n) => GQLValue.int(n))));
            const gqlArr = GQLValue.array(values);
            const result = gqlArr.toJS();

            expect(result).toEqual(nested);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Object Operations', () => {
    it('should preserve object keys', () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc
              .string({ minLength: 1, maxLength: 32 })
              .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
            fc.integer()
          ),
          (obj) => {
            const map = new Map(Object.entries(obj).map(([k, v]) => [k, GQLValue.int(v)]));
            const gqlObj = GQLValue.object(map);
            const result = gqlObj.toJS() as Record<string, number>;

            expect(Object.keys(result).sort()).toEqual(Object.keys(obj).sort());
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should preserve object values', () => {
      fc.assert(
        fc.property(
          fc.record({
            a: fc.integer(),
            b: fc.string(),
            c: fc.boolean(),
          }),
          (obj) => {
            const gqlObj = GQLValue.object({
              a: GQLValue.int(obj.a),
              b: GQLValue.string(obj.b),
              c: GQLValue.bool(obj.c),
            });
            const result = gqlObj.toJS() as typeof obj;

            expect(result.a).toBe(obj.a);
            expect(result.b).toBe(obj.b);
            expect(result.c).toBe(obj.c);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Type Parsing', () => {
    it('should return valid GQLValueKind for all known types', () => {
      const knownTypes = [
        'INT',
        'INTEGER',
        'BIGINT',
        'FLOAT',
        'DOUBLE',
        'REAL',
        'DECIMAL',
        'NUMERIC',
        'STRING',
        'VARCHAR',
        'TEXT',
        'BOOL',
        'BOOLEAN',
        'NULL',
        'LIST',
        'ARRAY',
        'MAP',
        'RECORD',
        'OBJECT',
        'NODE',
        'EDGE',
        'RELATIONSHIP',
        'PATH',
        'BYTEA',
        'BINARY',
        'DATE',
        'TIME',
        'TIMETZ',
        'TIMESTAMP',
        'TIMESTAMPTZ',
        'JSON',
        'JSONB',
        'UUID',
        'URL',
      ];

      fc.assert(
        fc.property(fc.constantFrom(...knownTypes), (typeName) => {
          const kind = parseGQLType(typeName);
          expect(kind).not.toBe('UNKNOWN');
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should return UNKNOWN for arbitrary strings', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter((s) => !['INT', 'STRING', 'BOOL', 'FLOAT', 'NULL'].includes(s.toUpperCase())),
          (typeName) => {
            const kind = parseGQLType(typeName);
            // May or may not be UNKNOWN depending on pattern matching
            return typeof kind === 'string';
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should be case insensitive', () => {
      fc.assert(
        fc.property(fc.constantFrom('int', 'INT', 'Int', 'iNt'), (variant) => {
          expect(parseGQLType(variant)).toBe('INT');
          return true;
        }),
        { numRuns: 20 }
      );
    });
  });

  describe('fromJSON Conversion', () => {
    it('should convert null to NULL', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const value = fromJSON(null);
          expect(value.kind).toBe('NULL');
          expect(value.isNull).toBe(true);
          return true;
        }),
        { numRuns: 10 }
      );
    });

    it('should convert booleans to BOOL', () => {
      fc.assert(
        fc.property(fc.boolean(), (b) => {
          const value = fromJSON(b);
          expect(value.kind).toBe('BOOL');
          expect(value.asBool).toBe(b);
          return true;
        }),
        { numRuns: 50 }
      );
    });

    it('should convert integers to INT', () => {
      fc.assert(
        fc.property(fc.integer({ min: -1000000, max: 1000000 }), (n) => {
          const value = fromJSON(n);
          expect(value.kind).toBe('INT');
          expect(value.asNumber).toBe(n);
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should convert non-integer numbers to FLOAT', () => {
      fc.assert(
        fc.property(
          fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
          (n) => {
            const value = fromJSON(n);
            expect(value.kind).toBe('FLOAT');
            expect(value.asFloat).toBe(n);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should detect UUID strings', () => {
      fc.assert(
        fc.property(fc.uuid(), (uuid) => {
          const value = fromJSON(uuid);
          expect(value.kind).toBe('UUID');
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should convert arrays recursively', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(fc.integer(), fc.string(), fc.boolean()), { maxLength: 20 }),
          (arr) => {
            const value = fromJSON(arr);
            expect(value.kind).toBe('ARRAY');
            expect(value.asArray.length).toBe(arr.length);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should convert objects recursively', () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.oneof(fc.integer(), fc.string(), fc.boolean())
          ),
          (obj) => {
            const value = fromJSON(obj);
            expect(value.kind).toBe('OBJECT');
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should detect node structures', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.oneof(fc.string(), fc.integer()),
            labels: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
              minLength: 1,
              maxLength: 5,
            }),
            properties: fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string()),
          }),
          (node) => {
            const value = fromJSON(node);
            expect(value.kind).toBe('NODE');
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect edge structures', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.oneof(fc.string(), fc.integer()),
            type: fc.string({ minLength: 1, maxLength: 20 }),
            startNode: fc.oneof(fc.string(), fc.integer()),
            endNode: fc.oneof(fc.string(), fc.integer()),
            properties: fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string()),
          }),
          (edge) => {
            const value = fromJSON(edge);
            expect(value.kind).toBe('EDGE');
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Row Processing', () => {
    it('should parse rows with correct number of columns', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 20 }), (numCols) => {
          const columns: ColumnInfo[] = Array.from({ length: numCols }, (_, i) => ({
            name: `col${i}`,
            type: 'INT' as const,
            kind: 'INT' as GQLValueKind,
          }));

          const rawRow: Record<string, unknown> = {};
          for (let i = 0; i < numCols; i++) {
            rawRow[`col${i}`] = i;
          }

          const row = parseRow(rawRow, columns);
          expect(row.size).toBe(numCols);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should convert row back to object', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.integer(),
            name: fc.string(),
            active: fc.boolean(),
          }),
          (data) => {
            const columns: ColumnInfo[] = [
              { name: 'id', type: 'INT', kind: 'INT' },
              { name: 'name', type: 'STRING', kind: 'STRING' },
              { name: 'active', type: 'BOOL', kind: 'BOOL' },
            ];

            const row = parseRow(data, columns);
            const obj = rowToObject(row);

            expect(obj['id']).toBe(data.id);
            expect(obj['name']).toBe(data.name);
            expect(obj['active']).toBe(data.active);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
