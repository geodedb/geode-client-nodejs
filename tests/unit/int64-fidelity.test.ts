import { describe, it, expect } from 'vitest';
import protobuf from 'protobufjs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeQuicServerMessage, protoValueToJS, rowToRecord } from '../../src/proto.js';
import type { QuicServerMessage, Value as ProtoValue } from '../../src/proto.js';

/**
 * ENG-3908: int64 fields decoded over QUIC lose fidelity.
 *
 * The generated decoder (src/generated/geode.ts, produced with ts-proto
 * `forceLong=number`) funnels every int64/uint64 field through `longToNumber`,
 * which THROWS `Value is larger than Number.MAX_SAFE_INTEGER` for any value
 * above 2^53. Server-generated graph ids routinely exceed that, so
 * `decodeQuicServerMessage` throws instead of returning the row.
 *
 * Intended contract (src/types.ts `GQLId = string | number | bigint`, and the
 * safe-integer narrowing already present in `protoValueToJS`): decoding is
 * LOSSLESS -- a plain `number` when the value fits in the safe-integer range,
 * a `BigInt` otherwise. Never a throw, never a truncation.
 *
 * These tests encode canonical wire bytes with protobufjs (independent of the
 * generated decoder under test) and assert the decoded JS values round-trip.
 */

const __test_dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__test_dirname, '..', '..', 'proto', 'geode.proto');

const root = protobuf.loadSync(PROTO_PATH);
const ServerMessageType = root.lookupType('geode.QuicServerMessage');

const MAX_SAFE = 9007199254740991n; // 2^53 - 1
const TWO_POW_53 = 9007199254740992n; // 2^53
const UNSAFE = 9007199254740993n; // 2^53 + 1 -- smallest int64 that a double cannot hold
const INT64_MAX = 9223372036854775807n; // 2^63 - 1
const INT64_MIN = -9223372036854775808n; // -2^63
const UINT64_MAX = 18446744073709551615n; // 2^64 - 1

/** Encode a QuicServerMessage to canonical protobuf bytes (no length prefix). */
function encodeServerMsg(msg: object): Buffer {
  return Buffer.from(ServerMessageType.encode(ServerMessageType.create(msg)).finish());
}

/** Wrap a single Value in a final, single-row ExecutionResponse page. */
function pageWithValue(value: object): object {
  return {
    execute: {
      page: {
        rows: [{ values: [value] }],
        final: true,
        ordered: false,
        orderKeys: [],
      },
    },
  };
}

/** Decode wire bytes and return the single Value carried by the page. */
function decodeSingleValue(msg: object): ProtoValue {
  const decoded: QuicServerMessage = decodeQuicServerMessage(encodeServerMsg(msg));
  const page = decoded.execute?.page;
  expect(page).toBeDefined();
  const value = page?.rows?.[0]?.values?.[0];
  expect(value).toBeDefined();
  return value as ProtoValue;
}

/**
 * Assert a decoded integer field carries exactly `expected`, whatever numeric
 * representation the decoder chose (number | bigint | string). This is the
 * "no data loss on the wire" assertion and is deliberately representation
 * agnostic; the JS-facing type contract is asserted separately below.
 */
function expectExactInteger(actual: unknown, expected: bigint): void {
  expect(actual).toBeDefined();
  expect(typeof actual).not.toBe('object');
  expect(BigInt(actual as number | bigint | string)).toBe(expected);
}

describe('ENG-3908 int64 wire fidelity: decodeQuicServerMessage', () => {
  describe('IntValue.value (int64)', () => {
    it('decodes a safe int64 (2^53 - 1) exactly [control]', () => {
      const value = decodeSingleValue(
        pageWithValue({ intVal: { value: MAX_SAFE.toString(), kind: 3 } })
      );
      expectExactInteger(value.intVal?.value, MAX_SAFE);
    });

    // Regression: ENG-3908 -- this exact input made decodeQuicServerMessage throw
    // "Value is larger than Number.MAX_SAFE_INTEGER", which QuicTransport swallowed,
    // stalling the inline read until the client fell back to PULL and the server
    // answered 02000 "no active result set".
    it('decodes an unsafe int64 (2^53 + 1) losslessly instead of throwing [regression]', () => {
      const value = decodeSingleValue(
        pageWithValue({ intVal: { value: UNSAFE.toString(), kind: 3 } })
      );
      expectExactInteger(value.intVal?.value, UNSAFE);
    });

    it('decodes exactly 2^53 losslessly [boundary]', () => {
      const value = decodeSingleValue(
        pageWithValue({ intVal: { value: TWO_POW_53.toString(), kind: 3 } })
      );
      expectExactInteger(value.intVal?.value, TWO_POW_53);
    });

    it('decodes int64 max (2^63 - 1) losslessly [boundary]', () => {
      const value = decodeSingleValue(
        pageWithValue({ intVal: { value: INT64_MAX.toString(), kind: 3 } })
      );
      expectExactInteger(value.intVal?.value, INT64_MAX);
    });

    it('decodes int64 min (-2^63) losslessly [boundary]', () => {
      const value = decodeSingleValue(
        pageWithValue({ intVal: { value: INT64_MIN.toString(), kind: 3 } })
      );
      expectExactInteger(value.intVal?.value, INT64_MIN);
    });

    it('decodes a large negative int64 below -2^53 losslessly [boundary]', () => {
      const value = decodeSingleValue(
        pageWithValue({ intVal: { value: (-UNSAFE).toString(), kind: 3 } })
      );
      expectExactInteger(value.intVal?.value, -UNSAFE);
    });
  });

  describe('NodeValue.id (uint64)', () => {
    it('decodes a safe node id exactly [control]', () => {
      const value = decodeSingleValue(
        pageWithValue({ nodeVal: { id: '42', labels: ['Person'], properties: [] } })
      );
      expectExactInteger(value.nodeVal?.id, 42n);
    });

    // Regression: ENG-3908 -- server-assigned node ids exceed 2^53.
    it('decodes a node id above 2^53 losslessly [regression]', () => {
      const value = decodeSingleValue(
        pageWithValue({ nodeVal: { id: UNSAFE.toString(), labels: ['Person'], properties: [] } })
      );
      expectExactInteger(value.nodeVal?.id, UNSAFE);
    });

    it('decodes uint64 max node id losslessly [boundary]', () => {
      const value = decodeSingleValue(
        pageWithValue({
          nodeVal: { id: UINT64_MAX.toString(), labels: ['Person'], properties: [] },
        })
      );
      expectExactInteger(value.nodeVal?.id, UINT64_MAX);
    });
  });

  describe('EdgeValue.{id,fromId,toId} (uint64)', () => {
    // Regression: ENG-3908 -- all three edge endpoints are affected.
    it('decodes edge id/fromId/toId above 2^53 losslessly [regression]', () => {
      const value = decodeSingleValue(
        pageWithValue({
          edgeVal: {
            id: UNSAFE.toString(),
            fromId: (UNSAFE + 1n).toString(),
            toId: (UNSAFE + 2n).toString(),
            label: 'KNOWS',
            properties: [],
          },
        })
      );
      expectExactInteger(value.edgeVal?.id, UNSAFE);
      expectExactInteger(value.edgeVal?.fromId, UNSAFE + 1n);
      expectExactInteger(value.edgeVal?.toId, UNSAFE + 2n);
    });
  });

  describe('ExtendedValue.intVal (int64)', () => {
    it('decodes an extended int64 above 2^53 losslessly [regression]', () => {
      const value = decodeSingleValue(
        pageWithValue({ extVal: { typeName: 'geode.bigint', intVal: UNSAFE.toString() } })
      );
      expectExactInteger(value.extVal?.intVal, UNSAFE);
    });
  });

  describe('multi-field page', () => {
    it('decodes a row mixing safe and unsafe int64 columns [regression]', () => {
      const decoded: QuicServerMessage = decodeQuicServerMessage(
        encodeServerMsg({
          execute: {
            page: {
              rows: [
                {
                  values: [
                    { intVal: { value: '7', kind: 3 } },
                    { intVal: { value: UNSAFE.toString(), kind: 3 } },
                    { stringVal: { value: 'tail', kind: 1 } },
                  ],
                },
              ],
              final: true,
              ordered: false,
              orderKeys: [],
            },
          },
        })
      );
      const values = decoded.execute?.page?.rows?.[0]?.values ?? [];
      expect(values).toHaveLength(3);
      expectExactInteger(values[0]?.intVal?.value, 7n);
      expectExactInteger(values[1]?.intVal?.value, UNSAFE);
      expect(values[2]?.stringVal?.value).toBe('tail');
    });
  });
});

describe('ENG-3908 JS value contract: number if safe, bigint otherwise', () => {
  it('converts a safe int64 to a plain number', () => {
    const value = decodeSingleValue(
      pageWithValue({ intVal: { value: MAX_SAFE.toString(), kind: 3 } })
    );
    const js = protoValueToJS(value);
    expect(typeof js).toBe('number');
    expect(js).toBe(9007199254740991);
  });

  it('converts an unsafe int64 to a BigInt with the exact value [regression]', () => {
    const value = decodeSingleValue(
      pageWithValue({ intVal: { value: UNSAFE.toString(), kind: 3 } })
    );
    const js = protoValueToJS(value);
    expect(typeof js).toBe('bigint');
    expect(js).toBe(9007199254740993n);
  });

  it('exposes node ids as exact BigInts through rowToRecord [regression]', () => {
    const value = decodeSingleValue(
      pageWithValue({ nodeVal: { id: UNSAFE.toString(), labels: ['Person'], properties: [] } })
    );
    const record = rowToRecord({ values: [value] }, [{ name: 'n', type: 'NODE' }]);
    const node = record['n'] as { id: bigint; labels: string[] };
    expect(node.id).toBe(9007199254740993n);
    expect(node.labels).toEqual(['Person']);
  });

  it('exposes edge endpoints as exact BigInts through rowToRecord [regression]', () => {
    const value = decodeSingleValue(
      pageWithValue({
        edgeVal: {
          id: UNSAFE.toString(),
          fromId: (UNSAFE + 1n).toString(),
          toId: (UNSAFE + 2n).toString(),
          label: 'KNOWS',
          properties: [],
        },
      })
    );
    const record = rowToRecord({ values: [value] }, [{ name: 'e', type: 'EDGE' }]);
    const edge = record['e'] as { id: bigint; startNode: bigint; endNode: bigint; type: string };
    expect(edge.id).toBe(9007199254740993n);
    expect(edge.startNode).toBe(9007199254740994n);
    expect(edge.endNode).toBe(9007199254740995n);
    expect(edge.type).toBe('KNOWS');
  });

  it('exposes an unsafe id() projection as a BigInt through rowToRecord [regression]', () => {
    const value = decodeSingleValue(
      pageWithValue({ intVal: { value: UNSAFE.toString(), kind: 3 } })
    );
    const record = rowToRecord({ values: [value] }, [{ name: 'id', type: 'BIGINT' }]);
    expect(record['id']).toBe(9007199254740993n);
  });
});
