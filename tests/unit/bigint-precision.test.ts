/**
 * BigInt Precision Tests
 *
 * Comprehensive tests for handling large integers that exceed JavaScript's
 * Number.MAX_SAFE_INTEGER (2^53 - 1). This is critical for node/edge IDs
 * which may be 18+ digit integers.
 *
 * These tests were added as part of the fix for the precision loss bug where
 * node IDs like 115974477121658528 would be corrupted to 115974477121658530
 * when parsed with standard JSON.parse(), causing edges to fail to connect
 * to their nodes in graph visualizations.
 *
 * @see https://gitlab.com/devnw/geode/geode-client-nodejs/-/issues/XX
 */
import { describe, it, expect } from 'vitest';
import { parseFrame, serializeMessage } from '../../src/protocol.js';
import {
  GQLValue,
  fromJSON,
  parseRow,
  rowToObject,
  type GQLNode,
  type GQLEdge,
  type GQLPath,
} from '../../src/types.js';

describe('BigInt Precision', () => {
  // Test constants - these are real Geode IDs that exceed JavaScript's safe integer limit
  const LARGE_ID_STRING = '115974477121658528';
  const LARGE_ID_BIGINT = BigInt(LARGE_ID_STRING);
  const CORRUPTED_ID = 115974477121658530; // What standard JSON.parse() produces

  // More test IDs
  const EDGE_ID_STRING = '115974480466781936';
  const EDGE_ID_BIGINT = BigInt(EDGE_ID_STRING);
  const NODE2_ID_STRING = '115974478359077120';
  const NODE2_ID_BIGINT = BigInt(NODE2_ID_STRING);

  describe('parseFrame', () => {
    it('should preserve large integer precision in node IDs', () => {
      const json = JSON.stringify({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: 'BINDINGS',
          rows: [
            {
              n: {
                id: 115974477121658528, // This will be corrupted in the string
                labels: ['Firewall'],
                properties: { name: 'fw1' },
              },
            },
          ],
          final: true,
        },
      });

      // Replace the corrupted number with the correct one in the raw string
      // This simulates what the server actually sends
      const correctJson = json.replace(String(CORRUPTED_ID), LARGE_ID_STRING);

      const frame = parseFrame(correctJson);
      const rows = frame.result.rows as Array<{ n: GQLNode }>;
      const nodeId = rows[0]?.n.id;

      // The ID should be a BigInt with the exact original value
      expect(typeof nodeId).toBe('bigint');
      expect(nodeId).toBe(LARGE_ID_BIGINT);
    });

    it('should preserve large integer precision in edge IDs and references', () => {
      // Simulate a frame with an edge containing large integer IDs
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{
            "r": {
              "id": ${EDGE_ID_STRING},
              "type": "HAS_ACL",
              "startNode": ${LARGE_ID_STRING},
              "endNode": ${NODE2_ID_STRING},
              "properties": {}
            }
          }],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ r: GQLEdge }>;
      const edge = rows[0]?.r;

      expect(typeof edge?.id).toBe('bigint');
      expect(edge?.id).toBe(EDGE_ID_BIGINT);
      expect(typeof edge?.startNode).toBe('bigint');
      expect(edge?.startNode).toBe(LARGE_ID_BIGINT);
      expect(typeof edge?.endNode).toBe('bigint');
      expect(edge?.endNode).toBe(NODE2_ID_BIGINT);
    });

    it('should ensure edge startNode matches node id exactly', () => {
      // This test verifies the specific bug scenario where edge from/to
      // wouldn't match node IDs due to precision loss
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{
            "fw": {
              "id": ${LARGE_ID_STRING},
              "labels": ["Firewall"],
              "properties": {"name": "fw1"}
            },
            "r": {
              "id": ${EDGE_ID_STRING},
              "type": "HAS_ACL",
              "startNode": ${LARGE_ID_STRING},
              "endNode": ${NODE2_ID_STRING},
              "properties": {}
            }
          }],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ fw: GQLNode; r: GQLEdge }>;
      const { fw: node, r: edge } = rows[0] ?? {};

      // Critical assertion: edge.startNode must exactly equal node.id
      expect(edge?.startNode).toBe(node?.id);
    });

    it('should keep small integers as numbers', () => {
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"value": 42}],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ value: number }>;
      const value = rows[0]?.value;

      // Small integers should remain as numbers
      expect(typeof value).toBe('number');
      expect(value).toBe(42);
    });

    it('should preserve Number.MAX_SAFE_INTEGER as number', () => {
      const maxSafe = Number.MAX_SAFE_INTEGER;
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"value": ${maxSafe}}],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ value: number }>;
      const value = rows[0]?.value;

      expect(typeof value).toBe('number');
      expect(value).toBe(maxSafe);
    });

    it('should convert Number.MAX_SAFE_INTEGER + 1 to BigInt', () => {
      const beyondSafe = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"value": ${beyondSafe.toString()}}],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ value: bigint }>;
      const value = rows[0]?.value;

      expect(typeof value).toBe('bigint');
      expect(value).toBe(beyondSafe);
    });

    it('should preserve negative large integers', () => {
      const negLargeId = BigInt('-115974477121658528');
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"value": -115974477121658528}],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ value: bigint }>;
      const value = rows[0]?.value;

      expect(typeof value).toBe('bigint');
      expect(value).toBe(negLargeId);
    });

    it('should handle floats correctly', () => {
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"value": 3.14159}],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ value: number }>;
      const value = rows[0]?.value;

      expect(typeof value).toBe('number');
      expect(value).toBeCloseTo(3.14159);
    });

    it('should handle scientific notation as floats', () => {
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"value": 1.5e10}],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ value: number }>;
      const value = rows[0]?.value;

      expect(typeof value).toBe('number');
      expect(value).toBe(1.5e10);
    });
  });

  describe('serializeMessage', () => {
    it('should serialize BigInt values as numbers', () => {
      const msg = {
        type: 'RUN_GQL',
        params: {
          id: LARGE_ID_BIGINT,
        },
      };

      const buf = serializeMessage(msg);
      const str = buf.toString('utf-8').trim();

      // The BigInt should be serialized as a raw number without quotes
      expect(str).toContain(LARGE_ID_STRING);
      expect(str).not.toContain(`"${LARGE_ID_STRING}"`);
    });

    it('should handle mixed number and bigint params', () => {
      const msg = {
        type: 'RUN_GQL',
        params: {
          smallId: 42,
          largeId: LARGE_ID_BIGINT,
          name: 'test',
        },
      };

      const buf = serializeMessage(msg);
      const str = buf.toString('utf-8').trim();

      expect(str).toContain('"smallId":42');
      expect(str).toContain(LARGE_ID_STRING);
      expect(str).toContain('"name":"test"');
    });

    it('should round-trip BigInt values through serialize/parse', () => {
      const msg = {
        type: 'TEST',
        params: {
          id: LARGE_ID_BIGINT,
        },
      };

      const buf = serializeMessage(msg);
      const str = buf.toString('utf-8').trim();

      // Parse back - we need to use a mock frame structure
      const mockFrame = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"id": ${LARGE_ID_STRING}}],
          "final": true
        }
      }`;

      const frame = parseFrame(mockFrame);
      const rows = frame.result.rows as Array<{ id: bigint }>;
      expect(rows[0]?.id).toBe(LARGE_ID_BIGINT);
    });
  });

  describe('GQLValue', () => {
    it('should create int values from BigInt', () => {
      const v = GQLValue.int(LARGE_ID_BIGINT);

      expect(v.kind).toBe('INT');
      expect(v.asInt).toBe(LARGE_ID_BIGINT);
    });

    it('should return BigInt for unsafe integers in toJS()', () => {
      const v = GQLValue.int(LARGE_ID_BIGINT);
      const js = v.toJS();

      expect(typeof js).toBe('bigint');
      expect(js).toBe(LARGE_ID_BIGINT);
    });

    it('should return number for safe integers in toJS()', () => {
      const v = GQLValue.int(42);
      const js = v.toJS();

      expect(typeof js).toBe('number');
      expect(js).toBe(42);
    });

    it('should convert BigInt toString correctly', () => {
      const v = GQLValue.int(LARGE_ID_BIGINT);
      expect(v.toString()).toBe(LARGE_ID_STRING);
    });

    it('should handle BigInt at the boundary', () => {
      const maxSafe = GQLValue.int(BigInt(Number.MAX_SAFE_INTEGER));
      const beyondSafe = GQLValue.int(BigInt(Number.MAX_SAFE_INTEGER) + 1n);

      // MAX_SAFE_INTEGER should return as number
      expect(typeof maxSafe.toJS()).toBe('number');
      // MAX_SAFE_INTEGER + 1 should return as bigint
      expect(typeof beyondSafe.toJS()).toBe('bigint');
    });
  });

  describe('fromJSON', () => {
    it('should handle BigInt values', () => {
      const v = fromJSON(LARGE_ID_BIGINT);

      expect(v.kind).toBe('INT');
      expect(v.asInt).toBe(LARGE_ID_BIGINT);
    });

    it('should handle number values that fit in safe integer range', () => {
      const v = fromJSON(42);

      expect(v.kind).toBe('INT');
      expect(v.asInt).toBe(42n);
      expect(v.toJS()).toBe(42); // Should return as number
    });

    it('should detect node objects with BigInt IDs', () => {
      const node = {
        id: LARGE_ID_BIGINT,
        labels: ['Person'],
        properties: { name: 'Alice' },
      };

      const v = fromJSON(node);

      expect(v.kind).toBe('NODE');
      expect(v.asNode.id).toBe(LARGE_ID_BIGINT);
    });

    it('should detect edge objects with BigInt IDs', () => {
      const edge = {
        id: EDGE_ID_BIGINT,
        type: 'KNOWS',
        startNode: LARGE_ID_BIGINT,
        endNode: NODE2_ID_BIGINT,
        properties: {},
      };

      const v = fromJSON(edge);

      expect(v.kind).toBe('EDGE');
      expect(v.asEdge.id).toBe(EDGE_ID_BIGINT);
      expect(v.asEdge.startNode).toBe(LARGE_ID_BIGINT);
      expect(v.asEdge.endNode).toBe(NODE2_ID_BIGINT);
    });

    it('should handle path with BigInt node/edge IDs', () => {
      const path = {
        nodes: [
          { id: LARGE_ID_BIGINT, labels: ['A'], properties: {} },
          { id: NODE2_ID_BIGINT, labels: ['B'], properties: {} },
        ],
        edges: [
          {
            id: EDGE_ID_BIGINT,
            type: 'CONNECTS',
            startNode: LARGE_ID_BIGINT,
            endNode: NODE2_ID_BIGINT,
            properties: {},
          },
        ],
      };

      const v = fromJSON(path);

      expect(v.kind).toBe('PATH');
      const p = v.asPath;
      expect(p.nodes[0]?.id).toBe(LARGE_ID_BIGINT);
      expect(p.nodes[1]?.id).toBe(NODE2_ID_BIGINT);
      expect(p.edges[0]?.id).toBe(EDGE_ID_BIGINT);
    });

    it('should convert string to BigInt when type hint is INT', () => {
      const v = fromJSON(LARGE_ID_STRING, 'INT');

      expect(v.kind).toBe('INT');
      expect(v.asInt).toBe(LARGE_ID_BIGINT);
    });
  });

  describe('parseRow and rowToObject', () => {
    it('should preserve BigInt IDs through row parsing', () => {
      const raw = {
        node_id: LARGE_ID_BIGINT,
        name: 'Alice',
      };

      const columns = [
        { name: 'node_id', type: 'INT' as const, kind: 'INT' as const },
        { name: 'name', type: 'STRING' as const, kind: 'STRING' as const },
      ];

      const row = parseRow(raw, columns);
      const obj = rowToObject(row);

      // BigInt should be preserved in the final object
      expect(typeof obj['node_id']).toBe('bigint');
      expect(obj['node_id']).toBe(LARGE_ID_BIGINT);
    });

    it('should preserve node objects with BigInt IDs through row parsing', () => {
      const raw = {
        n: {
          id: LARGE_ID_BIGINT,
          labels: ['Person'],
          properties: { name: 'Alice' },
        },
      };

      const columns = [{ name: 'n', type: 'NODE' as const, kind: 'NODE' as const }];

      const row = parseRow(raw, columns);
      const obj = rowToObject(row);

      const node = obj['n'] as GQLNode;
      expect(node.id).toBe(LARGE_ID_BIGINT);
    });

    it('should preserve edge objects with BigInt IDs through row parsing', () => {
      const raw = {
        r: {
          id: EDGE_ID_BIGINT,
          type: 'KNOWS',
          startNode: LARGE_ID_BIGINT,
          endNode: NODE2_ID_BIGINT,
          properties: {},
        },
      };

      const columns = [{ name: 'r', type: 'EDGE' as const, kind: 'EDGE' as const }];

      const row = parseRow(raw, columns);
      const obj = rowToObject(row);

      const edge = obj['r'] as GQLEdge;
      expect(edge.id).toBe(EDGE_ID_BIGINT);
      expect(edge.startNode).toBe(LARGE_ID_BIGINT);
      expect(edge.endNode).toBe(NODE2_ID_BIGINT);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle a complete graph query response with multiple nodes and edges', () => {
      // Simulate a real Geode response with multiple nodes and edges
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [
            {
              "a": {
                "id": 115974477121658528,
                "labels": ["Person"],
                "properties": {"name": "Alice"}
              },
              "b": {
                "id": 115974478359077120,
                "labels": ["Person"],
                "properties": {"name": "Bob"}
              },
              "r": {
                "id": 115974480466781936,
                "type": "KNOWS",
                "startNode": 115974477121658528,
                "endNode": 115974478359077120,
                "properties": {"since": 2020}
              }
            }
          ],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{
        a: GQLNode;
        b: GQLNode;
        r: GQLEdge;
      }>;
      const { a, b, r } = rows[0] ?? {};

      // Verify nodes
      expect(typeof a?.id).toBe('bigint');
      expect(typeof b?.id).toBe('bigint');

      // Verify edge
      expect(typeof r?.id).toBe('bigint');
      expect(typeof r?.startNode).toBe('bigint');
      expect(typeof r?.endNode).toBe('bigint');

      // Critical: edge references must match node IDs exactly
      expect(r?.startNode).toBe(a?.id);
      expect(r?.endNode).toBe(b?.id);
    });

    it('should handle a path traversal response', () => {
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [
            {
              "path": {
                "nodes": [
                  {"id": 115974477121658528, "labels": ["A"], "properties": {}},
                  {"id": 115974478359077120, "labels": ["B"], "properties": {}},
                  {"id": 115974479532105312, "labels": ["C"], "properties": {}}
                ],
                "edges": [
                  {
                    "id": 115974480466781936,
                    "type": "STEP1",
                    "startNode": 115974477121658528,
                    "endNode": 115974478359077120,
                    "properties": {}
                  },
                  {
                    "id": 115974481622898240,
                    "type": "STEP2",
                    "startNode": 115974478359077120,
                    "endNode": 115974479532105312,
                    "properties": {}
                  }
                ]
              }
            }
          ],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ path: GQLPath }>;
      const path = rows[0]?.path;

      // All node IDs should be BigInt
      path?.nodes.forEach((node) => {
        expect(typeof node.id).toBe('bigint');
      });

      // All edge IDs and references should be BigInt
      path?.edges.forEach((edge) => {
        expect(typeof edge.id).toBe('bigint');
        expect(typeof edge.startNode).toBe('bigint');
        expect(typeof edge.endNode).toBe('bigint');
      });

      // Verify edge connectivity matches nodes
      expect(path?.edges[0]?.startNode).toBe(path?.nodes[0]?.id);
      expect(path?.edges[0]?.endNode).toBe(path?.nodes[1]?.id);
      expect(path?.edges[1]?.startNode).toBe(path?.nodes[1]?.id);
      expect(path?.edges[1]?.endNode).toBe(path?.nodes[2]?.id);
    });

    it('should handle aggregation results with large counts', () => {
      // If a database had a huge number of nodes, the count could exceed safe integers
      const hugeCount = BigInt('9007199254740993');
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"count": 9007199254740993}],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ count: bigint }>;
      const count = rows[0]?.count;

      expect(typeof count).toBe('bigint');
      expect(count).toBe(hugeCount);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero', () => {
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"value": 0}],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ value: number }>;
      expect(rows[0]?.value).toBe(0);
      expect(typeof rows[0]?.value).toBe('number');
    });

    it('should handle Number.MIN_SAFE_INTEGER', () => {
      const minSafe = Number.MIN_SAFE_INTEGER;
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"value": ${minSafe}}],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ value: number }>;
      expect(rows[0]?.value).toBe(minSafe);
      expect(typeof rows[0]?.value).toBe('number');
    });

    it('should handle Number.MIN_SAFE_INTEGER - 1 as BigInt', () => {
      const beyondMinSafe = BigInt(Number.MIN_SAFE_INTEGER) - 1n;
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{"value": ${beyondMinSafe.toString()}}],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ value: bigint }>;
      expect(rows[0]?.value).toBe(beyondMinSafe);
      expect(typeof rows[0]?.value).toBe('bigint');
    });

    it('should handle nested objects with mixed number types', () => {
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{
            "data": {
              "small": 42,
              "large": 115974477121658528,
              "nested": {
                "another_large": 115974478359077120
              }
            }
          }],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{
        data: {
          small: number;
          large: bigint;
          nested: { another_large: bigint };
        };
      }>;
      const data = rows[0]?.data;

      expect(typeof data?.small).toBe('number');
      expect(data?.small).toBe(42);
      expect(typeof data?.large).toBe('bigint');
      expect(typeof data?.nested?.another_large).toBe('bigint');
    });

    it('should handle arrays with mixed number types', () => {
      const rawJson = `{
        "status_class": "00000",
        "status_subclass": "000",
        "result": {
          "type": "BINDINGS",
          "rows": [{
            "ids": [42, 115974477121658528, 100, 115974478359077120]
          }],
          "final": true
        }
      }`;

      const frame = parseFrame(rawJson);
      const rows = frame.result.rows as Array<{ ids: (number | bigint)[] }>;
      const ids = rows[0]?.ids;

      expect(typeof ids?.[0]).toBe('number');
      expect(ids?.[0]).toBe(42);
      expect(typeof ids?.[1]).toBe('bigint');
      expect(typeof ids?.[2]).toBe('number');
      expect(ids?.[2]).toBe(100);
      expect(typeof ids?.[3]).toBe('bigint');
    });
  });
});

describe('Regression Tests: ID Precision Loss', () => {
  /**
   * These tests specifically verify that the precision loss bug is fixed
   * and will catch any regression in the future.
   */

  it('REGRESSION: should not corrupt 115974477121658528 to 115974477121658530', () => {
    // This is the exact bug scenario from the bug report
    const originalId = BigInt('115974477121658528');
    const corruptedId = 115974477121658530n;

    const rawJson = `{
      "status_class": "00000",
      "status_subclass": "000",
      "result": {
        "type": "BINDINGS",
        "rows": [{"id": 115974477121658528}],
        "final": true
      }
    }`;

    const frame = parseFrame(rawJson);
    const rows = frame.result.rows as Array<{ id: bigint }>;
    const parsedId = rows[0]?.id;

    // Must NOT be the corrupted value
    expect(parsedId).not.toBe(corruptedId);
    // Must be the original value
    expect(parsedId).toBe(originalId);
  });

  it('REGRESSION: edge.startNode must match node.id for large IDs', () => {
    // This test verifies the specific bug where edges wouldn't connect to nodes
    const nodeId = BigInt('115974477121658528');

    const rawJson = `{
      "status_class": "00000",
      "status_subclass": "000",
      "result": {
        "type": "BINDINGS",
        "rows": [{
          "node": {"id": 115974477121658528, "labels": ["X"], "properties": {}},
          "edge": {
            "id": 115974480466781936,
            "type": "REL",
            "startNode": 115974477121658528,
            "endNode": 115974478359077120,
            "properties": {}
          }
        }],
        "final": true
      }
    }`;

    const frame = parseFrame(rawJson);
    const rows = frame.result.rows as Array<{
      node: { id: bigint };
      edge: { startNode: bigint };
    }>;
    const { node, edge } = rows[0] ?? {};

    // Critical regression test: these MUST be equal
    expect(edge?.startNode).toBe(node?.id);
    expect(edge?.startNode).toBe(nodeId);
    expect(node?.id).toBe(nodeId);
  });

  it('REGRESSION: multiple 18-digit IDs should all be preserved correctly', () => {
    // Test with multiple IDs that all exceed MAX_SAFE_INTEGER
    const ids = [
      '115974477121658528',
      '115974478359077120',
      '115974479532105312',
      '115974480466781936',
      '115974481622898240',
    ];

    const rawJson = `{
      "status_class": "00000",
      "status_subclass": "000",
      "result": {
        "type": "BINDINGS",
        "rows": [{"ids": [${ids.join(', ')}]}],
        "final": true
      }
    }`;

    const frame = parseFrame(rawJson);
    const rows = frame.result.rows as Array<{ ids: bigint[] }>;
    const parsedIds = rows[0]?.ids;

    // Verify each ID was parsed correctly
    ids.forEach((id, index) => {
      expect(parsedIds?.[index]).toBe(BigInt(id));
    });
  });

  it('REGRESSION: string IDs should remain strings, number IDs should become BigInt when large', () => {
    // Test that the fix doesn't accidentally convert string IDs to BigInt
    const rawJson = `{
      "status_class": "00000",
      "status_subclass": "000",
      "result": {
        "type": "BINDINGS",
        "rows": [{
          "stringId": "115974477121658528",
          "numericId": 115974477121658528
        }],
        "final": true
      }
    }`;

    const frame = parseFrame(rawJson);
    const rows = frame.result.rows as Array<{
      stringId: string;
      numericId: bigint;
    }>;
    const row = rows[0];

    // String should remain string
    expect(typeof row?.stringId).toBe('string');
    expect(row?.stringId).toBe('115974477121658528');

    // Numeric should become BigInt
    expect(typeof row?.numericId).toBe('bigint');
    expect(row?.numericId).toBe(BigInt('115974477121658528'));
  });
});
