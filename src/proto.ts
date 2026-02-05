/**
 * Geode Protobuf Wire Protocol
 *
 * Uses protobufjs for encoding/decoding protocol messages.
 * Wire format for QUIC: 4-byte Big Endian length prefix + protobuf message body.
 */

import * as protobuf from 'protobufjs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the directory of this module for proto file resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTO_PATH = path.resolve(__dirname, '..', 'proto', 'geode.proto');

// --- Type definitions matching geode.proto ---

export interface HelloRequest {
  username: string;
  password: string;
  tenantId?: string;
  clientName: string;
  clientVersion: string;
  wantedConformance: string;
}

export interface HelloResponse {
  success: boolean;
  sessionId: string;
  errorMessage: string;
  capabilities: string[];
}

export interface Param {
  name: string;
  value: ProtoValue;
}

export interface ExecuteRequest {
  sessionId: string;
  query: string;
  params: Param[];
}

export interface PullRequest {
  requestId: bigint | number;
  pageSize: number;
  sessionId: string;
}

export interface PullResponse {
  response?: ExecutionResponse;
}

export interface Status {
  statusClass: string;
  statusSubclass: string;
  additionalStatuses: string[];
  flaggerFindings: string[];
}

export interface ColumnDefinition {
  name: string;
  type: string;
}

export interface SchemaDefinition {
  columns: ColumnDefinition[];
}

export interface ProtoValue {
  nullVal?: NullValue;
  intVal?: IntValue;
  doubleVal?: DoubleValue;
  boolVal?: BoolValue;
  stringVal?: StringValue;
  decimalVal?: DecimalValue;
  bytesVal?: BytesValue;
  listVal?: ListValue;
  mapVal?: MapValue;
  nodeVal?: NodeValue;
  edgeVal?: EdgeValue;
  pathVal?: PathValue;
  extVal?: ExtendedValue;
}

// Empty interface for protobuf null value message
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NullValue {}

export interface IntValue {
  value: bigint | number;
  kind: number;
}

export interface DoubleValue {
  value: number;
  kind: number;
}

export interface BoolValue {
  value: boolean;
}

export interface StringValue {
  value: string;
  kind: number;
}

export interface DecimalValue {
  coeff: string;
  scale: number;
  origScale: number;
  origRepr: string;
}

export interface BytesValue {
  value: Uint8Array;
  kind: number;
}

export interface ListValue {
  values: ProtoValue[];
}

export interface MapEntry {
  key: string;
  value: ProtoValue;
}

export interface MapValue {
  entries: MapEntry[];
}

export interface NodeValue {
  id: bigint | number;
  labels: string[];
  properties: MapEntry[];
}

export interface EdgeValue {
  id: bigint | number;
  fromId: bigint | number;
  toId: bigint | number;
  label: string;
  properties: MapEntry[];
}

export interface PathValue {
  nodes: NodeValue[];
  edges: EdgeValue[];
}

export interface ExtendedValue {
  typeName: string;
  text?: string;
  bytes?: Uint8Array;
  intVal?: bigint | number;
  doubleVal?: number;
  boolVal?: boolean;
}

export interface Row {
  values: ProtoValue[];
}

export interface DataPage {
  rows: Row[];
  final: boolean;
  ordered: boolean;
  orderKeys: string[];
}

export interface ProtoError {
  code: string;
  message: string;
  type: string;
  anchor: string;
}

export interface ExecutionMetrics {
  parseDurationNs: bigint | number;
  planDurationNs: bigint | number;
  executeDurationNs: bigint | number;
  totalDurationNs: bigint | number;
}

export interface ExplainTotals {
  cost?: number;
  est_rows?: number;
}

export interface ExplainPayload {
  schema: string;
  ops: unknown[];
  totals?: ExplainTotals;
  properties: unknown;
  calibration: unknown;
  profileVersion: number;
}

export interface ProfileMemory {
  netBytes?: number | bigint;
  peakBytes?: number | bigint;
  totalAllocBytes?: number | bigint;
}

export interface ProfilePayload {
  profileVersion: number;
  ops: unknown[];
  peakContributors: unknown[];
  totals: unknown;
  totalTimeNs: bigint | number;
  spills: unknown;
  memory?: ProfileMemory;
  plannerEstimates: unknown;
  memCurve: unknown[];
  setop: unknown;
  hashaggSpills: bigint | number;
  hashaggSpillReason: string;
  committedTxns: bigint | number;
  graphStoreNodes: bigint | number;
  graphStoreEdges: bigint | number;
  graphStoreDirty: boolean;
  flaggerFindings: string[];
  compact: boolean;
}

// Empty interface for protobuf heartbeat message
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Heartbeat {}

export interface ExecutionResponse {
  status?: Status;
  schema?: SchemaDefinition;
  page?: DataPage;
  error?: ProtoError;
  metrics?: ExecutionMetrics;
  explain?: ExplainPayload;
  profile?: ProfilePayload;
  heartbeat?: Heartbeat;
}

// Empty interface for protobuf ping request message
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PingRequest {}
export interface PingResponse {
  ok: boolean;
}

export interface BeginRequest {
  readOnly: boolean;
  sessionId: string;
}
export interface BeginResponse {
  sessionId: string;
  txId: string;
}

export interface CommitRequest {
  sessionId: string;
}
export interface CommitResponse {
  success: boolean;
}

export interface RollbackRequest {
  sessionId: string;
}
export interface RollbackResponse {
  success: boolean;
}

export interface SavepointRequest {
  name: string;
  sessionId: string;
}
export interface SavepointResponse {
  success: boolean;
}

export interface RollbackToRequest {
  name: string;
  sessionId: string;
}
export interface RollbackToResponse {
  success: boolean;
}

export interface QuicClientMessage {
  hello?: HelloRequest;
  execute?: ExecuteRequest;
  pull?: PullRequest;
  ping?: PingRequest;
  cdcDiag?: unknown;
  cdcCtrl?: unknown;
  begin?: BeginRequest;
  commit?: CommitRequest;
  rollback?: RollbackRequest;
  savepoint?: SavepointRequest;
  rollbackTo?: RollbackToRequest;
  backup?: unknown;
  restore?: unknown;
  uploadBackup?: unknown;
}

export interface QuicServerMessage {
  hello?: HelloResponse;
  execute?: ExecutionResponse;
  pull?: PullResponse;
  ping?: PingResponse;
  cdcDiag?: unknown;
  cdcCtrl?: unknown;
  begin?: BeginResponse;
  commit?: CommitResponse;
  rollback?: RollbackResponse;
  savepoint?: SavepointResponse;
  rollbackTo?: RollbackToResponse;
  backup?: unknown;
  restore?: unknown;
  uploadBackup?: unknown;
}

// --- Protobuf Root and Message Types ---

let protoRoot: protobuf.Root | null = null;
let QuicClientMessageType: protobuf.Type | null = null;
let QuicServerMessageType: protobuf.Type | null = null;

/**
 * Initialize protobuf types from the proto file.
 * This is done lazily on first use.
 */
async function initProto(): Promise<void> {
  if (protoRoot) return;

  protoRoot = await protobuf.load(PROTO_PATH);
  QuicClientMessageType = protoRoot.lookupType('geode.QuicClientMessage');
  QuicServerMessageType = protoRoot.lookupType('geode.QuicServerMessage');
}

/**
 * Initialize protobuf types synchronously (for use after async init).
 */
function initProtoSync(): void {
  if (protoRoot) return;

  protoRoot = protobuf.loadSync(PROTO_PATH);
  QuicClientMessageType = protoRoot.lookupType('geode.QuicClientMessage');
  QuicServerMessageType = protoRoot.lookupType('geode.QuicServerMessage');
}

// Initialize on module load
initProtoSync();

/**
 * Ensure proto is initialized.
 */
export async function ensureProtoInitialized(): Promise<void> {
  if (!protoRoot) {
    await initProto();
  }
}

/**
 * Convert a JavaScript value to a protobuf Value message.
 */
export function jsToProtoValue(value: unknown): ProtoValue {
  if (value === null || value === undefined) {
    return { nullVal: {} };
  }

  if (typeof value === 'boolean') {
    return { boolVal: { value } };
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { intVal: { value, kind: 1 } }; // INT
    }
    return { doubleVal: { value, kind: 1 } }; // DOUBLE
  }

  if (typeof value === 'bigint') {
    return { intVal: { value, kind: 3 } }; // BIGINT
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

  if (val.boolVal !== undefined) return val.boolVal.value;

  if (val.intVal !== undefined) {
    const n = val.intVal.value;
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
    const obj: Record<string, unknown> = {};
    for (const entry of val.mapVal.entries) {
      obj[entry.key] = protoValueToJS(entry.value);
    }
    return obj;
  }

  if (val.nodeVal !== undefined) {
    const node = val.nodeVal;
    const props: Record<string, unknown> = {};
    for (const entry of node.properties) {
      props[entry.key] = protoValueToJS(entry.value);
    }
    return {
      id: typeof node.id === 'bigint' ? node.id : BigInt(node.id),
      labels: node.labels,
      properties: props,
    };
  }

  if (val.edgeVal !== undefined) {
    const edge = val.edgeVal;
    const props: Record<string, unknown> = {};
    for (const entry of edge.properties) {
      props[entry.key] = protoValueToJS(entry.value);
    }
    return {
      id: typeof edge.id === 'bigint' ? edge.id : BigInt(edge.id),
      fromId: typeof edge.fromId === 'bigint' ? edge.fromId : BigInt(edge.fromId),
      toId: typeof edge.toId === 'bigint' ? edge.toId : BigInt(edge.toId),
      label: edge.label,
      properties: props,
    };
  }

  if (val.pathVal !== undefined) {
    const path = val.pathVal;
    return {
      nodes: path.nodes.map((n) => protoValueToJS({ nodeVal: n })),
      edges: path.edges.map((e) => protoValueToJS({ edgeVal: e })),
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
  if (!QuicClientMessageType) {
    initProtoSync();
  }

  const err = QuicClientMessageType!.verify(msg);
  if (err) {
    throw new Error(`Invalid QuicClientMessage: ${err}`);
  }

  const message = QuicClientMessageType!.create(msg);
  const buffer = QuicClientMessageType!.encode(message).finish();
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
  if (!QuicServerMessageType) {
    initProtoSync();
  }

  const message = QuicServerMessageType!.decode(data);
  return QuicServerMessageType!.toObject(message, {
    longs: Number,
    enums: Number,
    bytes: Buffer,
    defaults: true,
  }) as QuicServerMessage;
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
  tenantId?: string
): QuicClientMessage {
  return {
    hello: {
      username,
      password,
      tenantId,
      clientName,
      clientVersion,
      wantedConformance: conformance,
    },
  };
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
  const record: Record<string, unknown> = {};
  for (let i = 0; i < columns.length && i < row.values.length; i++) {
    const col = columns[i]!;
    const val = row.values[i]!;
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
