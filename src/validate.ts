/**
 * Input Validation Module
 *
 * Security-focused validation for user inputs to prevent injection attacks.
 */

import { SecurityError } from './errors.js';
import { MAX_QUERY_LENGTH, MAX_PAGE_SIZE } from './config.js';

// Parameter name pattern: alphanumeric with underscores, max 128 chars
const PARAM_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;

// Reserved keywords that cannot be used as parameter names
const RESERVED_KEYWORDS = new Set([
  'match',
  'create',
  'delete',
  'set',
  'remove',
  'return',
  'where',
  'with',
  'order',
  'by',
  'skip',
  'limit',
  'union',
  'all',
  'optional',
  'and',
  'or',
  'not',
  'xor',
  'null',
  'true',
  'false',
  'in',
  'is',
  'as',
  'case',
  'when',
  'then',
  'else',
  'end',
  'exists',
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'collect',
  'distinct',
  'merge',
  'call',
  'yield',
  'unwind',
  'foreach',
  'detach',
  'drop',
  'graph',
  'use',
  'catalog',
  'constraint',
  'index',
  'create',
  'node',
  'relationship',
  'edge',
  'property',
  'on',
  'for',
  'if',
  'begin',
  'commit',
  'rollback',
  'transaction',
]);

/**
 * Validate a GQL query string.
 *
 * @throws SecurityError if validation fails
 */
export function validateQuery(query: string): void {
  if (!query) {
    throw new SecurityError({
      type: 'input',
      message: 'query cannot be empty',
    });
  }

  if (query.length > MAX_QUERY_LENGTH) {
    throw new SecurityError({
      type: 'input',
      message: `query exceeds maximum length of ${MAX_QUERY_LENGTH} bytes`,
    });
  }

  // Check for null bytes (potential injection)
  if (query.includes('\0')) {
    throw new SecurityError({
      type: 'input',
      message: 'query contains null bytes',
    });
  }

  // Check for control characters (except common whitespace)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(query)) {
    throw new SecurityError({
      type: 'input',
      message: 'query contains invalid control characters',
    });
  }
}

/**
 * Validate a parameter name.
 *
 * @throws SecurityError if validation fails
 */
export function validateParamName(name: string): void {
  if (!name) {
    throw new SecurityError({
      type: 'input',
      message: 'parameter name cannot be empty',
    });
  }

  if (!PARAM_NAME_PATTERN.test(name)) {
    throw new SecurityError({
      type: 'input',
      message: `invalid parameter name: ${name}`,
    });
  }

  if (RESERVED_KEYWORDS.has(name.toLowerCase())) {
    throw new SecurityError({
      type: 'input',
      message: `parameter name is a reserved keyword: ${name}`,
    });
  }
}

/**
 * Validate a parameter value.
 *
 * @throws SecurityError if validation fails
 */
export function validateParamValue(value: unknown): void {
  // Check for circular references
  try {
    JSON.stringify(value);
  } catch {
    throw new SecurityError({
      type: 'input',
      message: 'parameter value contains circular reference or is not serializable',
    });
  }

  // Recursively validate nested values
  validateValueRecursive(value, 0);
}

/**
 * Recursively validate a value with depth limit.
 */
function validateValueRecursive(value: unknown, depth: number): void {
  const MAX_DEPTH = 32;
  if (depth > MAX_DEPTH) {
    throw new SecurityError({
      type: 'input',
      message: `parameter value exceeds maximum nesting depth of ${MAX_DEPTH}`,
    });
  }

  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === 'string') {
    // Check for null bytes
    if (value.includes('\0')) {
      throw new SecurityError({
        type: 'input',
        message: 'parameter value contains null bytes',
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      validateValueRecursive(item, depth + 1);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      validateParamName(key);
      validateValueRecursive(val, depth + 1);
    }
    return;
  }

  // Primitives (number, boolean, bigint) are always valid
}

/**
 * Validate a hostname.
 *
 * @throws SecurityError if validation fails
 */
export function validateHostname(hostname: string): void {
  if (!hostname) {
    throw new SecurityError({
      type: 'input',
      message: 'hostname cannot be empty',
    });
  }

  // Check length
  if (hostname.length > 253) {
    throw new SecurityError({
      type: 'input',
      message: 'hostname exceeds maximum length',
    });
  }

  // Check for valid characters
  // Allow: letters, digits, hyphens, dots, and IPv6 brackets/colons
  if (!/^[a-zA-Z0-9.\-:[\]]+$/.test(hostname)) {
    throw new SecurityError({
      type: 'input',
      message: 'hostname contains invalid characters',
    });
  }

  // Check for IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    const parts = hostname.split('.').map(Number);
    if (parts.some((p) => p < 0 || p > 255)) {
      throw new SecurityError({
        type: 'input',
        message: 'invalid IPv4 address',
      });
    }
    return;
  }

  // Check for IPv6 (simplified check)
  if (hostname.includes(':') || hostname.startsWith('[')) {
    // Basic IPv6 validation - allow colons and hex digits
    const addr = hostname.replace(/^\[|\]$/g, '');
    if (!/^[a-fA-F0-9:]+$/.test(addr)) {
      throw new SecurityError({
        type: 'input',
        message: 'invalid IPv6 address',
      });
    }
    return;
  }

  // Validate as hostname
  const labels = hostname.split('.');
  for (const label of labels) {
    if (!label || label.length > 63) {
      throw new SecurityError({
        type: 'input',
        message: 'hostname label is invalid',
      });
    }
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) {
      throw new SecurityError({
        type: 'input',
        message: 'hostname label contains invalid characters',
      });
    }
  }
}

/**
 * Validate a port number.
 *
 * @throws SecurityError if validation fails
 */
export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SecurityError({
      type: 'input',
      message: 'port must be an integer between 1 and 65535',
    });
  }
}

/**
 * Validate a page size.
 *
 * @throws SecurityError if validation fails
 */
export function validatePageSize(pageSize: number): void {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new SecurityError({
      type: 'input',
      message: 'page size must be a positive integer',
    });
  }
  if (pageSize > MAX_PAGE_SIZE) {
    throw new SecurityError({
      type: 'input',
      message: `page size must not exceed ${MAX_PAGE_SIZE}`,
    });
  }
}

/**
 * Validate a savepoint name.
 *
 * @throws SecurityError if validation fails
 */
export function validateSavepointName(name: string): void {
  if (!name) {
    throw new SecurityError({
      type: 'input',
      message: 'savepoint name cannot be empty',
    });
  }

  if (name.length > 128) {
    throw new SecurityError({
      type: 'input',
      message: 'savepoint name exceeds maximum length of 128 characters',
    });
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new SecurityError({
      type: 'input',
      message: 'savepoint name contains invalid characters',
    });
  }
}

/**
 * Sanitize a string for safe logging (remove sensitive data patterns).
 */
export function sanitizeForLog(value: string): string {
  // Replace potential passwords, tokens, etc.
  return value
    .replace(/password\s*[:=]\s*\S+/gi, 'password=***')
    .replace(/token\s*[:=]\s*\S+/gi, 'token=***')
    .replace(/secret\s*[:=]\s*\S+/gi, 'secret=***')
    .replace(/api[_-]?key\s*[:=]\s*\S+/gi, 'api_key=***');
}
