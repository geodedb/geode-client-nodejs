/**
 * Query Explain and Profile
 *
 * Support for query plan analysis and execution profiling.
 */

import type { Connection, QueryOptions } from './connection.js';
import { validateQuery, validateParamValue } from './validate.js';
import {
  buildRunGQLMessage,
  parseFrame,
  isErrorFrame,
  frameToError,
  rewritePlaceholders,
  RespType,
} from './protocol.js';

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
 * Parse plan data from server response.
 */
function parsePlanOperation(data: unknown): PlanOperation {
  if (!data || typeof data !== 'object') {
    return { type: 'Unknown', details: { raw: data } };
  }

  const obj = data as Record<string, unknown>;

  const op: PlanOperation = {
    type: (obj['type'] as string) || (obj['operator'] as string) || 'Unknown',
  };

  if ('operator' in obj) op.operator = obj['operator'] as string;
  if ('cost' in obj) op.cost = obj['cost'] as number;
  if ('rows' in obj) op.rows = obj['rows'] as number;
  if ('estimated_rows' in obj) op.rows = obj['estimated_rows'] as number;
  if ('estimated_cost' in obj) op.cost = obj['estimated_cost'] as number;

  // Collect remaining fields as details
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (
      ![
        'type',
        'operator',
        'cost',
        'rows',
        'children',
        'estimated_rows',
        'estimated_cost',
      ].includes(key)
    ) {
      details[key] = value;
    }
  }
  if (Object.keys(details).length > 0) {
    op.details = details;
  }

  // Parse children
  if (Array.isArray(obj['children'])) {
    op.children = (obj['children'] as unknown[]).map(parsePlanOperation);
  }

  return op;
}

/**
 * Parse timing data from server response.
 */
function parseOperationTiming(data: unknown): OperationTiming {
  if (!data || typeof data !== 'object') {
    return { type: 'Unknown', wallTimeMs: 0 };
  }

  const obj = data as Record<string, unknown>;

  const timing: OperationTiming = {
    type: (obj['type'] as string) || (obj['operator'] as string) || 'Unknown',
    wallTimeMs: (obj['wall_time_ms'] as number) || (obj['time_ms'] as number) || 0,
  };

  if ('cpu_time_ms' in obj) timing.cpuTimeMs = obj['cpu_time_ms'] as number;
  if ('rows' in obj) timing.rows = obj['rows'] as number;
  if ('actual_rows' in obj) timing.rows = obj['actual_rows'] as number;
  if ('page_hits' in obj) timing.pageHits = obj['page_hits'] as number;
  if ('page_faults' in obj) timing.pageFaults = obj['page_faults'] as number;

  // Parse children
  if (Array.isArray(obj['children'])) {
    timing.children = (obj['children'] as unknown[]).map(parseOperationTiming);
  }

  return timing;
}

/**
 * Get the query execution plan without executing.
 *
 * @param conn - Connection to use
 * @param query - Query to explain
 * @param options - Options including parameters
 * @returns Query execution plan
 *
 * @example
 * ```typescript
 * const plan = await explain(conn, 'MATCH (n:Person)-[:KNOWS]->(m) RETURN n, m');
 * console.log('Plan:', plan.root.type);
 * console.log('Estimated cost:', plan.totalCost);
 * ```
 */
export async function explain(
  conn: Connection,
  query: string,
  options?: ExplainOptions
): Promise<QueryPlan> {
  validateQuery(query);

  let finalQuery = query;
  let params = options?.params ?? {};

  // Handle positional parameters
  if (query.includes('?') && Array.isArray(options?.params)) {
    const result = rewritePlaceholders(query, options.params as unknown[]);
    finalQuery = result.query;
    params = result.params;
  }

  // Validate parameters
  for (const [_key, value] of Object.entries(params)) {
    validateParamValue(value);
  }

  // Build EXPLAIN query
  const explainQuery = options?.verbose ? `EXPLAIN VERBOSE ${finalQuery}` : `EXPLAIN ${finalQuery}`;

  const transport = (
    conn as unknown as {
      _transport: {
        send: (msg: unknown, signal?: AbortSignal) => Promise<void>;
        receive: (signal?: AbortSignal) => Promise<Buffer>;
      };
    }
  )._transport;

  await transport.send(buildRunGQLMessage(explainQuery, params), options?.signal);

  const data = await transport.receive(options?.signal);
  const frame = parseFrame(data);

  if (isErrorFrame(frame)) {
    throw frameToError(frame);
  }

  // Check for EXPLAIN response
  if (frame.result.type === RespType.EXPLAIN) {
    const raw = frame.result.json;
    const root = parsePlanOperation(raw);

    return {
      root,
      totalCost: calculateTotalCost(root),
      totalRows: root.rows,
      raw,
    };
  }

  // Fallback: return raw data as plan
  return {
    root: { type: 'Unknown', details: { response: frame.result } },
    raw: frame.result,
  };
}

/**
 * Execute a query with profiling and return execution statistics.
 *
 * Unlike explain(), profile() actually executes the query and measures
 * real performance metrics.
 *
 * @param conn - Connection to use
 * @param query - Query to profile
 * @param options - Options including parameters
 * @returns Query execution profile
 *
 * @example
 * ```typescript
 * const profile = await profile(conn, 'MATCH (n:Person) RETURN count(n)');
 * console.log('Execution time:', profile.totalTimeMs, 'ms');
 * console.log('Rows processed:', profile.totalRows);
 * ```
 */
export async function profile(
  conn: Connection,
  query: string,
  options?: ExplainOptions
): Promise<QueryProfile> {
  validateQuery(query);

  let finalQuery = query;
  let params = options?.params ?? {};

  // Handle positional parameters
  if (query.includes('?') && Array.isArray(options?.params)) {
    const result = rewritePlaceholders(query, options.params as unknown[]);
    finalQuery = result.query;
    params = result.params;
  }

  // Validate parameters
  for (const [_key, value] of Object.entries(params)) {
    validateParamValue(value);
  }

  // Build PROFILE query
  const profileQuery = options?.verbose ? `PROFILE VERBOSE ${finalQuery}` : `PROFILE ${finalQuery}`;

  const transport = (
    conn as unknown as {
      _transport: {
        send: (msg: unknown, signal?: AbortSignal) => Promise<void>;
        receive: (signal?: AbortSignal) => Promise<Buffer>;
      };
    }
  )._transport;

  await transport.send(buildRunGQLMessage(profileQuery, params), options?.signal);

  const data = await transport.receive(options?.signal);
  const frame = parseFrame(data);

  if (isErrorFrame(frame)) {
    throw frameToError(frame);
  }

  // Check for PROFILE response
  if (frame.result.type === RespType.PROFILE) {
    const raw = frame.result.json as Record<string, unknown> | undefined;
    const root = parseOperationTiming(raw);

    return {
      root,
      totalTimeMs: calculateTotalTime(root),
      totalRows: root.rows,
      planningTimeMs: raw?.['planning_time_ms'] as number | undefined,
      executionTimeMs: raw?.['execution_time_ms'] as number | undefined,
      memoryBytes: raw?.['memory_bytes'] as number | undefined,
      raw,
    };
  }

  // Fallback: return minimal profile
  return {
    root: { type: 'Unknown', wallTimeMs: 0 },
    totalTimeMs: 0,
    raw: frame.result,
  };
}

/**
 * Calculate total cost from a plan tree.
 */
function calculateTotalCost(op: PlanOperation): number {
  let total = op.cost ?? 0;
  if (op.children) {
    for (const child of op.children) {
      total += calculateTotalCost(child);
    }
  }
  return total;
}

/**
 * Calculate total time from a timing tree.
 */
function calculateTotalTime(timing: OperationTiming): number {
  let total = timing.wallTimeMs;
  if (timing.children) {
    for (const child of timing.children) {
      total = Math.max(total, calculateTotalTime(child));
    }
  }
  return total;
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
