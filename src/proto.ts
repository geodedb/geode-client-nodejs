/**
 * Geode Protobuf Wire Protocol
 *
 * Encoding/decoding of protocol messages using the protoc + ts-proto generated
 * bindings (src/generated/geode.ts), which are produced from the canonical
 * geode server proto. This eliminates proto drift: there are no longer any
 * hand-written message interfaces, and the proto is no longer parsed at runtime
 * via protobufjs.
 *
 * Wire format for QUIC: 4-byte Big Endian length prefix + protobuf message body.
 *
 * The public API (the build/encode/decode/value-conversion helpers and the
 * exported types) is preserved exactly. Legacy type names that differ from the
 * proto message names are aliased: the proto `Value` message is exported as
 * `ProtoValue`, and the proto `Error` message as `ProtoError`.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSafeObjectKey } from './types.js';
import {
  QuicClientMessage as QuicClientMessageCodec,
  QuicServerMessage as QuicServerMessageCodec,
  type QuicClientMessage,
  type QuicServerMessage,
  type HelloRequest,
  type HelloResponse,
  type Param,
  type ExecuteRequest,
  type PullRequest,
  type PullResponse,
  type Status,
  type ColumnDefinition,
  type SchemaDefinition,
  type Value,
  type NullValue,
  type IntValue,
  type DoubleValue,
  type StringValue,
  type DecimalValue,
  type BytesValue,
  type ListValue,
  type MapEntry,
  type MapValue,
  type NodeValue,
  type EdgeValue,
  type PathValue,
  type ExtendedValue,
  type Row,
  type DataPage,
  type Error as ProtoErrorMsg,
  type ExecutionMetrics,
  type ExplainTotals,
  type ExplainPayload,
  type ProfileMemory,
  type ProfilePayload,
  type Heartbeat,
  type ExecutionResponse,
  type PingRequest,
  type PingResponse,
  type BeginRequest,
  type BeginResponse,
  type CommitRequest,
  type CommitResponse,
  type RollbackRequest,
  type RollbackResponse,
  type SavepointRequest,
  type SavepointResponse,
  type RollbackToRequest,
  type RollbackToResponse,
} from './generated/geode.js';

// Get the directory of this module for proto file resolution.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTO_PATH = path.resolve(__dirname, '..', 'proto', 'geode.proto');

// --- Public type re-exports (sourced from the generated bindings) ---
//
// These preserve the historical public API. `ProtoValue` and `ProtoError` are
// aliases for the proto `Value` and `Error` messages respectively.
export type {
  QuicClientMessage,
  QuicServerMessage,
  HelloRequest,
  HelloResponse,
  Param,
  ExecuteRequest,
  PullRequest,
  PullResponse,
  Status,
  ColumnDefinition,
  SchemaDefinition,
  NullValue,
  IntValue,
  DoubleValue,
  StringValue,
  DecimalValue,
  BytesValue,
  ListValue,
  MapEntry,
  MapValue,
  NodeValue,
  EdgeValue,
  PathValue,
  ExtendedValue,
  Row,
  DataPage,
  ExecutionMetrics,
  ExplainTotals,
  ExplainPayload,
  ProfileMemory,
  ProfilePayload,
  Heartbeat,
  ExecutionResponse,
  PingRequest,
  PingResponse,
  BeginRequest,
  BeginResponse,
  CommitRequest,
  CommitResponse,
  RollbackRequest,
  RollbackResponse,
  SavepointRequest,
  SavepointResponse,
  RollbackToRequest,
  RollbackToResponse,
};

/** A protobuf `Value` message (alias preserved for API stability). */
export type ProtoValue = Value;
/** A protobuf `Error` message (alias preserved for API stability). */
export type ProtoError = ProtoErrorMsg;

// --- Proto initialization (no-ops, kept for API stability) ---
//
// The bindings are statically imported, so there is no runtime proto load to
// perform. These functions are retained as no-ops so existing callers that
// proactively initialize the codec continue to work unchanged.

/**
 * Initialize protobuf types synchronously.
 *
 * No-op: bindings are generated at build time (protoc + ts-proto) and statically
 * imported, so no runtime initialization is required. Retained for API stability.
 */
export function initProtoSync(): void {
  // Intentionally empty: generated bindings require no runtime initialization.
}

/**
 * Ensure proto is initialized.
 *
 * No-op: see {@link initProtoSync}. Retained for API stability.
 */
export function ensureProtoInitialized(): Promise<void> {
  return Promise.resolve();
}

/**
 * Convert a JavaScript value to a protobuf Value message.
 */
export function jsToProtoValue(value: unknown): ProtoValue {
  if (value === null || value === undefined) {
    return { nullVal: {} };
  }

  if (typeof value === 'boolean') {
    return { boolVal: value };
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { intVal: { value, kind: 1 } }; // INT
    }
    return { doubleVal: { value, kind: 1 } }; // DOUBLE
  }

  if (typeof value === 'bigint') {
    return { intVal: { value: value as unknown as number, kind: 3 } }; // BIGINT
  }

  if (typeof value === 'string') {
    return { stringVal: { value, kind: 1 } }; // STRING
  }

  if (Array.isArray(value)) {
    return {
      listVal: {
        values: value.map(jsToProtoValue),
      },
    };
  }

  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return { bytesVal: { value: value as Uint8Array, kind: 1 } }; // BYTEA
  }

  if (typeof value === 'object') {
    const entries: MapEntry[] = [];
    for (const [k, v] of Object.entries(value)) {
      entries.push({ key: k, value: jsToProtoValue(v) });
    }
    return { mapVal: { entries } };
  }

  // Default fallback for symbol/function types - convert to string representation
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- Intentional fallback for edge cases
  return { stringVal: { value: String(value), kind: 1 } };
}

/**
 * Convert a protobuf Value to a JavaScript value.
 */
export function protoValueToJS(val: ProtoValue): unknown {
  if (val.nullVal !== undefined) return null;

  if (val.boolVal !== undefined) return val.boolVal;

  if (val.intVal !== undefined) {
    const n = val.intVal.value as number | bigint;
    if (typeof n === 'bigint') {
      if (n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(n);
      }
      return n;
    }
    return n;
  }

  if (val.doubleVal !== undefined) return val.doubleVal.value;

  if (val.stringVal !== undefined) return val.stringVal.value;

  if (val.decimalVal !== undefined) {
    // Return as string to preserve precision
    return val.decimalVal.origRepr || val.decimalVal.coeff;
  }

  if (val.bytesVal !== undefined) return Buffer.from(val.bytesVal.value);

  if (val.listVal !== undefined) {
    return val.listVal.values.map(protoValueToJS);
  }

  if (val.mapVal !== undefined) {
    const obj = Object.create(null) as Record<string, unknown>;
    for (const entry of val.mapVal.entries) {
      if (!isSafeObjectKey(entry.key)) {
        throw new Error(
          `Map contains dangerous key that could cause prototype pollution: keys like '__proto__', 'constructor', or 'prototype' are not allowed`
        );
      }
      obj[entry.key] = protoValueToJS(entry.value ?? {});
    }
    return obj;
  }

  if (val.nodeVal !== undefined) {
    const node = val.nodeVal;
    const props = Object.create(null) as Record<string, unknown>;
    for (const entry of node.properties) {
      if (!isSafeObjectKey(entry.key)) {
        throw new Error(
          `Node property contains dangerous key that could cause prototype pollution: keys like '__proto__', 'constructor', or 'prototype' are not allowed`
        );
      }
      props[entry.key] = protoValueToJS(entry.value ?? {});
    }
    return {
      id: typeof node.id === 'bigint' ? node.id : BigInt(node.id),
      labels: node.labels,
      properties: props,
    };
  }

  if (val.edgeVal !== undefined) {
    const edge = val.edgeVal;
    const props = Object.create(null) as Record<string, unknown>;
    for (const entry of edge.properties) {
      if (!isSafeObjectKey(entry.key)) {
        throw new Error(
          `Edge property contains dangerous key that could cause prototype pollution: keys like '__proto__', 'constructor', or 'prototype' are not allowed`
        );
      }
      props[entry.key] = protoValueToJS(entry.value ?? {});
    }
    return {
      id: typeof edge.id === 'bigint' ? edge.id : BigInt(edge.id),
      startNode: typeof edge.fromId === 'bigint' ? edge.fromId : BigInt(edge.fromId),
      endNode: typeof edge.toId === 'bigint' ? edge.toId : BigInt(edge.toId),
      type: edge.label,
      properties: props,
    };
  }

  if (val.pathVal !== undefined) {
    const p = val.pathVal;
    return {
      nodes: p.nodes.map((n) => protoValueToJS({ nodeVal: n })),
      edges: p.edges.map((e) => protoValueToJS({ edgeVal: e })),
    };
  }

  if (val.extVal !== undefined) {
    const ext = val.extVal;
    if (ext.text !== undefined) return ext.text;
    if (ext.bytes !== undefined) return Buffer.from(ext.bytes);
    if (ext.intVal !== undefined) return ext.intVal;
    if (ext.doubleVal !== undefined) return ext.doubleVal;
    if (ext.boolVal !== undefined) return ext.boolVal;
    return null;
  }

  return null;
}

/**
 * Encode a QuicClientMessage to protobuf bytes.
 */
export function encodeQuicClientMessage(msg: QuicClientMessage): Buffer {
  const buffer = QuicClientMessageCodec.encode(msg).finish();
  return Buffer.from(buffer);
}

/**
 * Encode a QuicClientMessage with 4-byte big-endian length prefix.
 */
export function encodeWithLengthPrefix(msg: QuicClientMessage): Buffer {
  const data = encodeQuicClientMessage(msg);
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  return Buffer.concat([lengthBuf, data]);
}

/**
 * Decode a QuicServerMessage from protobuf bytes.
 */
export function decodeQuicServerMessage(data: Buffer | Uint8Array): QuicServerMessage {
  return QuicServerMessageCodec.decode(data);
}

/**
 * Decode 4-byte big-endian length prefix.
 */
export function decodeLengthPrefix(data: Buffer): number {
  if (data.length < 4) {
    throw new Error('Insufficient data for length prefix');
  }
  return data.readUInt32BE(0);
}

/**
 * Build a HelloRequest message.
 */
export function buildHelloRequest(
  username: string,
  password: string,
  clientName: string,
  clientVersion: string,
  conformance: string,
  tenantId?: string,
  graph?: string,
  role?: string
): QuicClientMessage {
  const helloReq: HelloRequest = {
    username,
    password,
    clientName,
    clientVersion,
    wantedConformance: conformance,
    ...(tenantId ? { tenantId } : {}),
    ...(graph ? { graph } : {}),
    ...(role ? { role } : {}),
  };
  return { hello: helloReq };
}

/**
 * Build an ExecuteRequest message.
 */
export function buildExecuteRequest(
  sessionId: string,
  query: string,
  params?: Record<string, unknown>
): QuicClientMessage {
  const protoParams: Param[] = [];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      protoParams.push({
        name,
        value: jsToProtoValue(value),
      });
    }
  }

  return {
    execute: {
      sessionId,
      query,
      params: protoParams,
    },
  };
}

/**
 * Build a PullRequest message.
 */
export function buildPullRequest(
  requestId: number,
  pageSize: number,
  sessionId: string
): QuicClientMessage {
  return {
    pull: {
      requestId,
      pageSize,
      sessionId,
    },
  };
}

/**
 * Build a PingRequest message.
 */
export function buildPingRequest(): QuicClientMessage {
  return { ping: {} };
}

/**
 * Build a BeginRequest message.
 */
export function buildBeginRequest(readOnly: boolean, sessionId: string): QuicClientMessage {
  return {
    begin: {
      readOnly,
      sessionId,
    },
  };
}

/**
 * Build a CommitRequest message.
 */
export function buildCommitRequest(sessionId: string): QuicClientMessage {
  return {
    commit: {
      sessionId,
    },
  };
}

/**
 * Build a RollbackRequest message.
 */
export function buildRollbackRequest(sessionId: string): QuicClientMessage {
  return {
    rollback: {
      sessionId,
    },
  };
}

/**
 * Build a SavepointRequest message.
 */
export function buildSavepointRequest(name: string, sessionId: string): QuicClientMessage {
  return {
    savepoint: {
      name,
      sessionId,
    },
  };
}

/**
 * Build a RollbackToRequest message.
 */
export function buildRollbackToRequest(name: string, sessionId: string): QuicClientMessage {
  return {
    rollbackTo: {
      name,
      sessionId,
    },
  };
}

/**
 * Convert a DataPage row to a record of column name -> value.
 */
export function rowToRecord(row: Row, columns: ColumnDefinition[]): Record<string, unknown> {
  const record = Object.create(null) as Record<string, unknown>;
  for (let i = 0; i < columns.length && i < row.values.length; i++) {
    const col = columns[i]!;
    const val = row.values[i]!;
    if (!isSafeObjectKey(col.name)) {
      throw new Error(
        `Row contains dangerous column name that could cause prototype pollution: column names like '__proto__', 'constructor', or 'prototype' are not allowed`
      );
    }
    record[col.name] = protoValueToJS(val);
  }
  return record;
}

/**
 * Get proto file path for gRPC loader.
 */
export function getProtoPath(): string {
  return PROTO_PATH;
}
