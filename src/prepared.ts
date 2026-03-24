/**
 * Prepared Statements
 *
 * Support for parameterized query preparation and efficient repeated execution.
 */

import type { Connection, QueryOptions, QueryParams } from './connection.js';
import type { QueryResult } from './result.js';
import { SecurityError, StateError } from './errors.js';
import { validateQuery, validateParamName, validateParamValue } from './validate.js';

/**
 * Parameter metadata extracted from a query.
 */
export interface ParameterInfo {
  /** Parameter name */
  name: string;
  /** Position in the query (1-indexed) */
  position: number;
  /** Whether this is a positional parameter (?) */
  positional: boolean;
}

/**
 * Prepared statement for efficient repeated execution.
 *
 * Prepared statements parse the query once and allow multiple executions
 * with different parameter values.
 *
 * @example
 * ```typescript
 * const stmt = conn.prepare('MATCH (n:Person {name: $name}) RETURN n');
 *
 * // Execute with different parameters
 * const result1 = await stmt.query({ name: 'Alice' });
 * const result2 = await stmt.query({ name: 'Bob' });
 *
 * // Close when done
 * stmt.close();
 * ```
 */
export class PreparedStatement {
  private _conn: Connection;
  private _query: string;
  private _parameters: ParameterInfo[];
  private _closed = false;
  private _onClose?: () => void;

  /**
   * Create a new prepared statement.
   *
   * @param conn - Connection to use for execution
   * @param query - Query text with parameters
   * @param onClose - Optional callback invoked when close() is called (e.g., to release a pooled connection)
   *
   * @internal Use Connection.prepare() instead.
   */
  constructor(conn: Connection, query: string, onClose?: () => void) {
    validateQuery(query);

    this._conn = conn;
    this._query = query;
    this._parameters = extractParameters(query);
    this._onClose = onClose;
  }

  /**
   * Get the query text.
   */
  get query(): string {
    return this._query;
  }

  /**
   * Get parameter information.
   */
  get parameters(): ReadonlyArray<ParameterInfo> {
    return this._parameters;
  }

  /**
   * Get the number of parameters.
   */
  get parameterCount(): number {
    return this._parameters.length;
  }

  /**
   * Get positional parameter count (number of ? placeholders).
   */
  get positionalCount(): number {
    return this._parameters.filter((p) => p.positional).length;
  }

  /**
   * Get named parameter names.
   */
  get namedParameters(): string[] {
    return this._parameters.filter((p) => !p.positional).map((p) => p.name);
  }

  /**
   * Check if the statement is closed.
   */
  get isClosed(): boolean {
    return this._closed;
  }

  /**
   * Execute the prepared statement and return results.
   *
   * @param params - Parameter values (object for named, array for positional)
   * @param options - Additional query options
   * @returns Query result
   */
  async execute(
    params?: QueryParams | unknown[],
    options?: Omit<QueryOptions, 'params'>
  ): Promise<QueryResult> {
    this.checkClosed();

    const resolvedParams = this.resolveParams(params);
    return this._conn.query(this._query, { ...options, params: resolvedParams });
  }

  /**
   * Execute the prepared statement and return all rows.
   *
   * @param params - Parameter values
   * @param options - Additional query options
   * @returns Array of row objects
   */
  async executeAll(
    params?: QueryParams | unknown[],
    options?: Omit<QueryOptions, 'params'>
  ): Promise<Record<string, unknown>[]> {
    this.checkClosed();

    const resolvedParams = this.resolveParams(params);
    return this._conn.queryAll(this._query, { ...options, params: resolvedParams });
  }

  /**
   * Execute the prepared statement without returning results.
   *
   * @param params - Parameter values
   * @param options - Additional query options
   */
  async exec(
    params?: QueryParams | unknown[],
    options?: Omit<QueryOptions, 'params'>
  ): Promise<void> {
    this.checkClosed();

    const resolvedParams = this.resolveParams(params);
    return this._conn.exec(this._query, { ...options, params: resolvedParams });
  }

  /**
   * Validate parameters without executing.
   *
   * @param params - Parameter values to validate
   * @throws SecurityError if validation fails
   */
  validate(params?: QueryParams | unknown[]): void {
    this.checkClosed();
    this.resolveParams(params); // Will throw on validation errors
  }

  /**
   * Close the prepared statement.
   *
   * After closing, the statement cannot be executed.
   * If a release callback was provided (e.g., to return a pooled connection),
   * it is invoked exactly once on the first call to close().
   */
  close(): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    if (this._onClose) {
      this._onClose();
      this._onClose = undefined;
    }
  }

  /**
   * Resolve and validate parameters.
   */
  private resolveParams(params?: QueryParams | unknown[]): QueryParams {
    // Handle no parameters
    if (!params) {
      if (this._parameters.length > 0) {
        throw new SecurityError({
          type: 'validation',
          message: `Expected ${this._parameters.length} parameters, got 0`,
        });
      }
      return {};
    }

    // Handle array of positional parameters
    if (Array.isArray(params)) {
      const positionalCount = this.positionalCount;
      if (params.length !== positionalCount) {
        throw new SecurityError({
          type: 'validation',
          message: `Expected ${positionalCount} positional parameters, got ${params.length}`,
        });
      }

      // Convert to named parameters
      const namedParams: QueryParams = {};
      let posIndex = 0;
      for (const p of this._parameters) {
        if (p.positional) {
          namedParams[p.name] = params[posIndex];
          validateParamValue(params[posIndex]);
          posIndex++;
        }
      }

      return namedParams;
    }

    // Handle named parameters
    const namedParams = params;

    // Validate all required parameters are present
    for (const p of this._parameters) {
      if (!p.positional && !(p.name in namedParams)) {
        throw new SecurityError({
          type: 'validation',
          message: `Missing required parameter: ${p.name}`,
        });
      }
    }

    // Validate parameter values
    for (const [key, value] of Object.entries(namedParams)) {
      validateParamName(key);
      validateParamValue(value);
    }

    return namedParams;
  }

  /**
   * Check if statement is closed.
   */
  private checkClosed(): void {
    if (this._closed) {
      throw new StateError({
        currentState: 'closed',
        operation: 'execute',
        message: 'PreparedStatement is closed',
      });
    }
  }
}

/**
 * Extract parameter information from a query string.
 *
 * Supports both positional (?) and named ($name) parameters.
 */
export function extractParameters(query: string): ParameterInfo[] {
  const params: ParameterInfo[] = [];
  let i = 0;
  let position = 0;

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

    // Skip comments
    if (ch === '/' && i + 1 < query.length && query[i + 1] === '/') {
      while (i < query.length && query[i] !== '\n') {
        i++;
      }
      continue;
    }

    if (ch === '/' && i + 1 < query.length && query[i + 1] === '*') {
      i += 2;
      while (i + 1 < query.length && !(query[i] === '*' && query[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }

    // Positional parameter
    if (ch === '?') {
      position++;
      params.push({
        name: `p${position}`,
        position,
        positional: true,
      });
      i++;
      continue;
    }

    // Named parameter
    if (ch === '$') {
      i++;
      let name = '';
      while (i < query.length && /[a-zA-Z0-9_]/.test(query[i] ?? '')) {
        name += query[i];
        i++;
      }
      if (name) {
        position++;
        // Check if we already have this parameter
        const existing = params.find((p) => p.name === name);
        if (!existing) {
          params.push({
            name,
            position,
            positional: false,
          });
        }
      }
      continue;
    }

    i++;
  }

  return params;
}

/**
 * Create a prepared statement from a query string.
 *
 * @param conn - Connection to use
 * @param query - Query text
 * @returns Prepared statement
 */
export function prepare(conn: Connection, query: string): PreparedStatement {
  return new PreparedStatement(conn, query);
}
