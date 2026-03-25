/**
 * GQL Value Class
 *
 * Type-safe wrapper for GQL values in the ISO/IEC 39075:2024 type system.
 * Extracted from types.ts for file size management.
 */

// Import Decimal from decimal.js-light
// The module has compatibility issues with TypeScript ESM declarations, so we use type-only import + runtime require
import type { Decimal } from 'decimal.js-light';

import type { GQLValueKind, GQLNode, GQLEdge, GQLPath, GQLRange } from './types.js';

/**
 * Dangerous keys that could lead to prototype pollution if allowed.
 * These keys are rejected when converting values to objects.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Check if a key is safe for object property assignment.
 * Rejects keys that could lead to prototype pollution.
 */
export function isSafeObjectKey(key: string): boolean {
  return !DANGEROUS_KEYS.has(key);
}

// Create Decimal at runtime to avoid TypeScript declaration issues
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Dynamic import requires type assertion
const DecimalClass: new (value: string | number) => Decimal =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Module type is incompatible
  (await import('decimal.js-light')).default as any;

// Helper to check if value is Decimal (duck typing)
function isDecimal(value: unknown): value is Decimal {
  return value !== null && typeof value === 'object' && 'toFixed' in value && 'toNumber' in value;
}

// Helper to create Decimal
function createDecimal(value: string | number | Decimal): Decimal {
  if (isDecimal(value)) return value;
  return new DecimalClass(value);
}

/**
 * GQL Value wrapper for type-safe value handling.
 */
export class GQLValue {
  readonly kind: GQLValueKind;

  private _intValue?: bigint;
  private _floatValue?: number;
  private _boolValue?: boolean;
  private _stringValue?: string;
  private _decimalValue?: Decimal;
  private _arrayValue?: GQLValue[];
  private _objectValue?: Map<string, GQLValue>;
  private _bytesValue?: Uint8Array;
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
    v._decimalValue = createDecimal(value);
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
    return this._boolValue!;
  }

  get asInt(): bigint {
    if (this.kind !== 'INT') {
      throw new TypeError(`Cannot convert ${this.kind} to int`);
    }
    return this._intValue!;
  }

  get asNumber(): number {
    if (this.kind === 'INT') {
      return Number(this._intValue!);
    }
    if (this.kind === 'FLOAT') {
      return this._floatValue!;
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
    return this._floatValue!;
  }

  get asString(): string {
    if (this.kind === 'STRING' || this.kind === 'UUID') {
      return this._stringValue!;
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
    return this._arrayValue!;
  }

  get asObject(): Map<string, GQLValue> {
    if (this.kind !== 'OBJECT' && this.kind !== 'NODE' && this.kind !== 'EDGE') {
      throw new TypeError(`Cannot convert ${this.kind} to object`);
    }
    return this._objectValue ?? new Map();
  }

  get asBytes(): Uint8Array {
    if (this.kind !== 'BYTEA') {
      throw new TypeError(`Cannot convert ${this.kind} to bytes`);
    }
    return this._bytesValue!;
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
        return (this._boolValue ?? false).toString();
      case 'INT':
        return (this._intValue ?? 0n).toString();
      case 'FLOAT':
        return (this._floatValue ?? 0).toString();
      case 'STRING':
      case 'UUID':
        return this._stringValue ?? '';
      case 'DECIMAL':
        return this._decimalValue?.toString() ?? '0';
      case 'ARRAY':
        return `[${(this._arrayValue ?? []).map((v) => v.toString()).join(', ')}]`;
      case 'OBJECT':
        return `{${[...(this._objectValue ?? new Map()).entries()]
          .map(([k, v]) => `${k}: ${v.toString()}`)
          .join(', ')}}`;
      case 'BYTEA':
        return `<bytes:${(this._bytesValue ?? new Uint8Array()).length}>`;
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
        return this._boolValue ?? false;
      case 'INT': {
        // Return number if safe, bigint otherwise
        const intVal = this._intValue ?? 0n;
        if (intVal >= Number.MIN_SAFE_INTEGER && intVal <= Number.MAX_SAFE_INTEGER) {
          return Number(intVal);
        }
        return intVal;
      }
      case 'FLOAT':
        return this._floatValue ?? 0;
      case 'STRING':
      case 'UUID':
        return this._stringValue ?? '';
      case 'DECIMAL':
        return this._decimalValue?.toString();
      case 'ARRAY':
        return (this._arrayValue ?? []).map((v) => v.toJS());
      case 'OBJECT': {
        const obj = Object.create(null) as Record<string, unknown>;
        for (const [k, v] of (this._objectValue ?? new Map()).entries()) {
          if (!isSafeObjectKey(k)) {
            throw new Error(
              `Object contains dangerous key that could cause prototype pollution: keys like '__proto__', 'constructor', or 'prototype' are not allowed`
            );
          }
          obj[k] = v.toJS();
        }
        return obj;
      }
      case 'BYTEA':
        return this._bytesValue ?? new Uint8Array();
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
