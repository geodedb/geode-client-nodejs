/**
 * Type System Benchmarks
 *
 * Measures performance of GQL type conversions.
 */

import { describe, bench } from 'vitest';
import {
  GQLValue,
  parseGQLType,
  fromJSON,
  parseRow,
  rowToObject,
  type ColumnInfo,
} from '../../src/types.js';

// Test fixtures
const sampleObject = {
  id: 123,
  name: 'Alice Johnson',
  age: 30,
  email: 'alice@example.com',
  active: true,
  score: 95.5,
  tags: ['developer', 'team-lead', 'mentor'],
  metadata: {
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-06-20T15:45:00Z',
    version: 3,
  },
};

const sampleNode = {
  id: '12345',
  labels: ['Person', 'Employee'],
  properties: {
    name: 'Alice',
    age: 30,
    department: 'Engineering',
  },
};

const sampleEdge = {
  id: '67890',
  type: 'WORKS_AT',
  startNode: '12345',
  endNode: '99999',
  properties: {
    since: 2020,
    role: 'Senior Engineer',
  },
};

const samplePath = {
  nodes: [
    { id: '1', labels: ['A'], properties: { name: 'A' } },
    { id: '2', labels: ['B'], properties: { name: 'B' } },
    { id: '3', labels: ['C'], properties: { name: 'C' } },
  ],
  edges: [
    { id: 'e1', type: 'KNOWS', startNode: '1', endNode: '2', properties: {} },
    { id: 'e2', type: 'KNOWS', startNode: '2', endNode: '3', properties: {} },
  ],
};

const columns: ColumnInfo[] = [
  { name: 'id', type: 'INT', kind: 'INT' },
  { name: 'name', type: 'STRING', kind: 'STRING' },
  { name: 'age', type: 'INT', kind: 'INT' },
  { name: 'score', type: 'FLOAT', kind: 'FLOAT' },
  { name: 'active', type: 'BOOL', kind: 'BOOL' },
];

const rawRow = {
  id: 123,
  name: 'Alice',
  age: 30,
  score: 95.5,
  active: true,
};

describe('Type System Benchmarks', () => {
  describe('GQLValue Creation', () => {
    bench('create null', () => {
      GQLValue.null();
    });

    bench('create bool', () => {
      GQLValue.bool(true);
    });

    bench('create int (number)', () => {
      GQLValue.int(42);
    });

    bench('create int (bigint)', () => {
      GQLValue.int(BigInt(9007199254740993));
    });

    bench('create float', () => {
      GQLValue.float(3.14159265359);
    });

    bench('create string (short)', () => {
      GQLValue.string('hello');
    });

    bench('create string (long)', () => {
      GQLValue.string('a'.repeat(1000));
    });

    bench('create decimal', () => {
      GQLValue.decimal('123456789.123456789');
    });

    bench('create date', () => {
      GQLValue.date(new Date());
    });

    bench('create timestamp', () => {
      GQLValue.timestamp(new Date());
    });

    bench('create uuid', () => {
      GQLValue.uuid('550e8400-e29b-41d4-a716-446655440000');
    });

    bench('create array (10 elements)', () => {
      GQLValue.array([
        GQLValue.int(1),
        GQLValue.int(2),
        GQLValue.int(3),
        GQLValue.int(4),
        GQLValue.int(5),
        GQLValue.int(6),
        GQLValue.int(7),
        GQLValue.int(8),
        GQLValue.int(9),
        GQLValue.int(10),
      ]);
    });

    bench('create object (5 fields)', () => {
      GQLValue.object({
        id: GQLValue.int(123),
        name: GQLValue.string('Alice'),
        age: GQLValue.int(30),
        active: GQLValue.bool(true),
        score: GQLValue.float(95.5),
      });
    });

    bench('create node', () => {
      GQLValue.node(sampleNode);
    });

    bench('create edge', () => {
      GQLValue.edge(sampleEdge);
    });

    bench('create path', () => {
      GQLValue.path(samplePath);
    });

    bench('create json', () => {
      GQLValue.json(sampleObject);
    });
  });

  describe('GQLValue Accessors', () => {
    const intVal = GQLValue.int(42);
    const floatVal = GQLValue.float(3.14);
    const strVal = GQLValue.string('hello world');
    const arrVal = GQLValue.array([GQLValue.int(1), GQLValue.int(2), GQLValue.int(3)]);
    const objVal = GQLValue.object({
      a: GQLValue.int(1),
      b: GQLValue.string('two'),
    });

    bench('access int as bigint', () => {
      intVal.asInt;
    });

    bench('access int as number', () => {
      intVal.asNumber;
    });

    bench('access float', () => {
      floatVal.asFloat;
    });

    bench('access string', () => {
      strVal.asString;
    });

    bench('access array', () => {
      arrVal.asArray;
    });

    bench('access object', () => {
      objVal.asObject;
    });

    bench('check isNull', () => {
      intVal.isNull;
    });
  });

  describe('GQLValue Conversion', () => {
    const intVal = GQLValue.int(42);
    const objVal = GQLValue.object({
      id: GQLValue.int(123),
      name: GQLValue.string('Alice'),
      nested: GQLValue.object({
        a: GQLValue.int(1),
        b: GQLValue.array([GQLValue.int(1), GQLValue.int(2)]),
      }),
    });
    const arrVal = GQLValue.array(Array.from({ length: 100 }, (_, i) => GQLValue.int(i)));

    bench('int toJS', () => {
      intVal.toJS();
    });

    bench('int toString', () => {
      intVal.toString();
    });

    bench('object toJS (nested)', () => {
      objVal.toJS();
    });

    bench('object toString (nested)', () => {
      objVal.toString();
    });

    bench('array toJS (100 elements)', () => {
      arrVal.toJS();
    });

    bench('toJSON', () => {
      objVal.toJSON();
    });
  });

  describe('Type Parsing', () => {
    bench('parseGQLType INT', () => {
      parseGQLType('INT');
    });

    bench('parseGQLType STRING', () => {
      parseGQLType('STRING');
    });

    bench('parseGQLType NODE', () => {
      parseGQLType('NODE');
    });

    bench('parseGQLType TIMESTAMP WITH TIME ZONE', () => {
      parseGQLType('TIMESTAMP WITH TIME ZONE');
    });

    bench('parseGQLType UNKNOWN', () => {
      parseGQLType('CUSTOM_TYPE');
    });
  });

  describe('JSON Conversion', () => {
    bench('fromJSON null', () => {
      fromJSON(null);
    });

    bench('fromJSON boolean', () => {
      fromJSON(true);
    });

    bench('fromJSON integer', () => {
      fromJSON(42);
    });

    bench('fromJSON float', () => {
      fromJSON(3.14);
    });

    bench('fromJSON string', () => {
      fromJSON('hello world');
    });

    bench('fromJSON UUID string', () => {
      fromJSON('550e8400-e29b-41d4-a716-446655440000');
    });

    bench('fromJSON ISO date string', () => {
      fromJSON('2024-01-15T10:30:00Z');
    });

    bench('fromJSON array (10 elements)', () => {
      fromJSON([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    bench('fromJSON object (simple)', () => {
      fromJSON({ id: 123, name: 'Alice', active: true });
    });

    bench('fromJSON object (complex)', () => {
      fromJSON(sampleObject);
    });

    bench('fromJSON node detection', () => {
      fromJSON(sampleNode);
    });

    bench('fromJSON edge detection', () => {
      fromJSON(sampleEdge);
    });

    bench('fromJSON path detection', () => {
      fromJSON(samplePath);
    });

    bench('fromJSON with type hint', () => {
      fromJSON('123', 'INT');
    });
  });

  describe('Row Processing', () => {
    bench('parseRow (5 columns)', () => {
      parseRow(rawRow, columns);
    });

    bench('parseRow (large row - 20 columns)', () => {
      const largeColumns: ColumnInfo[] = Array.from(
        { length: 20 },
        (_, i) =>
          ({
            name: `col${i}`,
            type: i % 3 === 0 ? 'INT' : i % 3 === 1 ? 'STRING' : 'BOOL',
            kind: i % 3 === 0 ? 'INT' : i % 3 === 1 ? 'STRING' : 'BOOL',
          }) as ColumnInfo
      );

      const largeRow: Record<string, unknown> = {};
      for (let i = 0; i < 20; i++) {
        largeRow[`col${i}`] = i % 3 === 0 ? i : i % 3 === 1 ? `value${i}` : i % 2 === 0;
      }

      parseRow(largeRow, largeColumns);
    });

    const row = parseRow(rawRow, columns);

    bench('rowToObject (5 columns)', () => {
      rowToObject(row);
    });
  });
});
