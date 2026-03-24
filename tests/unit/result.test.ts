/**
 * Unit tests for QueryResult module
 *
 * Tests async iteration, pagination, firstObject, collectRawRecords,
 * and helper methods (toArray, toObjects, forEach, map, filter, reduce).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Connection } from '../../src/connection.js';
import { MockTransport } from '../../src/transport.js';
import { QueryResult, QueryResultIterator } from '../../src/result.js';

/**
 * Helper: create a connected Connection with MockTransport.
 */
async function createConnection(): Promise<{ connection: Connection; transport: MockTransport }> {
  const transport = new MockTransport();
  transport.queueProtoResponse({
    hello: {
      success: true,
      sessionId: 'result-test-session',
      errorMessage: '',
      capabilities: ['gql'],
    },
  });

  const connection = await Connection.connectWithTransport(
    {
      host: 'localhost',
      port: 3141,
      pageSize: 100,
      transport: 'quic',
      helloName: 'test',
      helloVersion: '1.0.0',
      conformance: 'min',
      tls: true,
    },
    transport
  );

  return { connection, transport };
}

/**
 * Helper: queue schema + page responses and run query.
 */
async function runQuery(
  connection: Connection,
  transport: MockTransport,
  columns: Array<{ name: string; type: string }>,
  pages: Array<{
    rows: Array<{ values: unknown[] }>;
    final: boolean;
  }>
): Promise<QueryResult> {
  // Queue SCHEMA response
  transport.queueProtoResponse({
    execute: {
      schema: { columns },
    },
  });

  // Queue first page as inline response
  if (pages.length > 0) {
    transport.queueProtoResponse({
      execute: {
        page: {
          rows: pages[0]!.rows,
          final: pages[0]!.final,
          ordered: false,
          orderKeys: [],
        },
      },
    });
  }

  // Queue remaining pages as pull responses
  for (let i = 1; i < pages.length; i++) {
    transport.queueProtoResponse({
      pull: {
        response: {
          page: {
            rows: pages[i]!.rows,
            final: pages[i]!.final,
            ordered: false,
            orderKeys: [],
          },
        },
      },
    });
  }

  return connection.query('RETURN data');
}

describe('QueryResult', () => {
  let transport: MockTransport;
  let connection: Connection;

  beforeEach(async () => {
    const ctx = await createConnection();
    transport = ctx.transport;
    connection = ctx.connection;
  });

  describe('async iteration', () => {
    it('should iterate over single-page result', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'num', type: 'INT64' }],
        [
          {
            rows: [
              { values: [{ intVal: { value: 1, kind: 1 } }] },
              { values: [{ intVal: { value: 2, kind: 1 } }] },
              { values: [{ intVal: { value: 3, kind: 1 } }] },
            ],
            final: true,
          },
        ]
      );

      const rows: unknown[] = [];
      for await (const row of result) {
        rows.push(row);
      }

      expect(rows).toHaveLength(3);
      expect(result.rowCount).toBe(3);
      expect(result.isClosed).toBe(true);
    });

    it('should iterate over multi-page result', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'val', type: 'STRING' }],
        [
          {
            rows: [{ values: [{ stringVal: { value: 'page1', kind: 1 } }] }],
            final: false,
          },
          {
            rows: [{ values: [{ stringVal: { value: 'page2', kind: 1 } }] }],
            final: true,
          },
        ]
      );

      const rows: unknown[] = [];
      for await (const row of result) {
        rows.push(row);
      }

      expect(rows).toHaveLength(2);
      expect(result.rowCount).toBe(2);
    });

    it('should handle empty result', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'num', type: 'INT64' }],
        [
          {
            rows: [],
            final: true,
          },
        ]
      );

      const rows: unknown[] = [];
      for await (const row of result) {
        rows.push(row);
      }

      expect(rows).toHaveLength(0);
      expect(result.rowCount).toBe(0);
      expect(result.isClosed).toBe(true);
    });

    it('should respect abort signal during iteration', async () => {
      const controller = new AbortController();

      // Queue schema + non-final page (so iteration will try to fetch more)
      transport.queueProtoResponse({
        execute: {
          schema: { columns: [{ name: 'num', type: 'INT64' }] },
        },
      });
      transport.queueProtoResponse({
        execute: {
          page: {
            rows: [
              { values: [{ intVal: { value: 1, kind: 1 } }] },
              { values: [{ intVal: { value: 2, kind: 1 } }] },
            ],
            final: true,
            ordered: false,
            orderKeys: [],
          },
        },
      });

      const result = await connection.query('RETURN data', { signal: controller.signal });

      // Abort after result is created but before iterating
      controller.abort();

      const rows: unknown[] = [];
      for await (const row of result) {
        rows.push(row);
      }

      // With signal aborted before iteration, it should stop early
      expect(rows).toHaveLength(0);
    });
  });

  describe('firstObject', () => {
    it('should return first row as object', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'name', type: 'STRING' }],
        [
          {
            rows: [
              { values: [{ stringVal: { value: 'Alice', kind: 1 } }] },
              { values: [{ stringVal: { value: 'Bob', kind: 1 } }] },
            ],
            final: true,
          },
        ]
      );

      const first = await result.firstObject();

      expect(first).toBeDefined();
      expect(first?.['name']).toBe('Alice');
      expect(result.isClosed).toBe(true);
    });

    it('should return null for empty result', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'name', type: 'STRING' }],
        [
          {
            rows: [],
            final: true,
          },
        ]
      );

      const first = await result.firstObject();

      expect(first).toBeNull();
    });
  });

  describe('_collectRawRecords (fast path)', () => {
    it('should collect all records from single page', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'n', type: 'INT64' }],
        [
          {
            rows: [
              { values: [{ intVal: { value: 1, kind: 1 } }] },
              { values: [{ intVal: { value: 2, kind: 1 } }] },
            ],
            final: true,
          },
        ]
      );

      const records = await result._collectRawRecords();

      expect(records).toHaveLength(2);
      expect(records[0]?.['n']).toBe(1);
      expect(records[1]?.['n']).toBe(2);
    });

    it('should collect records across multiple pages', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'n', type: 'INT64' }],
        [
          {
            rows: [{ values: [{ intVal: { value: 1, kind: 1 } }] }],
            final: false,
          },
          {
            rows: [{ values: [{ intVal: { value: 2, kind: 1 } }] }],
            final: false,
          },
          {
            rows: [{ values: [{ intVal: { value: 3, kind: 1 } }] }],
            final: true,
          },
        ]
      );

      const records = await result._collectRawRecords();

      expect(records).toHaveLength(3);
      expect(records[0]?.['n']).toBe(1);
      expect(records[1]?.['n']).toBe(2);
      expect(records[2]?.['n']).toBe(3);
    });

    it('should return empty array for empty result', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'n', type: 'INT64' }],
        [
          {
            rows: [],
            final: true,
          },
        ]
      );

      const records = await result._collectRawRecords();

      expect(records).toHaveLength(0);
    });
  });

  describe('column accessors', () => {
    it('should return column definitions', async () => {
      const result = await runQuery(
        connection,
        transport,
        [
          { name: 'id', type: 'INT64' },
          { name: 'name', type: 'STRING' },
        ],
        [{ rows: [], final: true }]
      );

      expect(result.columns).toHaveLength(2);
      expect(result.columns[0]?.name).toBe('id');
      expect(result.columns[1]?.name).toBe('name');
    });

    it('should return column names', async () => {
      const result = await runQuery(
        connection,
        transport,
        [
          { name: 'id', type: 'INT64' },
          { name: 'name', type: 'STRING' },
        ],
        [{ rows: [], final: true }]
      );

      expect(result.columnNames).toEqual(['id', 'name']);
    });
  });

  describe('complete property', () => {
    it('should report complete after consuming all rows from final page', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'n', type: 'INT64' }],
        [
          {
            rows: [{ values: [{ intVal: { value: 1, kind: 1 } }] }],
            final: true,
          },
        ]
      );

      // Not complete yet (buffer not consumed)
      expect(result.complete).toBe(false);

      // Consume all rows
      for await (const _row of result) {
        // consume
      }

      // Now complete
      expect(result.complete).toBe(true);
    });
  });

  describe('toArray', () => {
    it('should return all rows as Row array', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'val', type: 'INT64' }],
        [
          {
            rows: [
              { values: [{ intVal: { value: 10, kind: 1 } }] },
              { values: [{ intVal: { value: 20, kind: 1 } }] },
            ],
            final: true,
          },
        ]
      );

      const rows = await result.toArray();

      expect(rows).toHaveLength(2);
    });
  });

  describe('toObjects', () => {
    it('should return all rows as plain objects', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'name', type: 'STRING' }],
        [
          {
            rows: [
              { values: [{ stringVal: { value: 'Alice', kind: 1 } }] },
              { values: [{ stringVal: { value: 'Bob', kind: 1 } }] },
            ],
            final: true,
          },
        ]
      );

      const objects = await result.toObjects();

      expect(objects).toHaveLength(2);
      expect(objects[0]?.['name']).toBeDefined();
      expect(objects[1]?.['name']).toBeDefined();
    });
  });

  describe('forEach', () => {
    it('should call function for each row', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'val', type: 'INT64' }],
        [
          {
            rows: [
              { values: [{ intVal: { value: 1, kind: 1 } }] },
              { values: [{ intVal: { value: 2, kind: 1 } }] },
              { values: [{ intVal: { value: 3, kind: 1 } }] },
            ],
            final: true,
          },
        ]
      );

      const indices: number[] = [];
      await result.forEach((_row, index) => {
        indices.push(index);
      });

      expect(indices).toEqual([0, 1, 2]);
    });
  });

  describe('map', () => {
    it('should map rows to new values', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'val', type: 'INT64' }],
        [
          {
            rows: [
              { values: [{ intVal: { value: 10, kind: 1 } }] },
              { values: [{ intVal: { value: 20, kind: 1 } }] },
            ],
            final: true,
          },
        ]
      );

      const mapped = await result.map((_row, index) => `item-${index}`);

      expect(mapped).toEqual(['item-0', 'item-1']);
    });
  });

  describe('filter', () => {
    it('should filter rows by predicate', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'val', type: 'INT64' }],
        [
          {
            rows: [
              { values: [{ intVal: { value: 1, kind: 1 } }] },
              { values: [{ intVal: { value: 2, kind: 1 } }] },
              { values: [{ intVal: { value: 3, kind: 1 } }] },
            ],
            final: true,
          },
        ]
      );

      const filtered = await result.filter((_row, index) => index % 2 === 0);

      expect(filtered).toHaveLength(2);
    });
  });

  describe('reduce', () => {
    it('should reduce rows to a single value', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'val', type: 'INT64' }],
        [
          {
            rows: [
              { values: [{ intVal: { value: 1, kind: 1 } }] },
              { values: [{ intVal: { value: 2, kind: 1 } }] },
              { values: [{ intVal: { value: 3, kind: 1 } }] },
            ],
            final: true,
          },
        ]
      );

      const count = await result.reduce((acc, _row) => acc + 1, 0);

      expect(count).toBe(3);
    });
  });

  describe('close', () => {
    it('should be idempotent', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'val', type: 'INT64' }],
        [{ rows: [], final: true }]
      );

      result.close();
      result.close(); // should not throw
      expect(result.isClosed).toBe(true);
    });

    it('should mark result as closed after _close', async () => {
      const result = await runQuery(
        connection,
        transport,
        [{ name: 'val', type: 'INT64' }],
        [{ rows: [], final: true }]
      );

      result._close();
      expect(result.isClosed).toBe(true);
    });
  });
});

describe('QueryResultIterator', () => {
  it('should iterate using next()', async () => {
    const transport = new MockTransport();
    transport.queueProtoResponse({
      hello: {
        success: true,
        sessionId: 'iter-session',
        errorMessage: '',
        capabilities: [],
      },
    });

    const connection = await Connection.connectWithTransport(
      {
        host: 'localhost',
        port: 3141,
        pageSize: 100,
        transport: 'quic',
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        tls: true,
      },
      transport
    );

    transport.queueProtoResponse({
      execute: {
        schema: { columns: [{ name: 'val', type: 'INT64' }] },
      },
    });
    transport.queueProtoResponse({
      execute: {
        page: {
          rows: [
            { values: [{ intVal: { value: 1, kind: 1 } }] },
            { values: [{ intVal: { value: 2, kind: 1 } }] },
          ],
          final: true,
          ordered: false,
          orderKeys: [],
        },
      },
    });

    const result = await connection.query('RETURN data');
    const iter = new QueryResultIterator(result);

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value).toBeDefined();

    const second = await iter.next();
    expect(second.done).toBe(false);
    expect(second.value).toBeDefined();

    const third = await iter.next();
    expect(third.done).toBe(true);
    expect(third.value).toBeUndefined();
  });

  it('should close the underlying result', async () => {
    const transport = new MockTransport();
    transport.queueProtoResponse({
      hello: {
        success: true,
        sessionId: 'iter-close-session',
        errorMessage: '',
        capabilities: [],
      },
    });

    const connection = await Connection.connectWithTransport(
      {
        host: 'localhost',
        port: 3141,
        pageSize: 100,
        transport: 'quic',
        helloName: 'test',
        helloVersion: '1.0.0',
        conformance: 'min',
        tls: true,
      },
      transport
    );

    transport.queueProtoResponse({
      execute: {
        schema: { columns: [{ name: 'val', type: 'INT64' }] },
      },
    });
    transport.queueProtoResponse({
      execute: {
        page: {
          rows: [{ values: [{ intVal: { value: 1, kind: 1 } }] }],
          final: true,
          ordered: false,
          orderKeys: [],
        },
      },
    });

    const result = await connection.query('RETURN data');
    const iter = new QueryResultIterator(result);

    iter.close();

    expect(result.isClosed).toBe(true);
  });
});
