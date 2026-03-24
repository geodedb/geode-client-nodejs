/**
 * Query Builder
 *
 * Fluent API for building GQL queries programmatically.
 */

import type { QueryParams } from './connection.js';
import {
  validateLabel,
  validateRelationshipType,
  validatePropertyName,
  validateVariableName,
} from './validate.js';

// SEC-P6-7: Module-level flags to emit deprecation warnings only once per process
let _predicateRawWarned = false;
let _queryRawWarned = false;

/**
 * Edge direction for pattern matching.
 */
export type EdgeDirection = 'outgoing' | 'incoming' | 'both';

/**
 * Sort direction.
 */
export type SortDirection = 'ASC' | 'DESC';

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
 * Node pattern for MATCH clauses.
 */
export interface NodePattern {
  variable?: string;
  labels?: string[];
  properties?: Record<string, unknown>;
}

/**
 * Edge pattern for MATCH clauses.
 */
export interface EdgePattern {
  variable?: string;
  type?: string;
  direction: EdgeDirection;
  properties?: Record<string, unknown>;
  minHops?: number;
  maxHops?: number;
}

/**
 * Pattern element (node or edge).
 */
export type PatternElement =
  | { kind: 'node'; pattern: NodePattern }
  | { kind: 'edge'; pattern: EdgePattern };

/**
 * Build a node pattern.
 */
export class NodePatternBuilder {
  private _variable?: string;
  private _labels: string[] = [];
  private _properties: Record<string, unknown> = {};

  /**
   * Set the variable name.
   */
  as(variable: string): this {
    validateVariableName(variable);
    this._variable = variable;
    return this;
  }

  /**
   * Add a label.
   */
  label(label: string): this {
    validateLabel(label);
    this._labels.push(label);
    return this;
  }

  /**
   * Add multiple labels.
   */
  labels(...labels: string[]): this {
    for (const l of labels) {
      validateLabel(l);
    }
    this._labels.push(...labels);
    return this;
  }

  /**
   * Set a property.
   */
  prop(key: string, value: unknown): this {
    validatePropertyName(key);
    this._properties[key] = value;
    return this;
  }

  /**
   * Set multiple properties.
   */
  props(properties: Record<string, unknown>): this {
    for (const key of Object.keys(properties)) {
      validatePropertyName(key);
    }
    Object.assign(this._properties, properties);
    return this;
  }

  /**
   * Build the pattern.
   */
  build(): NodePattern {
    return {
      variable: this._variable,
      labels: this._labels.length > 0 ? this._labels : undefined,
      properties: Object.keys(this._properties).length > 0 ? this._properties : undefined,
    };
  }

  /**
   * Convert to GQL string.
   */
  toGQL(): string {
    let result = '(';

    if (this._variable) {
      result += this._variable;
    }

    if (this._labels.length > 0) {
      result += ':' + this._labels.join(':');
    }

    if (Object.keys(this._properties).length > 0) {
      result += ' ' + propsToGQL(this._properties);
    }

    return result + ')';
  }
}

/**
 * Build an edge pattern.
 */
export class EdgePatternBuilder {
  private _variable?: string;
  private _type?: string;
  private _direction: EdgeDirection = 'outgoing';
  private _properties: Record<string, unknown> = {};
  private _minHops?: number;
  private _maxHops?: number;

  /**
   * Set the variable name.
   */
  as(variable: string): this {
    validateVariableName(variable);
    this._variable = variable;
    return this;
  }

  /**
   * Set the relationship type.
   */
  type(type: string): this {
    validateRelationshipType(type);
    this._type = type;
    return this;
  }

  /**
   * Set outgoing direction.
   */
  outgoing(): this {
    this._direction = 'outgoing';
    return this;
  }

  /**
   * Set incoming direction.
   */
  incoming(): this {
    this._direction = 'incoming';
    return this;
  }

  /**
   * Set bidirectional.
   */
  both(): this {
    this._direction = 'both';
    return this;
  }

  /**
   * Set direction.
   */
  direction(dir: EdgeDirection): this {
    this._direction = dir;
    return this;
  }

  /**
   * Set a property.
   */
  prop(key: string, value: unknown): this {
    validatePropertyName(key);
    this._properties[key] = value;
    return this;
  }

  /**
   * Set multiple properties.
   */
  props(properties: Record<string, unknown>): this {
    for (const key of Object.keys(properties)) {
      validatePropertyName(key);
    }
    Object.assign(this._properties, properties);
    return this;
  }

  /**
   * Set variable length path.
   */
  hops(min?: number, max?: number): this {
    this._minHops = min;
    this._maxHops = max;
    return this;
  }

  /**
   * Build the pattern.
   */
  build(): EdgePattern {
    return {
      variable: this._variable,
      type: this._type,
      direction: this._direction,
      properties: Object.keys(this._properties).length > 0 ? this._properties : undefined,
      minHops: this._minHops,
      maxHops: this._maxHops,
    };
  }

  /**
   * Convert to GQL string.
   */
  toGQL(): string {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const hasContent = this._variable || this._type || Object.keys(this._properties).length > 0;

    let inner = '';
    if (hasContent) {
      inner = '[';
      if (this._variable) {
        inner += this._variable;
      }
      if (this._type) {
        inner += ':' + this._type;
      }
      if (this._minHops !== undefined || this._maxHops !== undefined) {
        inner += '*';
        if (this._minHops !== undefined) {
          inner += this._minHops;
        }
        inner += '..';
        if (this._maxHops !== undefined) {
          inner += this._maxHops;
        }
      }
      if (Object.keys(this._properties).length > 0) {
        inner += ' ' + propsToGQL(this._properties);
      }
      inner += ']';
    }

    switch (this._direction) {
      case 'outgoing':
        return `-${inner}->`;
      case 'incoming':
        return `<-${inner}-`;
      case 'both':
        return `-${inner}-`;
    }
  }
}

/**
 * Build a path pattern.
 */
export class PatternBuilder {
  private _elements: PatternElement[] = [];

  /**
   * Add a node to the pattern.
   */
  node(builder?: (n: NodePatternBuilder) => void): this {
    const nodeBuilder = new NodePatternBuilder();
    if (builder) {
      builder(nodeBuilder);
    }
    this._elements.push({ kind: 'node', pattern: nodeBuilder.build() });
    return this;
  }

  /**
   * Add an outgoing edge to the pattern.
   */
  outgoing(builder?: (e: EdgePatternBuilder) => void): this {
    const edgeBuilder = new EdgePatternBuilder().outgoing();
    if (builder) {
      builder(edgeBuilder);
    }
    this._elements.push({ kind: 'edge', pattern: edgeBuilder.build() });
    return this;
  }

  /**
   * Add an incoming edge to the pattern.
   */
  incoming(builder?: (e: EdgePatternBuilder) => void): this {
    const edgeBuilder = new EdgePatternBuilder().incoming();
    if (builder) {
      builder(edgeBuilder);
    }
    this._elements.push({ kind: 'edge', pattern: edgeBuilder.build() });
    return this;
  }

  /**
   * Add a bidirectional edge to the pattern.
   */
  related(builder?: (e: EdgePatternBuilder) => void): this {
    const edgeBuilder = new EdgePatternBuilder().both();
    if (builder) {
      builder(edgeBuilder);
    }
    this._elements.push({ kind: 'edge', pattern: edgeBuilder.build() });
    return this;
  }

  /**
   * Convert to GQL string.
   */
  toGQL(): string {
    let result = '';
    for (const element of this._elements) {
      if (element.kind === 'node') {
        result += nodePatternToGQL(element.pattern);
      } else {
        result += edgePatternToGQL(element.pattern);
      }
    }
    return result;
  }
}

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
   * **⚠️ SECURITY WARNING: This method bypasses all input validation.**
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
      Object.assign(this._params, params);
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
      Object.assign(this._params, sub.params);
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
      Object.assign(this._params, sub.params);
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

/**
 * GQL Query Builder.
 */
export class QueryBuilder {
  private _clauses: string[] = [];
  private _params: QueryParams = {};

  /**
   * Add a MATCH clause.
   */
  match(pattern: string | PatternBuilder): this {
    const p = typeof pattern === 'string' ? pattern : pattern.toGQL();
    this._clauses.push(`MATCH ${p}`);
    return this;
  }

  /**
   * Add an OPTIONAL MATCH clause.
   */
  optionalMatch(pattern: string | PatternBuilder): this {
    const p = typeof pattern === 'string' ? pattern : pattern.toGQL();
    this._clauses.push(`OPTIONAL MATCH ${p}`);
    return this;
  }

  /**
   * Add a WHERE clause.
   *
   * **⚠️ SECURITY WARNING when using string predicates:**
   *
   * When passing a string predicate, this method does NOT validate or sanitize input.
   * Using string predicates with user-supplied data can lead to GQL injection attacks.
   *
   * @example
   * ```typescript
   * // RECOMMENDED: Use PredicateBuilder for type-safe, injection-resistant queries
   * query().where(predicate().eq('n.name', userInput))
   *
   * // SAFE: Using parameters with string predicates
   * query().where('n.name = $name', { name: userInput })
   *
   * // UNSAFE: Never interpolate user input directly in string predicates
   * query().where(`n.name = '${userInput}'`) // VULNERABLE TO INJECTION!
   * ```
   *
   * @param predicate - A PredicateBuilder (recommended) or raw predicate string
   * @param params - Parameters to bind when using string predicates
   */
  where(predicate: string | PredicateBuilder, params?: QueryParams): this {
    if (typeof predicate === 'string') {
      this._clauses.push(`WHERE ${predicate}`);
      if (params) {
        Object.assign(this._params, params);
      }
    } else {
      const built = predicate.build();
      this._clauses.push(`WHERE ${built.predicate}`);
      Object.assign(this._params, built.params);
    }
    return this;
  }

  /**
   * Add a WITH clause.
   */
  with(...expressions: string[]): this {
    this._clauses.push(`WITH ${expressions.join(', ')}`);
    return this;
  }

  /**
   * Add a RETURN clause.
   */
  return(...expressions: string[]): this {
    this._clauses.push(`RETURN ${expressions.join(', ')}`);
    return this;
  }

  /**
   * Add RETURN DISTINCT.
   */
  returnDistinct(...expressions: string[]): this {
    this._clauses.push(`RETURN DISTINCT ${expressions.join(', ')}`);
    return this;
  }

  /**
   * Add an ORDER BY clause.
   */
  orderBy(...expressions: Array<string | [string, SortDirection]>): this {
    const parts = expressions.map((e) => {
      if (typeof e === 'string') {
        return e;
      }
      return `${e[0]} ${e[1]}`;
    });
    this._clauses.push(`ORDER BY ${parts.join(', ')}`);
    return this;
  }

  /**
   * Add a SKIP clause.
   */
  skip(count: number): this {
    this._clauses.push(`SKIP ${count}`);
    return this;
  }

  /**
   * Add a LIMIT clause.
   */
  limit(count: number): this {
    this._clauses.push(`LIMIT ${count}`);
    return this;
  }

  /**
   * Add a CREATE clause.
   */
  create(pattern: string | PatternBuilder): this {
    const p = typeof pattern === 'string' ? pattern : pattern.toGQL();
    this._clauses.push(`CREATE ${p}`);
    return this;
  }

  /**
   * Add a MERGE clause.
   */
  merge(pattern: string | PatternBuilder): this {
    const p = typeof pattern === 'string' ? pattern : pattern.toGQL();
    this._clauses.push(`MERGE ${p}`);
    return this;
  }

  /**
   * Add a DELETE clause.
   */
  delete(...variables: string[]): this {
    this._clauses.push(`DELETE ${variables.join(', ')}`);
    return this;
  }

  /**
   * Add a DETACH DELETE clause.
   */
  detachDelete(...variables: string[]): this {
    this._clauses.push(`DETACH DELETE ${variables.join(', ')}`);
    return this;
  }

  /**
   * Add a SET clause.
   */
  set(...assignments: string[]): this {
    this._clauses.push(`SET ${assignments.join(', ')}`);
    return this;
  }

  /**
   * Add a REMOVE clause.
   */
  remove(...items: string[]): this {
    this._clauses.push(`REMOVE ${items.join(', ')}`);
    return this;
  }

  /**
   * Add a raw GQL clause.
   *
   * **⚠️ SECURITY WARNING: This method bypasses all input validation.**
   *
   * Using raw() with user-supplied input can lead to GQL injection attacks.
   * Only use this method when:
   * 1. The clause is entirely constructed from trusted, hardcoded strings
   * 2. All dynamic values are passed via the `params` argument (using $paramName syntax)
   *
   * @example
   * ```typescript
   * // SAFE: Using parameters for dynamic values
   * query().raw('CALL db.index.fulltext.queryNodes("idx", $term)', { term: userInput })
   *
   * // UNSAFE: Never interpolate user input directly
   * query().raw(`MATCH (n:${userLabel})`) // VULNERABLE TO INJECTION!
   * ```
   *
   * Consider using the typed query builder methods instead.
   *
   * @param clause - Raw GQL clause (MUST be trusted input)
   * @param params - Parameters to bind (safe for user input)
   * @deprecated Consider using typed query builder methods instead for better security.
   */
  raw(clause: string, params?: QueryParams): this {
    // SEC-P6-7: Runtime deprecation warning on first use
    if (!_queryRawWarned) {
      _queryRawWarned = true;
      process.emitWarning(
        'QueryBuilder.raw() is deprecated and bypasses input validation. ' +
          'Use typed query builder methods instead.',
        'DeprecationWarning'
      );
    }
    this._clauses.push(clause);
    if (params) {
      Object.assign(this._params, params);
    }
    return this;
  }

  /**
   * Add a parameter.
   */
  param(name: string, value: unknown): this {
    this._params[name] = value;
    return this;
  }

  /**
   * Add multiple parameters.
   */
  params(params: QueryParams): this {
    Object.assign(this._params, params);
    return this;
  }

  /**
   * Build the query string.
   */
  build(): { query: string; params: QueryParams } {
    return {
      query: this._clauses.join('\n'),
      params: this._params,
    };
  }

  /**
   * Get the query string.
   */
  toGQL(): string {
    return this._clauses.join('\n');
  }

  /**
   * Get the parameters.
   */
  getParams(): QueryParams {
    return { ...this._params };
  }
}

// Helper functions

function propsToGQL(props: Record<string, unknown>): string {
  const entries = Object.entries(props).map(([k, v]) => {
    // Defense-in-depth: validate property keys even though callers should
    // already validate. This prevents injection if a raw pattern object
    // bypasses builder-level validation.
    validatePropertyName(k);
    return `${k}: ${valueToGQL(v)}`;
  });
  return `{${entries.join(', ')}}`;
}

function valueToGQL(value: unknown): string {
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

function nodePatternToGQL(pattern: NodePattern): string {
  let result = '(';

  if (pattern.variable) {
    result += pattern.variable;
  }

  if (pattern.labels && pattern.labels.length > 0) {
    result += ':' + pattern.labels.join(':');
  }

  if (pattern.properties && Object.keys(pattern.properties).length > 0) {
    result += ' ' + propsToGQL(pattern.properties);
  }

  return result + ')';
}

function edgePatternToGQL(pattern: EdgePattern): string {
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  const hasContent =
    pattern.variable ||
    pattern.type ||
    (pattern.properties && Object.keys(pattern.properties).length > 0);
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  let inner = '';
  if (hasContent) {
    inner = '[';
    if (pattern.variable) {
      inner += pattern.variable;
    }
    if (pattern.type) {
      inner += ':' + pattern.type;
    }
    if (pattern.minHops !== undefined || pattern.maxHops !== undefined) {
      inner += '*';
      if (pattern.minHops !== undefined) {
        inner += pattern.minHops;
      }
      inner += '..';
      if (pattern.maxHops !== undefined) {
        inner += pattern.maxHops;
      }
    }
    if (pattern.properties && Object.keys(pattern.properties).length > 0) {
      inner += ' ' + propsToGQL(pattern.properties);
    }
    inner += ']';
  }

  switch (pattern.direction) {
    case 'outgoing':
      return `-${inner}->`;
    case 'incoming':
      return `<-${inner}-`;
    case 'both':
      return `-${inner}-`;
  }
}

// Factory functions

/**
 * Create a new QueryBuilder.
 */
export function query(): QueryBuilder {
  return new QueryBuilder();
}

/**
 * Create a new PatternBuilder.
 */
export function pattern(): PatternBuilder {
  return new PatternBuilder();
}

/**
 * Create a new PredicateBuilder.
 */
export function predicate(): PredicateBuilder {
  return new PredicateBuilder();
}

/**
 * Create a new NodePatternBuilder.
 */
export function node(): NodePatternBuilder {
  return new NodePatternBuilder();
}

/**
 * Create a new EdgePatternBuilder.
 */
export function edge(): EdgePatternBuilder {
  return new EdgePatternBuilder();
}

/**
 * Reset raw() deprecation warning flags.
 * Exported for testing only.
 * @internal
 */
export function _resetRawWarnings(): void {
  _predicateRawWarned = false;
  _queryRawWarned = false;
}
