/**
 * Property-Based Tests for Protocol
 *
 * Tests wire protocol parsing and serialization with arbitrary inputs.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  parseFrame,
  serializeMessage,
  rewritePlaceholders,
  countPlaceholders,
  buildRunGQLMessage,
  buildHelloMessage,
  RespType,
} from '../../src/protocol.js';
import { TransportError } from '../../src/errors.js';
import type { GeodeConfig } from '../../src/config.js';

// Arbitrary generators for valid frames
const statusClassArb = fc.constantFrom('00000', '01000', '02000', '25000', '42000', '58000');
const statusSubclassArb = fc
  .array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
    minLength: 3,
    maxLength: 3,
  })
  .map((arr) => arr.join(''));
const respTypeArb = fc.constantFrom(...Object.values(RespType));

const columnDefArb = fc.record({
  name: fc
    .string({ minLength: 1, maxLength: 64 })
    .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
  type: fc.constantFrom('INT', 'STRING', 'BOOL', 'FLOAT', 'NODE', 'EDGE', 'PATH'),
});

const schemaFrameArb = fc.record({
  status_class: statusClassArb,
  status_subclass: statusSubclassArb,
  result: fc.record({
    type: fc.constant(RespType.SCHEMA),
    columns: fc.array(columnDefArb, { minLength: 1, maxLength: 20 }),
  }),
});

const bindingsRowArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 32 }).filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
  fc.oneof(fc.integer(), fc.double(), fc.string(), fc.boolean(), fc.constant(null))
);

const bindingsFrameArb = fc.record({
  status_class: statusClassArb,
  status_subclass: statusSubclassArb,
  result: fc.record({
    type: fc.constant(RespType.BINDINGS),
    rows: fc.array(bindingsRowArb, { minLength: 0, maxLength: 100 }),
    final: fc.boolean(),
    ordered: fc.boolean(),
    order_keys: fc.array(fc.string({ minLength: 1, maxLength: 32 }), { maxLength: 5 }),
  }),
});

const errorFrameArb = fc.record({
  status_class: statusClassArb,
  status_subclass: statusSubclassArb,
  result: fc.record({
    type: fc.constant(RespType.ERROR),
    code: fc.string({ minLength: 1, maxLength: 64 }),
    message: fc.string({ maxLength: 500 }),
    anchor: fc.option(fc.string({ maxLength: 100 })),
    additional: fc.array(
      fc.record({
        code: fc.option(fc.string({ maxLength: 32 })),
        message: fc.option(fc.string({ maxLength: 200 })),
      }),
      { maxLength: 5 }
    ),
  }),
});

describe('Protocol Property Tests', () => {
  describe('Frame Parsing Robustness', () => {
    it('should not crash on arbitrary JSON', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (jsonValue) => {
          try {
            parseFrame(JSON.stringify(jsonValue));
            return true;
          } catch (e) {
            expect(e).toBeInstanceOf(TransportError);
            return true;
          }
        }),
        { numRuns: 1000 }
      );
    });

    it('should not crash on arbitrary strings', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            parseFrame(input);
            return true;
          } catch (e) {
            expect(e).toBeInstanceOf(TransportError);
            return true;
          }
        }),
        { numRuns: 1000 }
      );
    });

    it('should parse valid SCHEMA frames', () => {
      fc.assert(
        fc.property(schemaFrameArb, (frame) => {
          const json = JSON.stringify(frame);
          const parsed = parseFrame(json);
          expect(parsed.result.type).toBe(RespType.SCHEMA);
          expect(parsed.result.columns).toEqual(frame.result.columns);
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should parse valid BINDINGS frames', () => {
      fc.assert(
        fc.property(bindingsFrameArb, (frame) => {
          const json = JSON.stringify(frame);
          const parsed = parseFrame(json);
          expect(parsed.result.type).toBe(RespType.BINDINGS);
          expect(parsed.result.final).toBe(frame.result.final);
          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should parse valid ERROR frames', () => {
      fc.assert(
        fc.property(errorFrameArb, (frame) => {
          const json = JSON.stringify(frame);
          const parsed = parseFrame(json);
          expect(parsed.result.type).toBe(RespType.ERROR);
          expect(parsed.result.code).toBe(frame.result.code);
          return true;
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('Message Serialization', () => {
    it('should serialize and produce valid JSON', () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.string({ minLength: 1, maxLength: 20 }),
            data: fc.jsonValue(),
          }),
          (msg) => {
            const serialized = serializeMessage(msg as Record<string, unknown>);
            const str = serialized.toString('utf-8');

            // Should end with newline
            expect(str.endsWith('\n')).toBe(true);

            // Should be valid JSON (without the newline)
            const parsed = JSON.parse(str.slice(0, -1));
            expect(parsed.type).toBe(msg.type);
            return true;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should produce consistent output for same input', () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant('TEST'),
            value: fc.integer(),
            text: fc.string(),
          }),
          (msg) => {
            const result1 = serializeMessage(msg);
            const result2 = serializeMessage(msg);
            expect(result1.toString()).toBe(result2.toString());
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Placeholder Handling', () => {
    it('should count placeholders correctly', () => {
      fc.assert(
        fc.property(fc.array(fc.constantFrom('?', 'x', ' ', 'n', '.', '=')), (chars) => {
          const query = chars.join('');
          const count = countPlaceholders(query);
          const expected = chars.filter((c) => c === '?').length;
          expect(count).toBe(expected);
          return true;
        }),
        { numRuns: 500 }
      );
    });

    it('should not count placeholders in single-quoted strings', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10 }), (numPlaceholders) => {
          // All ?s are inside quotes
          const quotedParts = Array.from({ length: numPlaceholders }, () => "'?'");
          const query = `SELECT ${quotedParts.join(', ')} FROM t`;
          expect(countPlaceholders(query)).toBe(0);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should rewrite placeholders preserving argument count', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)), {
            minLength: 0,
            maxLength: 20,
          }),
          (args) => {
            const placeholders = args.map(() => '?').join(' AND n.x = ');
            const query =
              args.length > 0
                ? `MATCH (n) WHERE n.x = ${placeholders} RETURN n`
                : 'MATCH (n) RETURN n';

            const result = rewritePlaceholders(query, args);

            // Number of params should match args
            expect(Object.keys(result.params).length).toBe(args.length);

            // Params should have correct values
            args.forEach((arg, i) => {
              expect(result.params[`p${i + 1}`]).toEqual(arg);
            });

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should handle escaped quotes in strings', () => {
      fc.assert(
        fc.property(
          // Filter out strings ending with odd number of backslashes (they'd escape the closing quote)
          fc.string().filter((s) => {
            const match = s.match(/\\+$/);
            return !match || match[0].length % 2 === 0;
          }),
          (content) => {
            // Escape any single quotes in content
            const escaped = content.replace(/'/g, "\\'");
            const query = `MATCH (n) WHERE n.x = '${escaped}' AND n.y = ? RETURN n`;

            const result = rewritePlaceholders(query, ['value']);

            // Should only find the one placeholder outside the string
            expect(Object.keys(result.params).length).toBe(1);
            return true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('BigInt Precision', () => {
    it('should preserve large integers in frames (REGRESSION TEST)', () => {
      // Arbitrary generator for large integers that exceed MAX_SAFE_INTEGER
      const largeIntArb = fc.bigInt({
        min: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        max: BigInt('999999999999999999'), // 18-digit max like Geode IDs
      });

      fc.assert(
        fc.property(largeIntArb, (largeInt) => {
          // Build a frame with the large integer as an ID
          const rawJson = `{
            "status_class": "00000",
            "status_subclass": "000",
            "result": {
              "type": "BINDINGS",
              "rows": [{"id": ${largeInt.toString()}}],
              "final": true
            }
          }`;

          const parsed = parseFrame(rawJson);
          const rows = parsed.result.rows as Array<{ id: bigint }>;
          const parsedId = rows[0]?.id;

          // The ID must be a bigint (not a number) and must match exactly
          expect(typeof parsedId).toBe('bigint');
          expect(parsedId).toBe(largeInt);

          // Critical: verify it was NOT corrupted by JavaScript's number handling
          // If it were a number, it would lose precision
          const corruptedValue = Number(largeInt);
          if (corruptedValue !== Number(parsedId)) {
            // This means precision WOULD have been lost if we used number
            // But our bigint handling preserved it
            expect(parsedId).toBe(largeInt);
          }

          return true;
        }),
        { numRuns: 500 }
      );
    });

    it('should keep safe integers as numbers', () => {
      const safeIntArb = fc.integer({
        min: Number.MIN_SAFE_INTEGER,
        max: Number.MAX_SAFE_INTEGER,
      });

      fc.assert(
        fc.property(safeIntArb, (safeInt) => {
          const rawJson = `{
            "status_class": "00000",
            "status_subclass": "000",
            "result": {
              "type": "BINDINGS",
              "rows": [{"value": ${safeInt}}],
              "final": true
            }
          }`;

          const parsed = parseFrame(rawJson);
          const rows = parsed.result.rows as Array<{ value: number }>;
          const parsedValue = rows[0]?.value;

          // Safe integers should remain as numbers
          expect(typeof parsedValue).toBe('number');
          expect(parsedValue).toBe(safeInt);

          return true;
        }),
        { numRuns: 500 }
      );
    });

    it('should serialize bigint values correctly', () => {
      const largeIntArb = fc.bigInt({
        min: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        max: BigInt('999999999999999999'),
      });

      fc.assert(
        fc.property(largeIntArb, (largeInt) => {
          const msg = { type: 'TEST', id: largeInt };
          const serialized = serializeMessage(msg as unknown as Record<string, unknown>);
          const str = serialized.toString('utf-8');

          // Should contain the exact number without quotes
          expect(str).toContain(largeInt.toString());
          // Should NOT be quoted as a string
          expect(str).not.toContain(`"${largeInt.toString()}"`);

          return true;
        }),
        { numRuns: 200 }
      );
    });

    it('should round-trip bigint values through serialize/parse', () => {
      const largeIntArb = fc.bigInt({
        min: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        max: BigInt('999999999999999999'),
      });

      fc.assert(
        fc.property(largeIntArb, (largeInt) => {
          // Simulate serializing a param and receiving it back in a response
          const rawJson = `{
            "status_class": "00000",
            "status_subclass": "000",
            "result": {
              "type": "BINDINGS",
              "rows": [{"id": ${largeInt.toString()}}],
              "final": true
            }
          }`;

          const parsed = parseFrame(rawJson);
          const rows = parsed.result.rows as Array<{ id: bigint }>;

          expect(rows[0]?.id).toBe(largeInt);

          return true;
        }),
        { numRuns: 300 }
      );
    });

    it('should handle node/edge IDs at boundary of safe integer range', () => {
      // Test specifically around the boundary
      const boundaryIntArb = fc.constantFrom(
        Number.MAX_SAFE_INTEGER - 1,
        Number.MAX_SAFE_INTEGER,
        BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        BigInt(Number.MAX_SAFE_INTEGER) + 2n,
        Number.MIN_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER + 1,
        BigInt(Number.MIN_SAFE_INTEGER) - 1n,
        BigInt(Number.MIN_SAFE_INTEGER) - 2n
      );

      fc.assert(
        fc.property(boundaryIntArb, (value) => {
          const valueStr = value.toString();
          const rawJson = `{
            "status_class": "00000",
            "status_subclass": "000",
            "result": {
              "type": "BINDINGS",
              "rows": [{"id": ${valueStr}}],
              "final": true
            }
          }`;

          const parsed = parseFrame(rawJson);
          const rows = parsed.result.rows as Array<{ id: number | bigint }>;
          const parsedId = rows[0]?.id;

          if (typeof value === 'bigint') {
            // Large values should be bigint
            expect(typeof parsedId).toBe('bigint');
            expect(parsedId).toBe(value);
          } else {
            // Safe values should be number
            expect(typeof parsedId).toBe('number');
            expect(parsedId).toBe(value);
          }

          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve precision for multiple large IDs in same row', () => {
      const largeIntArb = fc.bigInt({
        min: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        max: BigInt('999999999999999999'),
      });

      fc.assert(
        fc.property(largeIntArb, largeIntArb, largeIntArb, (nodeId, edgeId, endNodeId) => {
          const rawJson = `{
            "status_class": "00000",
            "status_subclass": "000",
            "result": {
              "type": "BINDINGS",
              "rows": [{
                "n": {"id": ${nodeId.toString()}, "labels": ["Test"], "properties": {}},
                "r": {
                  "id": ${edgeId.toString()},
                  "type": "REL",
                  "startNode": ${nodeId.toString()},
                  "endNode": ${endNodeId.toString()},
                  "properties": {}
                }
              }],
              "final": true
            }
          }`;

          type Row = {
            n: { id: bigint };
            r: { id: bigint; startNode: bigint; endNode: bigint };
          };

          const parsed = parseFrame(rawJson);
          const rows = parsed.result.rows as Row[];
          const row = rows[0];

          // All IDs should be preserved as bigint
          expect(row?.n.id).toBe(nodeId);
          expect(row?.r.id).toBe(edgeId);
          expect(row?.r.startNode).toBe(nodeId);
          expect(row?.r.endNode).toBe(endNodeId);

          // Critical: edge.startNode should match node.id
          expect(row?.r.startNode).toBe(row?.n.id);

          return true;
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('Message Building', () => {
    it('should build RUN_GQL with arbitrary queries and params', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 1000 }),
          fc.dictionary(
            fc
              .string({ minLength: 1, maxLength: 32 })
              .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
            fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null))
          ),
          (query, params) => {
            const msg = buildRunGQLMessage(query, params);

            expect(msg['type']).toBe('RUN_GQL');
            expect(msg['text']).toBe(query);

            if (Object.keys(params).length > 0) {
              expect(msg['params']).toEqual(params);
            } else {
              expect(msg['params']).toBeUndefined();
            }

            return true;
          }
        ),
        { numRuns: 300 }
      );
    });

    it('should build HELLO with config properties', () => {
      fc.assert(
        fc.property(
          fc.record({
            host: fc.string({ minLength: 1, maxLength: 100 }),
            port: fc.integer({ min: 1, max: 65535 }),
            pageSize: fc.integer({ min: 1, max: 100000 }),
            helloName: fc.string({ minLength: 1, maxLength: 50 }),
            helloVersion: fc.string({ minLength: 1, maxLength: 20 }),
            conformance: fc.constantFrom('min', 'full'),
            username: fc.option(fc.string({ maxLength: 50 })),
            password: fc.option(fc.string({ maxLength: 50 })),
          }),
          (cfg) => {
            const config = cfg as unknown as GeodeConfig;
            const msg = buildHelloMessage(config);

            expect(msg['type']).toBe('HELLO');
            expect(msg['client_name']).toBe(cfg.helloName);
            expect(msg['client_ver']).toBe(cfg.helloVersion);
            expect(msg['wanted_conformance']).toBe(cfg.conformance);

            if (cfg.username) {
              expect(msg['username']).toBe(cfg.username);
            }
            if (cfg.password) {
              expect(msg['password']).toBe(cfg.password);
            }

            return true;
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
