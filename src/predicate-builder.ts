/**
 * Predicate Builder
 *
 * Fluent API for building WHERE clause predicates in GQL queries.
 * Extracted from query-builder.ts for file size management.
 */

import type { QueryParams } from './connection.js';
import { validatePropertyName } from './validate.js';

// SEC-P6-7: Module-level flag to emit deprecation warning only once per process
let _predicateRawWarned = false;

/**
 * Predicate operator.
 */
export type PredicateOp =
  | '='
  | '<>'
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'IN'
  | 'NOT IN'
  | 'CONTAINS'
  | 'STARTS WITH'
  | 'ENDS WITH'
  | 'IS NULL'
  | 'IS NOT NULL';

/**
 * Build a predicate for WHERE clauses.
 */
export class PredicateBuilder {
  private _predicates: string[] = [];
  private _params: QueryParams = {};
  private _paramCounter = 0;

  /**
   * Add a comparison predicate.
   */
  compare(left: string, op: PredicateOp, right: unknown): this {
    if (op === 'IS NULL') {
      this._predicates.push(`${left} IS NULL`);
    } else if (op === 'IS NOT NULL') {
      this._predicates.push(`${left} IS NOT NULL`);
    } else {
      const paramName = this.nextParam();
      this._predicates.push(`${left} ${op} $${paramName}`);
      this._params[paramName] = right;
    }
    return this;
  }

  /**
   * Add an equality predicate.
   */
  eq(left: string, right: unknown): this {
    return this.compare(left, '=', right);
  }

  /**
   * Add a not-equal predicate.
   */
  neq(left: string, right: unknown): this {
    return this.compare(left, '<>', right);
  }

  /**
   * Add a less-than predicate.
   */
  lt(left: string, right: unknown): this {
    return this.compare(left, '<', right);
  }

  /**
   * Add a less-than-or-equal predicate.
   */
  lte(left: string, right: unknown): this {
    return this.compare(left, '<=', right);
  }

  /**
   * Add a greater-than predicate.
   */
  gt(left: string, right: unknown): this {
    return this.compare(left, '>', right);
  }

  /**
   * Add a greater-than-or-equal predicate.
   */
  gte(left: string, right: unknown): this {
    return this.compare(left, '>=', right);
  }

  /**
   * Add an IN predicate.
   */
  in(left: string, values: unknown[]): this {
    const paramName = this.nextParam();
    this._predicates.push(`${left} IN $${paramName}`);
    this._params[paramName] = values;
    return this;
  }

  /**
   * Add a NOT IN predicate.
   */
  notIn(left: string, values: unknown[]): this {
    const paramName = this.nextParam();
    this._predicates.push(`${left} NOT IN $${paramName}`);
    this._params[paramName] = values;
    return this;
  }

  /**
   * Add a CONTAINS predicate.
   */
  contains(left: string, value: string): this {
    return this.compare(left, 'CONTAINS', value);
  }

  /**
   * Add a STARTS WITH predicate.
   */
  startsWith(left: string, value: string): this {
    return this.compare(left, 'STARTS WITH', value);
  }

  /**
   * Add an ENDS WITH predicate.
   */
  endsWith(left: string, value: string): this {
    return this.compare(left, 'ENDS WITH', value);
  }

  /**
   * Add an IS NULL predicate.
   */
  isNull(expr: string): this {
    return this.compare(expr, 'IS NULL', null);
  }

  /**
   * Add an IS NOT NULL predicate.
   */
  isNotNull(expr: string): this {
    return this.compare(expr, 'IS NOT NULL', null);
  }

  /**
   * Add a raw predicate expression.
   *
   * **SECURITY WARNING: This method bypasses all input validation.**
   *
   * Using raw() with user-supplied input can lead to GQL injection attacks.
   * Only use this method when:
   * 1. The expression is entirely constructed from trusted, hardcoded strings
   * 2. All dynamic values are passed via the `params` argument (using $paramName syntax)
   *
   * @example
   * ```typescript
   * // SAFE: Using parameters for dynamic values
   * predicate().raw('n.custom_field CONTAINS $pattern', { pattern: userInput })
   *
   * // UNSAFE: Never interpolate user input directly
   * predicate().raw(`n.name = '${userInput}'`) // VULNERABLE TO INJECTION!
   * ```
   *
   * Consider using the typed predicate methods (eq, gt, contains, etc.) instead.
   *
   * @param expr - Raw predicate expression (MUST be trusted input)
   * @param params - Parameters to bind (safe for user input)
   * @deprecated Consider using typed predicate methods instead for better security.
   */
  raw(expr: string, params?: QueryParams): this {
    // SEC-P6-7: Runtime deprecation warning on first use
    if (!_predicateRawWarned) {
      _predicateRawWarned = true;
      process.emitWarning(
        'PredicateBuilder.raw() is deprecated and bypasses input validation. ' +
          'Use typed predicate methods (eq, gt, contains, etc.) instead.',
        'DeprecationWarning'
      );
    }
    this._predicates.push(expr);
    if (params) {
      this._params = { ...this._params, ...params };
    }
    return this;
  }

  /**
   * Combine predicates with AND.
   */
  and(builder: PredicateBuilder): this {
    const sub = builder.build();
    if (sub.predicate) {
      this._predicates.push(`(${sub.predicate})`);
      this._params = { ...this._params, ...sub.params };
    }
    return this;
  }

  /**
   * Combine predicates with OR.
   */
  or(builder: PredicateBuilder): this {
    const sub = builder.build();
    if (sub.predicate) {
      if (this._predicates.length > 0) {
        const current = this._predicates.join(' AND ');
        this._predicates = [`(${current}) OR (${sub.predicate})`];
      } else {
        this._predicates.push(sub.predicate);
      }
      this._params = { ...this._params, ...sub.params };
    }
    return this;
  }

  /**
   * Build the predicate.
   */
  build(): { predicate: string; params: QueryParams } {
    return {
      predicate: this._predicates.join(' AND '),
      params: this._params,
    };
  }

  private nextParam(): string {
    return `pred_${++this._paramCounter}`;
  }
}

// GQL value conversion helpers

/**
 * Convert a properties object to GQL inline syntax.
 * @internal
 */
export function propsToGQL(props: Record<string, unknown>): string {
  const entries = Object.entries(props).map(([k, v]) => {
    // Defense-in-depth: validate property keys even though callers should
    // already validate. This prevents injection if a raw pattern object
    // bypasses builder-level validation.
    validatePropertyName(k);
    return `${k}: ${valueToGQL(v)}`;
  });
  return `{${entries.join(', ')}}`;
}

/**
 * Convert a value to GQL literal syntax.
 * @internal
 */
export function valueToGQL(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    // Escape backslashes first, then single quotes
    // This prevents escape sequence injection where \' becomes \\' (escaped backslash + quote)
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(valueToGQL).join(', ')}]`;
  }
  if (typeof value === 'object') {
    return propsToGQL(value as Record<string, unknown>);
  }
  // At this point, value is a primitive (bigint, symbol, etc.) - safe to stringify
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
}

/**
 * Escape a string value for GQL literal syntax.
 * @internal
 */
export function escapeStringValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Reset raw() deprecation warning flags.
 * Exported for testing only.
 * @internal
 */
export function _resetPredicateRawWarning(): void {
  _predicateRawWarned = false;
}
