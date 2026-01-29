/**
 * Geode Wire Protocol
 *
 * JSON line protocol implementation for communication with Geode server.
 */

import {
  parse as losslessParse,
  stringify as losslessStringify,
  isLosslessNumber,
  type NumberStringifier,
} from 'lossless-json';
import type { GeodeConfig } from './config.js';
import { DriverError, TransportError, StatusClass } from './errors.js';
import type { ColumnDef, ColumnInfo } from './types.js';
import { parseGQLType } from './types.js';

/**
 * Custom reviver for lossless-json that converts numbers to BigInt
 * when they exceed JavaScript's safe integer range, preserving precision.
 *
 * This fixes the bug where node/edge IDs (which are often 18+ digit integers)
 * lose precision when parsed with standard JSON.parse().
 */
function bigIntReviver(_key: string, value: unknown): unknown {
  if (isLosslessNumber(value)) {
    const str = (value as { value: string }).value;
    // Check if it's an integer (no decimal point or exponent)
    if (/^-?\d+$/.test(str)) {
      const num = Number(str);
      // If the number is within safe range, return as number
      if (Number.isSafeInteger(num)) {
        return num;
      }
      // Otherwise return as BigInt to preserve precision
      return BigInt(str);
    }
    // For floats, use regular number conversion
    return Number(str);
  }
  return value;
}

// Client message types
export const MsgType = {
  HELLO: 'HELLO',
  RUN_GQL: 'RUN_GQL',
  PULL: 'PULL',
  BEGIN: 'BEGIN',
  COMMIT: 'COMMIT',
  ROLLBACK: 'ROLLBACK',
  SAVEPOINT: 'SAVEPOINT',
  ROLLBACK_TO: 'ROLLBACK_TO',
  PING: 'PING',
} as const;

export type MsgType = (typeof MsgType)[keyof typeof MsgType];

// Server response types
export const RespType = {
  HELLO: 'HELLO',
  SCHEMA: 'SCHEMA',
  BINDINGS: 'BINDINGS',
  ERROR: 'ERROR',
  EXPLAIN: 'EXPLAIN',
  PROFILE: 'PROFILE',
  RESULT: 'RESULT',
  STATUS: 'STATUS',
} as const;

export type RespType = (typeof RespType)[keyof typeof RespType];

/**
 * Additional diagnostic information from error frames.
 */
export interface AdditionalInfo {
  code?: string;
  message?: string;
}

/**
 * Frame result structure.
 */
export interface FrameResult {
  type: RespType;
  // SCHEMA
  columns?: ColumnDef[];
  // BINDINGS
  rows?: Record<string, unknown>[];
  ordered?: boolean;
  order_keys?: string[];
  final?: boolean;
  // ERROR
  code?: string;
  message?: string;
  anchor?: string;
  additional?: AdditionalInfo[];
  flagger_findings?: string[];
  // EXPLAIN/PROFILE
  json?: unknown;
}

/**
 * Wire protocol frame structure.
 */
export interface Frame {
  status_class: string;
  status_subclass: string;
  result: FrameResult;
}

/**
 * Parse a JSON frame from raw bytes.
 *
 * Uses lossless-json to preserve precision for large integers (> Number.MAX_SAFE_INTEGER).
 * This is critical for node/edge IDs which may be 18+ digit integers.
 */
export function parseFrame(data: Buffer | string): Frame {
  let str: string;
  if (Buffer.isBuffer(data)) {
    str = data.toString('utf-8');
  } else {
    str = data;
  }

  try {
    // Use lossless-json with custom reviver to preserve large integer precision
    const frame = losslessParse(str, bigIntReviver) as Frame;

    // Validate frame structure
    // Note: Some responses (like HELLO) may have a simpler structure
    if (!frame.result || typeof frame.result.type !== 'string') {
      // Check if this is a top-level response (non-nested)
      const topLevel = frame as unknown as {
        type?: string;
        status_class?: string;
        columns?: unknown[];
        rows?: unknown[];
      };

      if (typeof topLevel.type === 'string') {
        // Convert to expected frame structure (ERROR, HELLO, etc.)
        return {
          status_class: topLevel.status_class ?? '00000',
          status_subclass: '000',
          result: frame as unknown as FrameResult,
        };
      }

      // Handle responses without type field (like BEGIN/COMMIT/ROLLBACK responses)
      // These have status_class and possibly columns/rows but no explicit type
      if (typeof topLevel.status_class === 'string') {
        // Determine type based on content
        const resultType = Array.isArray(topLevel.columns) ? RespType.BINDINGS : RespType.STATUS;

        return {
          status_class: topLevel.status_class,
          status_subclass: '000',
          result: {
            type: resultType,
            ...frame,
          } as FrameResult,
        };
      }

      throw new TransportError({
        operation: 'parse_frame',
        cause: new Error(
          `invalid frame structure: missing result.type. Received: ${str.slice(0, 200)}`
        ),
      });
    }

    return frame;
  } catch (e) {
    if (e instanceof TransportError) {
      throw e;
    }
    throw new TransportError({
      operation: 'parse_frame',
      cause: e instanceof Error ? e : new Error(String(e)),
    });
  }
}

/**
 * Check if a frame represents an error.
 */
export function isErrorFrame(frame: Frame): boolean {
  return frame.result.type === RespType.ERROR;
}

/**
 * Check if a frame represents a schema.
 */
export function isSchemaFrame(frame: Frame): boolean {
  return frame.result.type === RespType.SCHEMA;
}

/**
 * Check if a frame represents bindings (rows).
 */
export function isBindingsFrame(frame: Frame): boolean {
  return frame.result.type === RespType.BINDINGS;
}

/**
 * Check if a frame is the final frame in a result set.
 */
export function isFinalFrame(frame: Frame): boolean {
  return frame.result.final === true;
}

/**
 * Convert an error frame to a DriverError.
 */
export function frameToError(frame: Frame): DriverError {
  const result = frame.result;

  const additional: string[] = [];
  if (result.additional) {
    for (const info of result.additional) {
      if (info.message) {
        additional.push(info.message);
      } else if (info.code) {
        additional.push(info.code);
      }
    }
  }

  return new DriverError({
    statusClass: (frame.status_class || StatusClass.SYSTEM) as typeof StatusClass.SYSTEM,
    subclass: frame.status_subclass || '000',
    code: result.code ?? 'UnknownError',
    message: result.message ?? 'Unknown error',
    anchor: result.anchor,
    additional,
    findings: result.flagger_findings,
  });
}

/**
 * Get column info from a schema frame.
 */
export function getColumnsFromSchema(frame: Frame): ColumnInfo[] {
  if (!isSchemaFrame(frame)) {
    throw new Error('Expected SCHEMA frame');
  }

  const columns = frame.result.columns ?? [];
  return columns.map((col) => ({
    name: col.name,
    type: col.type,
    kind: parseGQLType(col.type),
  }));
}

// Message builders

/**
 * Build a HELLO message.
 */
export function buildHelloMessage(cfg: GeodeConfig): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    type: MsgType.HELLO,
    client_name: cfg.helloName,
    client_ver: cfg.helloVersion,
    wanted_conformance: cfg.conformance,
  };

  // Include credentials if provided
  if (cfg.username) {
    msg['username'] = cfg.username;
  }
  if (cfg.password) {
    msg['password'] = cfg.password;
  }

  return msg;
}

/**
 * Build a RUN_GQL message.
 */
export function buildRunGQLMessage(
  query: string,
  params?: Record<string, unknown>
): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    type: MsgType.RUN_GQL,
    text: query,
  };

  if (params && Object.keys(params).length > 0) {
    msg['params'] = params;
  }

  return msg;
}

/**
 * Build a PULL message.
 */
export function buildPullMessage(requestId: number, pageSize: number): Record<string, unknown> {
  return {
    type: MsgType.PULL,
    request_id: requestId,
    page_size: pageSize,
  };
}

/**
 * Build a BEGIN message.
 */
export function buildBeginMessage(): Record<string, unknown> {
  return {
    type: MsgType.BEGIN,
  };
}

/**
 * Build a COMMIT message.
 */
export function buildCommitMessage(): Record<string, unknown> {
  return {
    type: MsgType.COMMIT,
  };
}

/**
 * Build a ROLLBACK message.
 */
export function buildRollbackMessage(): Record<string, unknown> {
  return {
    type: MsgType.ROLLBACK,
  };
}

/**
 * Build a SAVEPOINT message.
 */
export function buildSavepointMessage(name: string): Record<string, unknown> {
  return {
    type: MsgType.SAVEPOINT,
    name,
  };
}

/**
 * Build a ROLLBACK_TO message.
 */
export function buildRollbackToMessage(name: string): Record<string, unknown> {
  return {
    type: MsgType.ROLLBACK_TO,
    name,
  };
}

/**
 * Build a PING message.
 */
export function buildPingMessage(): Record<string, unknown> {
  return {
    type: MsgType.PING,
  };
}

/**
 * Custom stringifier for BigInt values.
 * Serializes BigInt as numbers without quotes to maintain wire protocol compatibility.
 */
const bigIntStringifier: NumberStringifier = {
  test: (value: unknown): boolean => typeof value === 'bigint',
  stringify: (value: unknown): string => (value as bigint).toString(),
};

/**
 * Serialize a message to JSON line format.
 *
 * Uses lossless-json with a custom BigInt stringifier to properly serialize
 * BigInt values as numbers without quotes, maintaining wire protocol compatibility.
 */
export function serializeMessage(msg: Record<string, unknown>): Buffer {
  const json = losslessStringify(msg, undefined, undefined, [bigIntStringifier]);
  return Buffer.from(json + '\n', 'utf-8');
}

/**
 * Rewrite positional placeholders (?) to named parameters ($p1, $p2, ...).
 */
export function rewritePlaceholders(
  query: string,
  args: unknown[]
): { query: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {};
  let argIndex = 0;
  let result = '';
  let i = 0;

  while (i < query.length) {
    const ch = query[i];

    // Skip string literals
    if (ch === "'" || ch === '"') {
      const quote = ch;
      result += ch;
      i++;
      while (i < query.length && query[i] !== quote) {
        if (query[i] === '\\' && i + 1 < query.length) {
          result += query[i];
          i++;
        }
        result += query[i];
        i++;
      }
      if (i < query.length) {
        result += query[i];
        i++;
      }
      continue;
    }

    // Replace ? with $pN
    if (ch === '?') {
      argIndex++;
      const paramName = `p${argIndex}`;
      result += '$' + paramName;
      if (argIndex <= args.length) {
        params[paramName] = args[argIndex - 1];
      }
      i++;
      continue;
    }

    result += ch;
    i++;
  }

  return { query: result, params };
}

/**
 * Count the number of ? placeholders in a query.
 */
export function countPlaceholders(query: string): number {
  let count = 0;
  let i = 0;

  while (i < query.length) {
    const ch = query[i];

    // Skip string literals
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < query.length && query[i] !== quote) {
        if (query[i] === '\\') {
          i++;
        }
        i++;
      }
      i++;
      continue;
    }

    if (ch === '?') {
      count++;
    }
    i++;
  }

  return count;
}

/**
 * Merge named parameters with positional parameters.
 */
export function mergeParams(
  positionalParams: Record<string, unknown>,
  namedParams?: Record<string, unknown>
): Record<string, unknown> {
  if (!namedParams || Object.keys(namedParams).length === 0) {
    return positionalParams;
  }
  return { ...positionalParams, ...namedParams };
}
