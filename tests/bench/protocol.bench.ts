/**
 * Protocol Benchmarks
 *
 * Measures performance of wire protocol operations.
 */

import { describe, bench } from 'vitest';
import {
  parseFrame,
  buildHelloMessage,
  buildRunGQLMessage,
  buildPullMessage,
  buildBeginMessage,
  buildCommitMessage,
  buildRollbackMessage,
  buildSavepointMessage,
  buildPingMessage,
  serializeMessage,
  rewritePlaceholders,
  countPlaceholders,
  getColumnsFromSchema,
  RespType,
} from '../../src/protocol.js';
import type { GeodeConfig } from '../../src/config.js';

// Test fixtures
const sampleConfig: GeodeConfig = {
  host: 'localhost',
  port: 3141,
  pageSize: 1000,
  helloName: 'geode-nodejs',
  helloVersion: '1.0.0',
  conformance: 'min',
  username: 'admin',
  password: 'secret',
};

const schemaFrame = JSON.stringify({
  status_class: '00000',
  status_subclass: '000',
  result: {
    type: 'SCHEMA',
    columns: [
      { name: 'id', type: 'INT' },
      { name: 'name', type: 'STRING' },
      { name: 'age', type: 'INT' },
      { name: 'email', type: 'STRING' },
      { name: 'active', type: 'BOOL' },
    ],
  },
});

const bindingsFrame = JSON.stringify({
  status_class: '00000',
  status_subclass: '000',
  result: {
    type: 'BINDINGS',
    rows: Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `User ${i}`,
      age: 20 + (i % 50),
      email: `user${i}@example.com`,
      active: i % 2 === 0,
    })),
    final: false,
    ordered: true,
    order_keys: ['id'],
  },
});

const errorFrame = JSON.stringify({
  status_class: '42000',
  status_subclass: '001',
  result: {
    type: 'ERROR',
    code: 'SyntaxError',
    message: 'Unexpected token at line 1, column 15',
    anchor: 'MATCH (n RETURN n',
    additional: [{ code: 'E001', message: 'Missing closing parenthesis' }],
    flagger_findings: ['Warning: deprecated syntax'],
  },
});

const simpleQuery = 'MATCH (n:Person) RETURN n';
const parameterizedQuery =
  'MATCH (n:Person) WHERE n.age > ? AND n.name = ? AND n.active = ? RETURN n LIMIT ?';
const complexQuery = `
MATCH (a:Person)-[:KNOWS]->(b:Person)-[:WORKS_AT]->(c:Company)
WHERE a.age > $minAge AND b.name CONTAINS $nameFilter
WITH a, b, c, count(*) AS cnt
ORDER BY cnt DESC
LIMIT $limit
RETURN a.name AS person, collect(b.name) AS friends, c.name AS company
`;

describe('Protocol Benchmarks', () => {
  describe('Frame Parsing', () => {
    bench('parse SCHEMA frame', () => {
      parseFrame(schemaFrame);
    });

    bench('parse BINDINGS frame (100 rows)', () => {
      parseFrame(bindingsFrame);
    });

    bench('parse ERROR frame', () => {
      parseFrame(errorFrame);
    });

    bench('parse frame from Buffer', () => {
      parseFrame(Buffer.from(schemaFrame));
    });
  });

  describe('Message Building', () => {
    bench('build HELLO message', () => {
      buildHelloMessage(sampleConfig);
    });

    bench('build HELLO message with credentials', () => {
      buildHelloMessage({ ...sampleConfig, username: 'admin', password: 'secret' });
    });

    bench('build RUN_GQL message (simple)', () => {
      buildRunGQLMessage(simpleQuery);
    });

    bench('build RUN_GQL message (with params)', () => {
      buildRunGQLMessage('MATCH (n) WHERE n.id = $id RETURN n', { id: 123 });
    });

    bench('build RUN_GQL message (many params)', () => {
      buildRunGQLMessage(complexQuery, {
        minAge: 21,
        nameFilter: 'Alice',
        limit: 100,
      });
    });

    bench('build PULL message', () => {
      buildPullMessage(1, 1000);
    });

    bench('build BEGIN message', () => {
      buildBeginMessage();
    });

    bench('build COMMIT message', () => {
      buildCommitMessage();
    });

    bench('build ROLLBACK message', () => {
      buildRollbackMessage();
    });

    bench('build SAVEPOINT message', () => {
      buildSavepointMessage('sp1');
    });

    bench('build PING message', () => {
      buildPingMessage();
    });
  });

  describe('Message Serialization', () => {
    const helloMsg = buildHelloMessage(sampleConfig);
    const runMsg = buildRunGQLMessage(complexQuery, {
      minAge: 21,
      nameFilter: 'Alice',
      limit: 100,
    });
    const pullMsg = buildPullMessage(1, 1000);

    bench('serialize HELLO message', () => {
      serializeMessage(helloMsg);
    });

    bench('serialize RUN_GQL message', () => {
      serializeMessage(runMsg);
    });

    bench('serialize PULL message', () => {
      serializeMessage(pullMsg);
    });
  });

  describe('Placeholder Handling', () => {
    bench('count placeholders (none)', () => {
      countPlaceholders(simpleQuery);
    });

    bench('count placeholders (4)', () => {
      countPlaceholders(parameterizedQuery);
    });

    bench('count placeholders (with string literals)', () => {
      countPlaceholders("MATCH (n) WHERE n.name = '?' AND n.id = ? RETURN n");
    });

    bench('rewrite placeholders (4 params)', () => {
      rewritePlaceholders(parameterizedQuery, [21, 'Alice', true, 10]);
    });

    bench('rewrite placeholders (10 params)', () => {
      rewritePlaceholders(
        'MATCH (n) WHERE n.a = ? AND n.b = ? AND n.c = ? AND n.d = ? AND n.e = ? AND n.f = ? AND n.g = ? AND n.h = ? AND n.i = ? AND n.j = ? RETURN n',
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      );
    });
  });

  describe('Schema Processing', () => {
    const frame = parseFrame(schemaFrame);

    bench('get columns from schema (5 columns)', () => {
      getColumnsFromSchema(frame);
    });
  });
});
