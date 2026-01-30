import { describe, it, expect } from 'vitest';
import {
  GQLValue,
  parseGQLType,
  fromJSON,
  parseRow,
  rowToObject,
  isSafeObjectKey,
  type GQLValueKind,
} from '../../src/types.js';

describe('types', () => {
  describe('GQLValue', () => {
    describe('factory methods', () => {
      it('should create null value', () => {
        const v = GQLValue.null();
        expect(v.kind).toBe('NULL');
        expect(v.isNull).toBe(true);
        expect(v.toJS()).toBeNull();
      });

      it('should create boolean values', () => {
        const t = GQLValue.bool(true);
        const f = GQLValue.bool(false);

        expect(t.kind).toBe('BOOL');
        expect(t.asBool).toBe(true);
        expect(f.asBool).toBe(false);
      });

      it('should create integer values', () => {
        const v1 = GQLValue.int(42);
        // Note: Use BigInt with string literal to preserve precision beyond MAX_SAFE_INTEGER
        const v2 = GQLValue.int(BigInt('9007199254740993'));

        expect(v1.kind).toBe('INT');
        expect(v1.asInt).toBe(42n);
        expect(v1.asNumber).toBe(42);
        expect(v2.asInt).toBe(BigInt('9007199254740993'));
      });

      it('should create float values', () => {
        const v = GQLValue.float(3.14);

        expect(v.kind).toBe('FLOAT');
        expect(v.asFloat).toBe(3.14);
        expect(v.asNumber).toBe(3.14);
      });

      it('should create string values', () => {
        const v = GQLValue.string('hello');

        expect(v.kind).toBe('STRING');
        expect(v.asString).toBe('hello');
      });

      it('should create decimal values', () => {
        const v = GQLValue.decimal('123.456');

        expect(v.kind).toBe('DECIMAL');
        expect(v.asDecimal.toString()).toBe('123.456');
        expect(v.asNumber).toBe(123.456);
      });

      it('should create array values', () => {
        const v = GQLValue.array([GQLValue.int(1), GQLValue.int(2), GQLValue.int(3)]);

        expect(v.kind).toBe('ARRAY');
        expect(v.asArray).toHaveLength(3);
        expect(v.asArray[0]?.asNumber).toBe(1);
      });

      it('should create object values', () => {
        const v = GQLValue.object({
          name: GQLValue.string('Alice'),
          age: GQLValue.int(30),
        });

        expect(v.kind).toBe('OBJECT');
        expect(v.asObject.get('name')?.asString).toBe('Alice');
        expect(v.asObject.get('age')?.asNumber).toBe(30);
      });

      it('should create bytes values', () => {
        const v = GQLValue.bytes(new Uint8Array([1, 2, 3]));

        expect(v.kind).toBe('BYTEA');
        expect(v.asBytes).toEqual(new Uint8Array([1, 2, 3]));
      });

      it('should create date values', () => {
        const date = new Date('2024-01-15');
        const v = GQLValue.date(date);

        expect(v.kind).toBe('DATE');
        expect(v.asDate).toEqual(date);
      });

      it('should create timestamp values', () => {
        const date = new Date('2024-01-15T10:30:00Z');
        const v = GQLValue.timestamp(date);

        expect(v.kind).toBe('TIMESTAMP');
        expect(v.asDate).toEqual(date);
      });

      it('should create UUID values', () => {
        const v = GQLValue.uuid('550e8400-e29b-41d4-a716-446655440000');

        expect(v.kind).toBe('UUID');
        expect(v.asString).toBe('550e8400-e29b-41d4-a716-446655440000');
      });

      it('should create JSON values', () => {
        const data = { foo: 'bar', count: 42 };
        const v = GQLValue.json(data);

        expect(v.kind).toBe('JSON');
        expect(v.asJSON).toEqual(data);
      });

      it('should create node values', () => {
        const node = {
          id: '123',
          labels: ['Person'],
          properties: { name: 'Alice' },
        };
        const v = GQLValue.node(node);

        expect(v.kind).toBe('NODE');
        expect(v.asNode).toEqual(node);
      });

      it('should create edge values', () => {
        const edge = {
          id: '456',
          type: 'KNOWS',
          startNode: '123',
          endNode: '789',
          properties: { since: 2020 },
        };
        const v = GQLValue.edge(edge);

        expect(v.kind).toBe('EDGE');
        expect(v.asEdge).toEqual(edge);
      });

      it('should create path values', () => {
        const path = {
          nodes: [{ id: '1', labels: ['A'], properties: {} }],
          edges: [],
        };
        const v = GQLValue.path(path);

        expect(v.kind).toBe('PATH');
        expect(v.asPath).toEqual(path);
      });

      it('should create range values', () => {
        const range = {
          lower: 1,
          upper: 10,
          lowerInclusive: true,
          upperInclusive: false,
        };
        const v = GQLValue.range(range);

        expect(v.kind).toBe('RANGE');
        expect(v.asRange).toEqual(range);
      });
    });

    describe('type accessors', () => {
      it('should throw on type mismatch', () => {
        const v = GQLValue.string('test');

        expect(() => v.asBool).toThrow(TypeError);
        expect(() => v.asInt).toThrow(TypeError);
        expect(() => v.asFloat).toThrow(TypeError);
        expect(() => v.asDecimal).toThrow(TypeError);
        expect(() => v.asArray).toThrow(TypeError);
        expect(() => v.asBytes).toThrow(TypeError);
        expect(() => v.asDate).toThrow(TypeError);
        expect(() => v.asNode).toThrow(TypeError);
        expect(() => v.asEdge).toThrow(TypeError);
        expect(() => v.asPath).toThrow(TypeError);
        expect(() => v.asRange).toThrow(TypeError);
        expect(() => v.asJSON).toThrow(TypeError);
      });
    });

    describe('toString', () => {
      it('should convert all types to string', () => {
        expect(GQLValue.null().toString()).toBe('null');
        expect(GQLValue.bool(true).toString()).toBe('true');
        expect(GQLValue.int(42).toString()).toBe('42');
        expect(GQLValue.float(3.14).toString()).toBe('3.14');
        expect(GQLValue.string('hello').toString()).toBe('hello');
        expect(GQLValue.decimal('123.456').toString()).toBe('123.456');
        expect(GQLValue.array([GQLValue.int(1), GQLValue.int(2)]).toString()).toBe('[1, 2]');
        expect(GQLValue.uuid('550e8400-e29b-41d4-a716-446655440000').toString()).toBe(
          '550e8400-e29b-41d4-a716-446655440000'
        );
      });
    });

    describe('toJS', () => {
      it('should convert to JS values', () => {
        expect(GQLValue.null().toJS()).toBeNull();
        expect(GQLValue.bool(true).toJS()).toBe(true);
        expect(GQLValue.int(42).toJS()).toBe(42);
        expect(GQLValue.float(3.14).toJS()).toBe(3.14);
        expect(GQLValue.string('hello').toJS()).toBe('hello');
      });

      it('should return bigint for large integers', () => {
        const large = GQLValue.int(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
        expect(typeof large.toJS()).toBe('bigint');
      });

      it('should convert arrays recursively', () => {
        const arr = GQLValue.array([GQLValue.int(1), GQLValue.string('two')]);
        expect(arr.toJS()).toEqual([1, 'two']);
      });

      it('should convert objects recursively', () => {
        const obj = GQLValue.object({
          a: GQLValue.int(1),
          b: GQLValue.string('two'),
        });
        expect(obj.toJS()).toEqual({ a: 1, b: 'two' });
      });
    });
  });

  describe('parseGQLType', () => {
    const testCases: Array<[string, GQLValueKind]> = [
      ['INT', 'INT'],
      ['INTEGER', 'INT'],
      ['BIGINT', 'INT'],
      ['FLOAT', 'FLOAT'],
      ['DOUBLE', 'FLOAT'],
      ['REAL', 'FLOAT'],
      ['DECIMAL', 'DECIMAL'],
      ['NUMERIC', 'DECIMAL'],
      ['STRING', 'STRING'],
      ['VARCHAR', 'STRING'],
      ['TEXT', 'STRING'],
      ['BOOL', 'BOOL'],
      ['BOOLEAN', 'BOOL'],
      ['NULL', 'NULL'],
      ['LIST', 'ARRAY'],
      ['ARRAY', 'ARRAY'],
      ['MAP', 'OBJECT'],
      ['RECORD', 'OBJECT'],
      ['OBJECT', 'OBJECT'],
      ['NODE', 'NODE'],
      ['EDGE', 'EDGE'],
      ['RELATIONSHIP', 'EDGE'],
      ['PATH', 'PATH'],
      ['BYTEA', 'BYTEA'],
      ['BINARY', 'BYTEA'],
      ['DATE', 'DATE'],
      ['TIME', 'TIME'],
      ['TIMETZ', 'TIMETZ'],
      ['TIMESTAMP', 'TIMESTAMP'],
      ['TIMESTAMPTZ', 'TIMESTAMPTZ'],
      ['INTERVAL', 'INTERVAL'],
      ['JSON', 'JSON'],
      ['JSONB', 'JSONB'],
      ['XML', 'XML'],
      ['UUID', 'UUID'],
      ['URL', 'URL'],
      ['DOMAIN', 'DOMAIN'],
      ['ENUM', 'ENUM'],
      ['BIT', 'BIT_STRING'],
      ['VARBIT', 'BIT_STRING'],
      ['INT_RANGE', 'RANGE'],
      ['UNKNOWN_TYPE', 'UNKNOWN'],
    ];

    it.each(testCases)('should parse %s as %s', (input, expected) => {
      expect(parseGQLType(input)).toBe(expected);
    });

    it('should be case-insensitive', () => {
      expect(parseGQLType('int')).toBe('INT');
      expect(parseGQLType('String')).toBe('STRING');
      expect(parseGQLType('BOOL')).toBe('BOOL');
    });
  });

  describe('fromJSON', () => {
    it('should convert null', () => {
      expect(fromJSON(null).kind).toBe('NULL');
      expect(fromJSON(undefined).kind).toBe('NULL');
    });

    it('should convert boolean', () => {
      expect(fromJSON(true).asBool).toBe(true);
      expect(fromJSON(false).asBool).toBe(false);
    });

    it('should convert integers', () => {
      expect(fromJSON(42).asNumber).toBe(42);
    });

    it('should convert floats', () => {
      expect(fromJSON(3.14).asNumber).toBe(3.14);
    });

    it('should convert bigint', () => {
      expect(fromJSON(BigInt(9007199254740993)).kind).toBe('INT');
    });

    it('should convert strings', () => {
      expect(fromJSON('hello').asString).toBe('hello');
    });

    it('should detect UUID strings', () => {
      const v = fromJSON('550e8400-e29b-41d4-a716-446655440000');
      expect(v.kind).toBe('UUID');
    });

    it('should detect ISO date strings', () => {
      const v = fromJSON('2024-01-15T10:30:00Z');
      expect(v.kind).toBe('TIMESTAMP');
    });

    it('should convert arrays', () => {
      const v = fromJSON([1, 2, 3]);
      expect(v.kind).toBe('ARRAY');
      expect(v.asArray).toHaveLength(3);
    });

    it('should convert objects', () => {
      const v = fromJSON({ a: 1, b: 'two' });
      expect(v.kind).toBe('OBJECT');
    });

    it('should detect node objects', () => {
      const v = fromJSON({ id: '1', labels: ['Person'], properties: {} });
      expect(v.kind).toBe('NODE');
    });

    it('should detect edge objects', () => {
      const v = fromJSON({
        id: '1',
        type: 'KNOWS',
        startNode: '2',
        endNode: '3',
        properties: {},
      });
      expect(v.kind).toBe('EDGE');
    });

    it('should detect path objects', () => {
      const v = fromJSON({ nodes: [], edges: [] });
      expect(v.kind).toBe('PATH');
    });

    it('should use type hint when provided', () => {
      const v = fromJSON('123', 'INT');
      expect(v.kind).toBe('INT');
      expect(v.asInt).toBe(123n);
    });
  });

  describe('parseRow', () => {
    it('should parse row with columns', () => {
      const raw = { id: 42, name: 'Alice', active: true };
      const columns = [
        { name: 'id', type: 'INT' as const, kind: 'INT' as const },
        { name: 'name', type: 'STRING' as const, kind: 'STRING' as const },
        { name: 'active', type: 'BOOL' as const, kind: 'BOOL' as const },
      ];

      const row = parseRow(raw, columns);

      expect(row.get('id')?.asNumber).toBe(42);
      expect(row.get('name')?.asString).toBe('Alice');
      expect(row.get('active')?.asBool).toBe(true);
    });
  });

  describe('rowToObject', () => {
    it('should convert row to plain object', () => {
      const row = new Map<string, GQLValue>([
        ['id', GQLValue.int(42)],
        ['name', GQLValue.string('Alice')],
      ]);

      const obj = rowToObject(row);

      expect(obj).toEqual({ id: 42, name: 'Alice' });
    });

    it('should preserve BigInt for large integers', () => {
      const largeId = BigInt('115974477121658528');
      const row = new Map<string, GQLValue>([
        ['id', GQLValue.int(largeId)],
        ['name', GQLValue.string('Alice')],
      ]);

      const obj = rowToObject(row);

      expect(obj['id']).toBe(largeId);
      expect(typeof obj['id']).toBe('bigint');
    });

    // GAP #17: Prototype pollution protection tests
    describe('prototype pollution protection', () => {
      describe('isSafeObjectKey', () => {
        it('should return false for __proto__', () => {
          expect(isSafeObjectKey('__proto__')).toBe(false);
        });

        it('should return false for constructor', () => {
          expect(isSafeObjectKey('constructor')).toBe(false);
        });

        it('should return false for prototype', () => {
          expect(isSafeObjectKey('prototype')).toBe(false);
        });

        it('should return true for normal keys', () => {
          expect(isSafeObjectKey('id')).toBe(true);
          expect(isSafeObjectKey('name')).toBe(true);
          expect(isSafeObjectKey('proto')).toBe(true); // Similar but not __proto__
          expect(isSafeObjectKey('construct')).toBe(true); // Similar but not constructor
        });
      });

      it('should reject __proto__ key to prevent prototype pollution', () => {
        const row = new Map<string, GQLValue>([
          ['__proto__', GQLValue.string('malicious')],
          ['name', GQLValue.string('Alice')],
        ]);

        expect(() => rowToObject(row)).toThrow(/prototype pollution/i);
      });

      it('should reject constructor key to prevent prototype pollution', () => {
        const row = new Map<string, GQLValue>([
          ['constructor', GQLValue.string('malicious')],
          ['name', GQLValue.string('Alice')],
        ]);

        expect(() => rowToObject(row)).toThrow(/prototype pollution/i);
      });

      it('should reject prototype key to prevent prototype pollution', () => {
        const row = new Map<string, GQLValue>([
          ['prototype', GQLValue.string('malicious')],
          ['name', GQLValue.string('Alice')],
        ]);

        expect(() => rowToObject(row)).toThrow(/prototype pollution/i);
      });

      it('should create prototype-free object (no Object.prototype inheritance)', () => {
        const row = new Map<string, GQLValue>([
          ['id', GQLValue.int(42)],
          ['toString', GQLValue.string('custom')], // Safe - not a dangerous key
        ]);

        const obj = rowToObject(row);

        // Verify object has no prototype
        expect(Object.getPrototypeOf(obj)).toBeNull();
        // Verify we can safely set keys that shadow Object.prototype methods
        expect(obj['toString']).toBe('custom');
        // Verify normal functionality works
        expect(obj['id']).toBe(42);
      });

      it('should allow normal keys that are not dangerous', () => {
        const row = new Map<string, GQLValue>([
          ['id', GQLValue.int(1)],
          ['proto', GQLValue.string('safe')], // Similar but not __proto__
          ['construct', GQLValue.string('safe')], // Similar but not constructor
          ['prototypes', GQLValue.string('safe')], // Similar but not prototype
        ]);

        const obj = rowToObject(row);

        expect(obj['id']).toBe(1);
        expect(obj['proto']).toBe('safe');
        expect(obj['construct']).toBe('safe');
        expect(obj['prototypes']).toBe('safe');
      });
    });
  });

  describe('Edge format normalization', () => {
    it('should detect edge with from/to properties', () => {
      const edge = {
        id: '018f6b1e-7c3a-7000-8000-000000000001',
        type: 'KNOWS',
        from: '018f6b1e-7c3a-7000-8000-000000000002',
        to: '018f6b1e-7c3a-7000-8000-000000000003',
        properties: { since: 2020 },
      };

      const v = fromJSON(edge);

      expect(v.kind).toBe('EDGE');
      expect(v.asEdge.id).toBe('018f6b1e-7c3a-7000-8000-000000000001');
      expect(v.asEdge.startNode).toBe('018f6b1e-7c3a-7000-8000-000000000002');
      expect(v.asEdge.endNode).toBe('018f6b1e-7c3a-7000-8000-000000000003');
      expect(v.asEdge.type).toBe('KNOWS');
    });

    it('should detect edge with startNode/endNode properties', () => {
      const edge = {
        id: '018f6b1e-7c3a-7000-8000-000000000001',
        type: 'KNOWS',
        startNode: '018f6b1e-7c3a-7000-8000-000000000002',
        endNode: '018f6b1e-7c3a-7000-8000-000000000003',
        properties: {},
      };

      const v = fromJSON(edge);

      expect(v.kind).toBe('EDGE');
      expect(v.asEdge.startNode).toBe('018f6b1e-7c3a-7000-8000-000000000002');
      expect(v.asEdge.endNode).toBe('018f6b1e-7c3a-7000-8000-000000000003');
    });

    it('should normalize from/to to startNode/endNode', () => {
      const edge = {
        id: 'edge-1',
        type: 'REL',
        from: 'node-1',
        to: 'node-2',
      };

      const v = fromJSON(edge);
      const normalized = v.asEdge;

      // Should have startNode/endNode, not from/to
      expect(normalized.startNode).toBe('node-1');
      expect(normalized.endNode).toBe('node-2');
      expect((normalized as unknown as { from?: string }).from).toBeUndefined();
      expect((normalized as unknown as { to?: string }).to).toBeUndefined();
    });

    it('should handle edge with type hint and from/to format', () => {
      const edge = {
        id: 'edge-1',
        type: 'REL',
        from: 'node-1',
        to: 'node-2',
      };

      const v = fromJSON(edge, 'EDGE');

      expect(v.kind).toBe('EDGE');
      expect(v.asEdge.startNode).toBe('node-1');
      expect(v.asEdge.endNode).toBe('node-2');
    });

    it('should handle missing properties in edge', () => {
      const edge = {
        id: 'edge-1',
        type: 'REL',
        from: 'node-1',
        to: 'node-2',
        // no properties field
      };

      const v = fromJSON(edge);

      expect(v.kind).toBe('EDGE');
      expect(v.asEdge.properties).toEqual({});
    });
  });

  describe('UUIDv7 ID support', () => {
    // UUIDv7 format: time-based UUID
    const uuidv7Node1 = '018f6b1e-7c3a-7000-8000-000000000001';
    const uuidv7Node2 = '018f6b1e-7c3a-7000-8000-000000000002';
    const uuidv7Edge = '018f6b1e-7c3a-7000-8000-000000000003';

    it('should handle UUIDv7 node IDs', () => {
      const node = {
        id: uuidv7Node1,
        labels: ['Person'],
        properties: { name: 'Alice' },
      };

      const v = fromJSON(node);

      expect(v.kind).toBe('NODE');
      expect(v.asNode.id).toBe(uuidv7Node1);
    });

    it('should handle UUIDv7 edge IDs and references', () => {
      const edge = {
        id: uuidv7Edge,
        type: 'KNOWS',
        from: uuidv7Node1,
        to: uuidv7Node2,
        properties: {},
      };

      const v = fromJSON(edge);

      expect(v.kind).toBe('EDGE');
      expect(v.asEdge.id).toBe(uuidv7Edge);
      expect(v.asEdge.startNode).toBe(uuidv7Node1);
      expect(v.asEdge.endNode).toBe(uuidv7Node2);
    });

    it('should preserve UUIDv7 equality between edge and node references', () => {
      const node = {
        id: uuidv7Node1,
        labels: ['Person'],
        properties: {},
      };
      const edge = {
        id: uuidv7Edge,
        type: 'KNOWS',
        from: uuidv7Node1,
        to: uuidv7Node2,
        properties: {},
      };

      const nodeValue = fromJSON(node);
      const edgeValue = fromJSON(edge);

      // Critical: edge.startNode must equal node.id
      expect(edgeValue.asEdge.startNode).toBe(nodeValue.asNode.id);
    });

    it('should detect UUIDv7 as UUID type when standalone', () => {
      const v = fromJSON(uuidv7Node1);

      expect(v.kind).toBe('UUID');
      expect(v.asString).toBe(uuidv7Node1);
    });
  });

  describe('BigInt support', () => {
    it('should handle BigInt values in GQLValue.int', () => {
      const largeId = BigInt('115974477121658528');
      const v = GQLValue.int(largeId);

      expect(v.kind).toBe('INT');
      expect(v.asInt).toBe(largeId);
      expect(typeof v.toJS()).toBe('bigint');
      expect(v.toJS()).toBe(largeId);
    });

    it('should convert safe integers to number in toJS', () => {
      const safeInt = 42;
      const v = GQLValue.int(safeInt);

      expect(typeof v.toJS()).toBe('number');
      expect(v.toJS()).toBe(42);
    });

    it('should handle BigInt at MAX_SAFE_INTEGER boundary', () => {
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      const beyondSafe = maxSafe + 1n;

      const vSafe = GQLValue.int(maxSafe);
      const vBeyond = GQLValue.int(beyondSafe);

      // MAX_SAFE_INTEGER fits in number
      expect(typeof vSafe.toJS()).toBe('number');
      // MAX_SAFE_INTEGER + 1 requires bigint
      expect(typeof vBeyond.toJS()).toBe('bigint');
    });

    it('should handle BigInt in fromJSON', () => {
      const largeId = BigInt('115974477121658528');
      const v = fromJSON(largeId);

      expect(v.kind).toBe('INT');
      expect(v.asInt).toBe(largeId);
    });

    it('should handle node with BigInt ID', () => {
      const largeId = BigInt('115974477121658528');
      const node = {
        id: largeId,
        labels: ['Person'],
        properties: { name: 'Alice' },
      };

      const v = fromJSON(node);

      expect(v.kind).toBe('NODE');
      expect(v.asNode.id).toBe(largeId);
    });

    it('should handle edge with BigInt IDs', () => {
      const edgeId = BigInt('115974480466781936');
      const startId = BigInt('115974477121658528');
      const endId = BigInt('115974478359077120');

      const edge = {
        id: edgeId,
        type: 'KNOWS',
        startNode: startId,
        endNode: endId,
        properties: {},
      };

      const v = fromJSON(edge);

      expect(v.kind).toBe('EDGE');
      expect(v.asEdge.id).toBe(edgeId);
      expect(v.asEdge.startNode).toBe(startId);
      expect(v.asEdge.endNode).toBe(endId);
    });

    it('should convert large string to BigInt with INT type hint', () => {
      const largeIdStr = '115974477121658528';
      const v = fromJSON(largeIdStr, 'INT');

      expect(v.kind).toBe('INT');
      expect(v.asInt).toBe(BigInt(largeIdStr));
    });

    it('should preserve BigInt through parseRow', () => {
      const largeId = BigInt('115974477121658528');
      const raw = { id: largeId };
      const columns = [{ name: 'id', type: 'INT' as const, kind: 'INT' as const }];

      const row = parseRow(raw, columns);

      expect(row.get('id')?.asInt).toBe(largeId);
    });
  });
});
