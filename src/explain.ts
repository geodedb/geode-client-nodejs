/**
 * Query Explain and Profile
 *
 * Support for query plan analysis and execution profiling using protobuf protocol.
 */

import type { Connection, QueryOptions } from './connection.js';
import { validateQuery, validateParamValue } from './validate.js';
import { DriverError, TransportError, StatusClass } from './errors.js';
import {
  buildExecuteRequest,
  type ExecutionResponse,
  type ExplainPayload,
  type ProfilePayload,
} from './proto.js';

/**
 * A single operation in a query plan.
 */
export interface PlanOperation {
  /** Operation type (e.g., 'NodeScan', 'Filter', 'Expand') */
  type: string;
  /** Optional operator name */
  operator?: string;
  /** Estimated cost */
  cost?: number;
  /** Estimated rows */
  rows?: number;
  /** Details about the operation */
  details?: Record<string, unknown>;
  /** Child operations */
  children?: PlanOperation[];
}

/**
 * Query execution plan.
 */
export interface QueryPlan {
  /** Root operation */
  root: PlanOperation;
  /** Total estimated cost */
  totalCost?: number;
  /** Total estimated rows */
  totalRows?: number;
  /** Raw plan data from server */
  raw: unknown;
}

/**
 * Timing information for profiled operations.
 */
export interface OperationTiming {
  /** Operation type */
  type: string;
  /** Wall clock time in milliseconds */
  wallTimeMs: number;
  /** CPU time in milliseconds */
  cpuTimeMs?: number;
  /** Actual rows produced */
  rows?: number;
  /** Number of database page hits */
  pageHits?: number;
  /** Number of database page faults */
  pageFaults?: number;
  /** Child operation timings */
  children?: OperationTiming[];
}

/**
 * Query execution profile.
 */
export interface QueryProfile {
  /** Root operation timing */
  root: OperationTiming;
  /** Total execution time in milliseconds */
  totalTimeMs: number;
  /** Total rows processed */
  totalRows?: number;
  /** Planning time in milliseconds */
  planningTimeMs?: number;
  /** Execution time in milliseconds */
  executionTimeMs?: number;
  /** Memory used in bytes */
  memoryBytes?: number;
  /** Raw profile data from server */
  raw: unknown;
}

/**
 * Options for explain/profile operations.
 */
export interface ExplainOptions extends Omit<QueryOptions, 'pageSize'> {
  /** Include verbose details */
  verbose?: boolean;
  /** Analyze query costs */
  analyze?: boolean;
}

/**
 * Parse plan data from ExplainPayload.
 */
function parseExplainPayload(payload: ExplainPayload): PlanOperation {
  const ops = payload.ops ?? [];
  if (ops.length === 0) {
    return { type: 'Unknown', details: { schema: payload.schema } };
  }

  // Build operation tree
  const root: PlanOperation = {
    type: 'Query',
    details: { schema: payload.schema },
    children: ops.map((op: unknown) => {
      const opObj = op as Record<string, unknown>;
      return {
        type: (opObj['kind'] as string) || 'Unknown',
        cost: opObj['cost'] as number | undefined,
        rows: opObj['est_rows'] as number | undefined,
        details: { idx: opObj['idx'] },
      };
    }),
  };

  return root;
}

/**
 * Parse profile data from ProfilePayload.
 */
function parseProfilePayload(payload: ProfilePayload): OperationTiming {
  const ops = payload.ops ?? [];
  if (ops.length === 0) {
    return { type: 'Unknown', wallTimeMs: 0 };
  }

  // Build timing tree
  const children: OperationTiming[] = ops.map((op: unknown) => {
    const opObj = op as Record<string, unknown>;
    return {
      type: (opObj['op'] as string) || 'Unknown',
      wallTimeMs: Number(opObj['time_ns'] ?? 0) / 1_000_000,
      cpuTimeMs: Number(opObj['cpu_time_ns'] ?? 0) / 1_000_000,
      rows: Number(opObj['rows'] ?? 0),
    };
  });

  return {
    type: 'Query',
    wallTimeMs: Number(payload.totalTimeNs ?? 0) / 1_000_000,
    children,
  };
}

/**
 * Get the query execution plan without executing.
 */
export async function explain(
  conn: Connection,
  query: string,
  options?: ExplainOptions
): Promise<QueryPlan> {
  validateQuery(query);

  const params = options?.params ?? {};

  // Validate parameters
  for (const [_key, value] of Object.entries(params)) {
    validateParamValue(value);
  }

  // Build EXPLAIN query
  const explainQuery = options?.verbose ? `EXPLAIN VERBOSE ${query}` : `EXPLAIN ${query}`;

  // Access private transport through connection
  const connInternal = conn as unknown as {
    _transport: {
      sendProto: (msg: unknown, signal?: AbortSignal) => Promise<void>;
      receiveProto: (signal?: AbortSignal) => Promise<{ execute?: ExecutionResponse }>;
    };
    _sessionId: string;
  };

  const msg = buildExecuteRequest(connInternal._sessionId, explainQuery, params);
  await connInternal._transport.sendProto(msg, options?.signal);

  const response = await connInternal._transport.receiveProto(options?.signal);

  if (!response.execute) {
    throw new TransportError({
      operation: 'explain',
      cause: new Error('Invalid execute response'),
    });
  }

  const execResp = response.execute;

  if (execResp.error) {
    throw new DriverError({
      statusClass: (execResp.status?.statusClass ??
        StatusClass.SYSTEM) as typeof StatusClass.SYSTEM,
      subclass: '000',
      code: execResp.error.code ?? 'UnknownError',
      message: execResp.error.message ?? 'Unknown error',
      anchor: execResp.error.anchor,
    });
  }

  // Check for EXPLAIN response
  if (execResp.explain) {
    const payload = execResp.explain;
    const root = parseExplainPayload(payload);

    // The generated bindings decode `est_rows` to camelCase `estRows`; tolerate
    // the legacy snake_case key as a fallback for callers passing raw payloads.
    const totals = payload.totals as
      | { cost?: number; estRows?: number; est_rows?: number }
      | undefined;

    return {
      root,
      totalCost: totals?.cost,
      totalRows: totals?.estRows ?? totals?.est_rows,
      raw: payload,
    };
  }

  // Fallback: return raw data as plan
  return {
    root: { type: 'Unknown', details: { response: execResp } },
    raw: execResp,
  };
}

/**
 * Execute a query with profiling and return execution statistics.
 */
export async function profile(
  conn: Connection,
  query: string,
  options?: ExplainOptions
): Promise<QueryProfile> {
  validateQuery(query);

  const params = options?.params ?? {};

  // Validate parameters
  for (const [_key, value] of Object.entries(params)) {
    validateParamValue(value);
  }

  // Build PROFILE query
  const profileQuery = options?.verbose ? `PROFILE VERBOSE ${query}` : `PROFILE ${query}`;

  // Access private transport through connection
  const connInternal = conn as unknown as {
    _transport: {
      sendProto: (msg: unknown, signal?: AbortSignal) => Promise<void>;
      receiveProto: (signal?: AbortSignal) => Promise<{ execute?: ExecutionResponse }>;
    };
    _sessionId: string;
  };

  const msg = buildExecuteRequest(connInternal._sessionId, profileQuery, params);
  await connInternal._transport.sendProto(msg, options?.signal);

  const response = await connInternal._transport.receiveProto(options?.signal);

  if (!response.execute) {
    throw new TransportError({
      operation: 'profile',
      cause: new Error('Invalid execute response'),
    });
  }

  const execResp = response.execute;

  if (execResp.error) {
    throw new DriverError({
      statusClass: (execResp.status?.statusClass ??
        StatusClass.SYSTEM) as typeof StatusClass.SYSTEM,
      subclass: '000',
      code: execResp.error.code ?? 'UnknownError',
      message: execResp.error.message ?? 'Unknown error',
      anchor: execResp.error.anchor,
    });
  }

  // Check for PROFILE response
  if (execResp.profile) {
    const payload = execResp.profile;
    const root = parseProfilePayload(payload);

    return {
      root,
      totalTimeMs: Number(payload.totalTimeNs ?? 0) / 1_000_000,
      totalRows: root.rows,
      memoryBytes: Number(payload.memory?.peakBytes ?? 0),
      raw: payload,
    };
  }

  // Fallback: return minimal profile
  return {
    root: { type: 'Unknown', wallTimeMs: 0 },
    totalTimeMs: 0,
    raw: execResp,
  };
}

/**
 * Format a query plan as a human-readable string.
 */
export function formatPlan(plan: QueryPlan, indent = 0): string {
  const lines: string[] = [];

  function formatOp(op: PlanOperation, depth: number): void {
    const prefix = '  '.repeat(depth);
    let line = `${prefix}${op.type}`;
    if (op.operator && op.operator !== op.type) {
      line += ` (${op.operator})`;
    }
    if (op.cost !== undefined) {
      line += ` cost=${op.cost.toFixed(2)}`;
    }
    if (op.rows !== undefined) {
      line += ` rows=${op.rows}`;
    }
    lines.push(line);

    if (op.details && Object.keys(op.details).length > 0) {
      for (const [key, value] of Object.entries(op.details)) {
        lines.push(`${prefix}  ${key}: ${JSON.stringify(value)}`);
      }
    }

    if (op.children) {
      for (const child of op.children) {
        formatOp(child, depth + 1);
      }
    }
  }

  formatOp(plan.root, indent);

  if (plan.totalCost !== undefined) {
    lines.push(`Total Cost: ${plan.totalCost.toFixed(2)}`);
  }
  if (plan.totalRows !== undefined) {
    lines.push(`Estimated Rows: ${plan.totalRows}`);
  }

  return lines.join('\n');
}

/**
 * Format a query profile as a human-readable string.
 */
export function formatProfile(prof: QueryProfile, indent = 0): string {
  const lines: string[] = [];

  function formatTiming(timing: OperationTiming, depth: number): void {
    const prefix = '  '.repeat(depth);
    let line = `${prefix}${timing.type}`;
    line += ` ${timing.wallTimeMs.toFixed(2)}ms`;
    if (timing.rows !== undefined) {
      line += ` ${timing.rows} rows`;
    }
    if (timing.pageHits !== undefined || timing.pageFaults !== undefined) {
      line += ` (hits=${timing.pageHits ?? 0}, faults=${timing.pageFaults ?? 0})`;
    }
    lines.push(line);

    if (timing.children) {
      for (const child of timing.children) {
        formatTiming(child, depth + 1);
      }
    }
  }

  formatTiming(prof.root, indent);

  lines.push('---');
  lines.push(`Total Time: ${prof.totalTimeMs.toFixed(2)}ms`);
  if (prof.planningTimeMs !== undefined) {
    lines.push(`Planning: ${prof.planningTimeMs.toFixed(2)}ms`);
  }
  if (prof.executionTimeMs !== undefined) {
    lines.push(`Execution: ${prof.executionTimeMs.toFixed(2)}ms`);
  }
  if (prof.totalRows !== undefined) {
    lines.push(`Rows: ${prof.totalRows}`);
  }
  if (prof.memoryBytes !== undefined) {
    lines.push(`Memory: ${formatBytes(prof.memoryBytes)}`);
  }

  return lines.join('\n');
}

/**
 * Format bytes as human-readable string.
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}
