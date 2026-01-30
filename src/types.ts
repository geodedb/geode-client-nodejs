/**
 * GQL Type System
 *
 * Implements the GQL value type system for ISO/IEC 39075:2024 compliance.
 */

import Decimal from 'decimal.js-light';

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
 * GQL Value wrapper for type-safe value handling.
 */
export class GQLValue {
  readonly kind: GQLValueKind;

  private _intValue: bigint = 0n;
  private _floatValue: number = 0;
  private _boolValue: boolean = false;
  private _stringValue: string = '';
  private _decimalValue?: Decimal;
  private _arrayValue: GQLValue[] = [];
  private _objectValue: Map<string, GQLValue> = new Map();
  private _bytesValue: Uint8Array = new Uint8Array();
  private _dateValue?: Date;
  private _rangeValue?: GQLRange;
  private _nodeValue?: GQLNode;
  private _edgeValue?: GQLEdge;
  private _pathValue?: GQLPath;
  private _rawValue?: unknown;

  private constructor(kind: GQLValueKind) {
    this.kind = kind;
  }

  // Factory methods
  static null(): GQLValue {
    return new GQLValue('NULL');
  }

  static bool(value: boolean): GQLValue {
    const v = new GQLValue('BOOL');
    v._boolValue = value;
    return v;
  }

  static int(value: number | bigint): GQLValue {
    const v = new GQLValue('INT');
    v._intValue = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
    return v;
  }

  static float(value: number): GQLValue {
    const v = new GQLValue('FLOAT');
    v._floatValue = value;
    return v;
  }

  static string(value: string): GQLValue {
    const v = new GQLValue('STRING');
    v._stringValue = value;
    return v;
  }

  static decimal(value: string | number | Decimal): GQLValue {
    const v = new GQLValue('DECIMAL');
    v._decimalValue = value instanceof Decimal ? value : new Decimal(value);
    return v;
  }

  static array(values: GQLValue[]): GQLValue {
    const v = new GQLValue('ARRAY');
    v._arrayValue = values;
    return v;
  }

  static object(values: Map<string, GQLValue> | Record<string, GQLValue>): GQLValue {
    const v = new GQLValue('OBJECT');
    v._objectValue = values instanceof Map ? values : new Map(Object.entries(values));
    return v;
  }

  static bytes(value: Uint8Array | Buffer): GQLValue {
    const v = new GQLValue('BYTEA');
    v._bytesValue = value instanceof Uint8Array ? value : new Uint8Array(value);
    return v;
  }

  static date(value: Date): GQLValue {
    const v = new GQLValue('DATE');
    v._dateValue = value;
    return v;
  }

  static time(value: Date): GQLValue {
    const v = new GQLValue('TIME');
    v._dateValue = value;
    return v;
  }

  static timestamp(value: Date): GQLValue {
    const v = new GQLValue('TIMESTAMP');
    v._dateValue = value;
    return v;
  }

  static uuid(value: string): GQLValue {
    const v = new GQLValue('UUID');
    v._stringValue = value;
    return v;
  }

  static json(value: unknown): GQLValue {
    const v = new GQLValue('JSON');
    v._rawValue = value;
    return v;
  }

  static node(value: GQLNode): GQLValue {
    const v = new GQLValue('NODE');
    v._nodeValue = value;
    return v;
  }

  static edge(value: GQLEdge): GQLValue {
    const v = new GQLValue('EDGE');
    v._edgeValue = value;
    return v;
  }

  static path(value: GQLPath): GQLValue {
    const v = new GQLValue('PATH');
    v._pathValue = value;
    return v;
  }

  static range<T>(value: GQLRange<T>): GQLValue {
    const v = new GQLValue('RANGE');
    v._rangeValue = value as GQLRange;
    return v;
  }

  static unknown(value: unknown): GQLValue {
    const v = new GQLValue('UNKNOWN');
    v._rawValue = value;
    return v;
  }

  // Type-safe accessors
  get isNull(): boolean {
    return this.kind === 'NULL';
  }

  get asBool(): boolean {
    if (this.kind !== 'BOOL') {
      throw new TypeError(`Cannot convert ${this.kind} to boolean`);
    }
    return this._boolValue;
  }

  get asInt(): bigint {
    if (this.kind !== 'INT') {
      throw new TypeError(`Cannot convert ${this.kind} to int`);
    }
    return this._intValue;
  }

  get asNumber(): number {
    if (this.kind === 'INT') {
      return Number(this._intValue);
    }
    if (this.kind === 'FLOAT') {
      return this._floatValue;
    }
    if (this.kind === 'DECIMAL') {
      return this._decimalValue?.toNumber() ?? 0;
    }
    throw new TypeError(`Cannot convert ${this.kind} to number`);
  }

  get asFloat(): number {
    if (this.kind !== 'FLOAT') {
      throw new TypeError(`Cannot convert ${this.kind} to float`);
    }
    return this._floatValue;
  }

  get asString(): string {
    if (this.kind === 'STRING' || this.kind === 'UUID') {
      return this._stringValue;
    }
    // Allow stringification of other types
    return this.toString();
  }

  get asDecimal(): Decimal {
    if (this.kind !== 'DECIMAL') {
      throw new TypeError(`Cannot convert ${this.kind} to decimal`);
    }
    return this._decimalValue!;
  }

  get asArray(): GQLValue[] {
    if (this.kind !== 'ARRAY') {
      throw new TypeError(`Cannot convert ${this.kind} to array`);
    }
    return this._arrayValue;
  }

  get asObject(): Map<string, GQLValue> {
    if (this.kind !== 'OBJECT' && this.kind !== 'NODE' && this.kind !== 'EDGE') {
      throw new TypeError(`Cannot convert ${this.kind} to object`);
    }
    return this._objectValue;
  }

  get asBytes(): Uint8Array {
    if (this.kind !== 'BYTEA') {
      throw new TypeError(`Cannot convert ${this.kind} to bytes`);
    }
    return this._bytesValue;
  }

  get asDate(): Date {
    if (
      this.kind !== 'DATE' &&
      this.kind !== 'TIME' &&
      this.kind !== 'TIMETZ' &&
      this.kind !== 'TIMESTAMP' &&
      this.kind !== 'TIMESTAMPTZ'
    ) {
      throw new TypeError(`Cannot convert ${this.kind} to date`);
    }
    return this._dateValue!;
  }

  get asNode(): GQLNode {
    if (this.kind !== 'NODE') {
      throw new TypeError(`Cannot convert ${this.kind} to node`);
    }
    return this._nodeValue!;
  }

  get asEdge(): GQLEdge {
    if (this.kind !== 'EDGE') {
      throw new TypeError(`Cannot convert ${this.kind} to edge`);
    }
    return this._edgeValue!;
  }

  get asPath(): GQLPath {
    if (this.kind !== 'PATH') {
      throw new TypeError(`Cannot convert ${this.kind} to path`);
    }
    return this._pathValue!;
  }

  get asRange(): GQLRange {
    if (this.kind !== 'RANGE') {
      throw new TypeError(`Cannot convert ${this.kind} to range`);
    }
    return this._rangeValue!;
  }

  get asJSON(): unknown {
    if (this.kind !== 'JSON' && this.kind !== 'JSONB') {
      throw new TypeError(`Cannot convert ${this.kind} to JSON`);
    }
    return this._rawValue;
  }

  get raw(): unknown {
    return this._rawValue;
  }

  toString(): string {
    switch (this.kind) {
      case 'NULL':
        return 'null';
      case 'BOOL':
        return this._boolValue.toString();
      case 'INT':
        return this._intValue.toString();
      case 'FLOAT':
        return this._floatValue.toString();
      case 'STRING':
      case 'UUID':
        return this._stringValue;
      case 'DECIMAL':
        return this._decimalValue?.toString() ?? '0';
      case 'ARRAY':
        return `[${this._arrayValue.map((v) => v.toString()).join(', ')}]`;
      case 'OBJECT':
        return `{${[...this._objectValue.entries()]
          .map(([k, v]) => `${k}: ${v.toString()}`)
          .join(', ')}}`;
      case 'BYTEA':
        return `<bytes:${this._bytesValue.length}>`;
      case 'DATE':
      case 'TIME':
      case 'TIMETZ':
      case 'TIMESTAMP':
      case 'TIMESTAMPTZ':
        return this._dateValue?.toISOString() ?? '';
      case 'NODE':
        return `(${this._nodeValue?.labels.join(':')} {${JSON.stringify(this._nodeValue?.properties)}})`;
      case 'EDGE':
        return `[${this._edgeValue?.type} {${JSON.stringify(this._edgeValue?.properties)}}]`;
      case 'PATH':
        return `<path:${this._pathValue?.nodes.length} nodes>`;
      case 'JSON':
      case 'JSONB':
        return JSON.stringify(this._rawValue);
      default:
        // Fallback for unknown types - safe to stringify
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return String(this._rawValue ?? '');
    }
  }

  /**
   * Convert to a plain JavaScript value.
   */
  toJS(): unknown {
    switch (this.kind) {
      case 'NULL':
        return null;
      case 'BOOL':
        return this._boolValue;
      case 'INT':
        // Return number if safe, bigint otherwise
        if (
          this._intValue >= Number.MIN_SAFE_INTEGER &&
          this._intValue <= Number.MAX_SAFE_INTEGER
        ) {
          return Number(this._intValue);
        }
        return this._intValue;
      case 'FLOAT':
        return this._floatValue;
      case 'STRING':
      case 'UUID':
        return this._stringValue;
      case 'DECIMAL':
        return this._decimalValue?.toString();
      case 'ARRAY':
        return this._arrayValue.map((v) => v.toJS());
      case 'OBJECT':
        return Object.fromEntries([...this._objectValue.entries()].map(([k, v]) => [k, v.toJS()]));
      case 'BYTEA':
        return this._bytesValue;
      case 'DATE':
      case 'TIME':
      case 'TIMETZ':
      case 'TIMESTAMP':
      case 'TIMESTAMPTZ':
        return this._dateValue;
      case 'NODE':
        return this._nodeValue;
      case 'EDGE':
        return this._edgeValue;
      case 'PATH':
        return this._pathValue;
      case 'RANGE':
        return this._rangeValue;
      case 'JSON':
      case 'JSONB':
        return this._rawValue;
      default:
        return this._rawValue;
    }
  }

  /**
   * Convert to JSON-serializable format.
   */
  toJSON(): unknown {
    return this.toJS();
  }
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
    // Check for UUID pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return GQLValue.uuid(value);
    }
    // Check for ISO date
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value)) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return GQLValue.timestamp(date);
      }
    }
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

/**
 * Dangerous keys that could lead to prototype pollution if allowed.
 * These keys are rejected when converting rows to objects.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Check if a key is safe for object property assignment.
 * Rejects keys that could lead to prototype pollution.
 */
export function isSafeObjectKey(key: string): boolean {
  return !DANGEROUS_KEYS.has(key);
}

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
