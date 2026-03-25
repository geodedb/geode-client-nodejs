/**
 * GQL Type System
 *
 * Implements the GQL value type system for ISO/IEC 39075:2024 compliance.
 */

// Import GQLValue and isSafeObjectKey from dedicated module (for local use)
import { GQLValue, isSafeObjectKey } from './gql-value.js';

// Re-export GQLValue for consumers
export { GQLValue } from './gql-value.js';

/**
 * GQL value kind enumeration.
 */
export type GQLValueKind =
  | 'NULL'
  | 'BOOL'
  | 'INT'
  | 'FLOAT'
  | 'STRING'
  | 'DECIMAL'
  | 'BYTEA'
  | 'DATE'
  | 'TIME'
  | 'TIMETZ'
  | 'TIMESTAMP'
  | 'TIMESTAMPTZ'
  | 'INTERVAL'
  | 'JSON'
  | 'JSONB'
  | 'XML'
  | 'URL'
  | 'DOMAIN'
  | 'UUID'
  | 'ENUM'
  | 'BIT_STRING'
  | 'RANGE'
  | 'ARRAY'
  | 'OBJECT'
  | 'NODE'
  | 'EDGE'
  | 'PATH'
  | 'UNKNOWN';

/**
 * GQL type enumeration for wire protocol.
 */
export type GQLType =
  | 'INT'
  | 'INTEGER'
  | 'BIGINT'
  | 'FLOAT'
  | 'DOUBLE'
  | 'REAL'
  | 'DECIMAL'
  | 'STRING'
  | 'VARCHAR'
  | 'TEXT'
  | 'BOOL'
  | 'BOOLEAN'
  | 'NULL'
  | 'LIST'
  | 'ARRAY'
  | 'MAP'
  | 'RECORD'
  | 'NODE'
  | 'EDGE'
  | 'RELATIONSHIP'
  | 'PATH'
  | 'BYTEA'
  | 'DATE'
  | 'TIME'
  | 'TIMETZ'
  | 'TIMESTAMP'
  | 'TIMESTAMPTZ'
  | 'INTERVAL'
  | 'JSON'
  | 'JSONB'
  | 'XML'
  | 'UUID'
  | 'URL'
  | 'DOMAIN'
  | 'ENUM'
  | 'BIT'
  | 'VARBIT'
  | 'UNKNOWN';

/**
 * Range bounds for GQL range types.
 */
export interface GQLRange<T = unknown> {
  lower?: T;
  upper?: T;
  lowerInclusive: boolean;
  upperInclusive: boolean;
}

/**
 * Type alias for node/edge IDs.
 *
 * IDs can be:
 * - string: String-based IDs or hex format IDs
 * - number: Integer IDs within JavaScript's safe integer range
 * - bigint: Integer IDs larger than Number.MAX_SAFE_INTEGER (2^53 - 1)
 *
 * Note: Geode's internal IDs often exceed JavaScript's safe integer limit,
 * so bigint is used to preserve full precision.
 */
export type GQLId = string | number | bigint;

/**
 * Node structure from graph queries.
 */
export interface GQLNode {
  id: GQLId;
  labels: string[];
  properties: Record<string, unknown>;
}

/**
 * Edge structure from graph queries.
 *
 * Note: The server may return edge endpoints as either:
 * - `startNode`/`endNode` (normalized form used by the client)
 * - `from`/`to` (alternative wire format)
 *
 * The client normalizes both formats to `startNode`/`endNode`.
 */
export interface GQLEdge {
  id: GQLId;
  type: string;
  startNode: GQLId;
  endNode: GQLId;
  properties: Record<string, unknown>;
}

/**
 * Raw edge structure as it may appear in wire format.
 * Used internally for parsing before normalization.
 */
export interface RawEdge {
  id: GQLId;
  type: string;
  startNode?: GQLId;
  endNode?: GQLId;
  from?: GQLId;
  to?: GQLId;
  properties?: Record<string, unknown>;
}

/**
 * Path structure from graph queries.
 */
export interface GQLPath {
  nodes: GQLNode[];
  edges: GQLEdge[];
}

/**
 * Parse a GQL type string to GQLValueKind.
 */
export function parseGQLType(typeStr: string): GQLValueKind {
  const upper = typeStr.toUpperCase();
  switch (upper) {
    case 'INT':
    case 'INTEGER':
    case 'BIGINT':
    case 'INT8':
    case 'INT16':
    case 'INT32':
    case 'INT64':
    case 'UINT8':
    case 'UINT16':
    case 'UINT32':
    case 'UINT64':
    case 'SMALLINT':
    case 'TINYINT':
      return 'INT';
    case 'FLOAT':
    case 'DOUBLE':
    case 'REAL':
    case 'FLOAT32':
    case 'FLOAT64':
      return 'FLOAT';
    case 'DECIMAL':
    case 'NUMERIC':
      return 'DECIMAL';
    case 'STRING':
    case 'VARCHAR':
    case 'TEXT':
      return 'STRING';
    case 'BOOL':
    case 'BOOLEAN':
      return 'BOOL';
    case 'NULL':
      return 'NULL';
    case 'LIST':
    case 'ARRAY':
      return 'ARRAY';
    case 'MAP':
    case 'RECORD':
    case 'OBJECT':
      return 'OBJECT';
    case 'NODE':
      return 'NODE';
    case 'EDGE':
    case 'RELATIONSHIP':
      return 'EDGE';
    case 'PATH':
      return 'PATH';
    case 'BYTEA':
    case 'BINARY':
      return 'BYTEA';
    case 'DATE':
      return 'DATE';
    case 'TIME':
      return 'TIME';
    case 'TIMETZ':
    case 'TIME WITH TIME ZONE':
      return 'TIMETZ';
    case 'TIMESTAMP':
      return 'TIMESTAMP';
    case 'TIMESTAMPTZ':
    case 'TIMESTAMP WITH TIME ZONE':
      return 'TIMESTAMPTZ';
    case 'INTERVAL':
      return 'INTERVAL';
    case 'JSON':
      return 'JSON';
    case 'JSONB':
      return 'JSONB';
    case 'XML':
      return 'XML';
    case 'UUID':
      return 'UUID';
    case 'URL':
      return 'URL';
    case 'DOMAIN':
      return 'DOMAIN';
    case 'ENUM':
      return 'ENUM';
    case 'BIT':
    case 'VARBIT':
      return 'BIT_STRING';
    default:
      if (upper.includes('RANGE')) {
        return 'RANGE';
      }
      return 'UNKNOWN';
  }
}

/**
 * Convert a JSON value from the server to a GQLValue.
 */
export function fromJSON(value: unknown, typeHint?: GQLValueKind): GQLValue {
  if (value === null || value === undefined) {
    return GQLValue.null();
  }

  // If we have a type hint, use it
  if (typeHint) {
    return convertWithType(value, typeHint);
  }

  // Infer type from value
  if (typeof value === 'boolean') {
    return GQLValue.bool(value);
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return GQLValue.int(value);
    }
    return GQLValue.float(value);
  }

  if (typeof value === 'bigint') {
    return GQLValue.int(value);
  }

  if (typeof value === 'string') {
    return GQLValue.string(value);
  }

  if (Array.isArray(value)) {
    return GQLValue.array(value.map((v) => fromJSON(v)));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Check for node structure
    if ('id' in obj && 'labels' in obj && 'properties' in obj) {
      return GQLValue.node(obj as unknown as GQLNode);
    }

    // Check for edge structure (supports both startNode/endNode and from/to formats)
    if ('id' in obj && 'type' in obj) {
      const hasStartEnd = 'startNode' in obj && 'endNode' in obj;
      const hasFromTo = 'from' in obj && 'to' in obj;

      if (hasStartEnd || hasFromTo) {
        // Normalize to startNode/endNode format
        const rawEdge = obj as unknown as RawEdge;
        const normalizedEdge: GQLEdge = {
          id: rawEdge.id,
          type: rawEdge.type,
          startNode: rawEdge.startNode ?? rawEdge.from ?? '',
          endNode: rawEdge.endNode ?? rawEdge.to ?? '',
          properties: rawEdge.properties ?? {},
        };
        return GQLValue.edge(normalizedEdge);
      }
    }

    // Check for path structure
    if ('nodes' in obj && 'edges' in obj && Array.isArray(obj.nodes)) {
      return GQLValue.path(obj as unknown as GQLPath);
    }

    // Generic object
    const map = new Map<string, GQLValue>();
    for (const [k, v] of Object.entries(obj)) {
      map.set(k, fromJSON(v));
    }
    return GQLValue.object(map);
  }

  return GQLValue.unknown(value);
}

/**
 * Convert a value with a known type hint.
 */
function convertWithType(value: unknown, type: GQLValueKind): GQLValue {
  switch (type) {
    case 'NULL':
      return GQLValue.null();
    case 'BOOL':
      // Handle string booleans from server
      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        return GQLValue.bool(lower === 'true' || lower === '1' || lower === 't');
      }
      return GQLValue.bool(Boolean(value));
    case 'INT':
      if (typeof value === 'number') {
        return GQLValue.int(value);
      }
      if (typeof value === 'bigint') {
        return GQLValue.int(value);
      }
      if (typeof value === 'string') {
        // Handle empty string or non-numeric gracefully
        const trimmed = value.trim();
        if (trimmed === '' || isNaN(Number(trimmed))) {
          return GQLValue.int(0);
        }
        return GQLValue.int(BigInt(trimmed));
      }
      return GQLValue.int(0);
    case 'FLOAT':
      return GQLValue.float(Number(value));
    case 'DECIMAL':
      return GQLValue.decimal(String(value));
    case 'STRING':
      // If the value is actually a different type (not a string), infer type from value
      // This handles cases where server reports "text" but sends typed values
      if (typeof value !== 'string') {
        return fromJSON(value);
      }
      return GQLValue.string(value);
    case 'UUID':
      return GQLValue.uuid(String(value));
    case 'BYTEA':
      if (value instanceof Uint8Array) {
        return GQLValue.bytes(value);
      }
      if (typeof value === 'string') {
        return GQLValue.bytes(Buffer.from(value, 'base64'));
      }
      return GQLValue.bytes(new Uint8Array());
    case 'DATE':
      return GQLValue.date(value instanceof Date ? value : new Date(String(value)));
    case 'TIME':
    case 'TIMETZ':
      return GQLValue.time(value instanceof Date ? value : new Date(String(value)));
    case 'TIMESTAMP':
    case 'TIMESTAMPTZ':
      return GQLValue.timestamp(value instanceof Date ? value : new Date(String(value)));
    case 'JSON':
    case 'JSONB':
      return GQLValue.json(value);
    case 'ARRAY':
      if (Array.isArray(value)) {
        return GQLValue.array(value.map((v) => fromJSON(v)));
      }
      // Handle JSON string arrays from server
      if (typeof value === 'string') {
        try {
          const parsed: unknown = JSON.parse(value);
          if (Array.isArray(parsed)) {
            return GQLValue.array(parsed.map((v: unknown) => fromJSON(v)));
          }
        } catch {
          // Not valid JSON, return empty array
        }
      }
      return GQLValue.array([]);
    case 'OBJECT':
      // Handle JSON string objects from server
      if (typeof value === 'string') {
        try {
          const parsed: unknown = JSON.parse(value);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return fromJSON(parsed);
          }
        } catch {
          // Not valid JSON
        }
      }
      return fromJSON(value);
    case 'NODE':
      return GQLValue.node(value as GQLNode);
    case 'EDGE': {
      // Normalize edge format (supports both startNode/endNode and from/to)
      const rawEdge = value as RawEdge;
      const normalizedEdge: GQLEdge = {
        id: rawEdge.id,
        type: rawEdge.type,
        startNode: rawEdge.startNode ?? rawEdge.from ?? '',
        endNode: rawEdge.endNode ?? rawEdge.to ?? '',
        properties: rawEdge.properties ?? {},
      };
      return GQLValue.edge(normalizedEdge);
    }
    case 'PATH':
      return GQLValue.path(value as GQLPath);
    default:
      return fromJSON(value);
  }
}

/**
 * Column definition from SCHEMA response.
 */
export interface ColumnDef {
  name: string;
  type: GQLType;
}

/**
 * Column metadata with parsed type.
 */
export interface ColumnInfo {
  name: string;
  type: GQLType;
  kind: GQLValueKind;
}

/**
 * Query result row.
 */
export type Row = Map<string, GQLValue>;

/**
 * Convert raw row data to typed Row.
 */
export function parseRow(raw: Record<string, unknown>, columns: ColumnInfo[]): Row {
  const row = new Map<string, GQLValue>();
  for (const col of columns) {
    const value = raw[col.name];
    row.set(col.name, fromJSON(value, col.kind));
  }
  return row;
}

// Re-export isSafeObjectKey from gql-value (canonical location)
export { isSafeObjectKey } from './gql-value.js';

/**
 * Convert Row to plain object.
 *
 * Security: Uses Object.create(null) to create a prototype-free object
 * and rejects dangerous keys (__proto__, constructor, prototype) that
 * could lead to prototype pollution attacks.
 *
 * @throws {Error} If a row contains a dangerous key
 */
export function rowToObject(row: Row): Record<string, unknown> {
  // GAP #17: Use Object.create(null) for prototype-free object
  const obj = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of row) {
    // GAP #17: Reject dangerous keys to prevent prototype pollution
    if (!isSafeObjectKey(key)) {
      throw new Error(
        `Row contains dangerous key that could cause prototype pollution: column names like '__proto__', 'constructor', or 'prototype' are not allowed`
      );
    }
    obj[key] = value.toJS();
  }
  return obj;
}
