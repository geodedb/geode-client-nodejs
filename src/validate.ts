/**
 * Input Validation Module
 *
 * Security-focused validation for user inputs to prevent injection attacks.
 */

import * as fs from 'node:fs';
import { SecurityError } from './errors.js';
import { MAX_QUERY_LENGTH, MAX_PAGE_SIZE } from './config.js';

// Parameter name pattern: alphanumeric with underscores, max 128 chars
const PARAM_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;

// GQL identifier pattern: alphanumeric with underscores, max 128 chars
// Used for labels, relationship types, and property names in queries
const GQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;

// Maximum length for GQL identifiers
const MAX_IDENTIFIER_LENGTH = 128;

// Allowed permission actions (uppercase for GQL syntax)
const ALLOWED_PERMISSION_ACTIONS = new Set(['READ', 'WRITE', 'DELETE', 'CREATE', 'UPDATE', 'ALL']);

// Allowed permission resources
const ALLOWED_PERMISSION_RESOURCES = new Set([
  'NODE',
  'EDGE',
  'RELATIONSHIP',
  'GRAPH',
  'PROPERTY',
  'LABEL',
  'INDEX',
  'CONSTRAINT',
]);

// Allowed RLS policy actions
const ALLOWED_RLS_ACTIONS = new Set(['READ', 'WRITE', 'ALL']);

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
    // GAP #15: Don't include potentially sensitive parameter name in error
    throw new SecurityError({
      type: 'input',
      message:
        'invalid parameter name: must start with letter or underscore and contain only alphanumeric characters and underscores',
    });
  }

  if (RESERVED_KEYWORDS.has(name.toLowerCase())) {
    // GAP #15: Don't include potentially sensitive parameter name in error
    throw new SecurityError({
      type: 'input',
      message: 'parameter name cannot be a reserved keyword',
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

/**
 * Identifier type for validation error messages.
 */
export type IdentifierType = 'label' | 'relationship_type' | 'property' | 'variable';

/**
 * Validate a GQL identifier (label, relationship type, property name, or variable).
 *
 * GQL identifiers must:
 * - Start with a letter or underscore
 * - Contain only alphanumeric characters and underscores
 * - Be at most 128 characters long
 * - Not be a reserved keyword (for variable/property names)
 *
 * @param value - The identifier value to validate
 * @param type - The type of identifier for error messages
 * @param checkReserved - Whether to check against reserved keywords (default: false for labels/types)
 * @throws SecurityError if validation fails
 */
export function validateIdentifier(
  value: string,
  type: IdentifierType,
  checkReserved = false
): void {
  if (!value) {
    throw new SecurityError({
      type: 'input',
      message: `${type} cannot be empty`,
    });
  }

  if (value.length > MAX_IDENTIFIER_LENGTH) {
    // GAP #15: Avoid leaking potentially sensitive input in error messages
    throw new SecurityError({
      type: 'input',
      message: `${type} exceeds maximum length of ${MAX_IDENTIFIER_LENGTH} characters (got ${value.length})`,
    });
  }

  if (!GQL_IDENTIFIER_PATTERN.test(value)) {
    // GAP #15: Don't include full value in error message - only describe the issue
    throw new SecurityError({
      type: 'input',
      message: `invalid ${type}: must start with letter or underscore and contain only alphanumeric characters and underscores`,
    });
  }

  if (checkReserved && RESERVED_KEYWORDS.has(value.toLowerCase())) {
    // GAP #15: Don't include potentially sensitive reserved keyword value
    throw new SecurityError({
      type: 'input',
      message: `${type} cannot be a reserved keyword`,
    });
  }
}

/**
 * Validate a node label.
 *
 * @param label - The label to validate
 * @throws SecurityError if validation fails
 */
export function validateLabel(label: string): void {
  validateIdentifier(label, 'label', false);
}

/**
 * Validate a relationship type.
 *
 * @param type - The relationship type to validate
 * @throws SecurityError if validation fails
 */
export function validateRelationshipType(type: string): void {
  validateIdentifier(type, 'relationship_type', false);
}

/**
 * Validate a property name for safe query interpolation.
 *
 * @param name - The property name to validate
 * @throws SecurityError if validation fails
 */
export function validatePropertyName(name: string): void {
  validateIdentifier(name, 'property', true);
}

/**
 * Validate a variable name.
 *
 * @param name - The variable name to validate
 * @throws SecurityError if validation fails
 */
export function validateVariableName(name: string): void {
  validateIdentifier(name, 'variable', true);
}

/**
 * Validate a permission action.
 *
 * @param action - The action to validate (e.g., 'READ', 'WRITE')
 * @throws SecurityError if validation fails
 */
export function validatePermissionAction(action: string): void {
  if (!action) {
    throw new SecurityError({
      type: 'input',
      message: 'permission action cannot be empty',
    });
  }

  const upperAction = action.toUpperCase();
  if (!ALLOWED_PERMISSION_ACTIONS.has(upperAction)) {
    throw new SecurityError({
      type: 'input',
      message: `invalid permission action: ${action}. Allowed: ${[...ALLOWED_PERMISSION_ACTIONS].join(', ')}`,
    });
  }
}

/**
 * Validate a permission resource.
 *
 * @param resource - The resource to validate (e.g., 'NODE', 'EDGE')
 * @throws SecurityError if validation fails
 */
export function validatePermissionResource(resource: string): void {
  if (!resource) {
    throw new SecurityError({
      type: 'input',
      message: 'permission resource cannot be empty',
    });
  }

  const upperResource = resource.toUpperCase();
  if (!ALLOWED_PERMISSION_RESOURCES.has(upperResource)) {
    throw new SecurityError({
      type: 'input',
      message: `invalid permission resource: ${resource}. Allowed: ${[...ALLOWED_PERMISSION_RESOURCES].join(', ')}`,
    });
  }
}

/**
 * Validate an RLS policy action.
 *
 * @param action - The RLS action to validate (e.g., 'READ', 'WRITE', 'ALL')
 * @throws SecurityError if validation fails
 */
export function validateRLSAction(action: string): void {
  if (!action) {
    throw new SecurityError({
      type: 'input',
      message: 'RLS policy action cannot be empty',
    });
  }

  const upperAction = action.toUpperCase();
  if (!ALLOWED_RLS_ACTIONS.has(upperAction)) {
    throw new SecurityError({
      type: 'input',
      message: `invalid RLS policy action: ${action}. Allowed: ${[...ALLOWED_RLS_ACTIONS].join(', ')}`,
    });
  }
}

/**
 * Validate a role name.
 *
 * @param name - The role name to validate
 * @throws SecurityError if validation fails
 */
export function validateRoleName(name: string): void {
  validateIdentifier(name, 'variable', false); // Roles follow identifier rules
}

/**
 * Validate a username.
 *
 * @param username - The username to validate
 * @throws SecurityError if validation fails
 */
export function validateUsername(username: string): void {
  validateIdentifier(username, 'variable', false); // Usernames follow identifier rules
}

/**
 * Escape a GQL identifier for safe interpolation in queries.
 *
 * This function provides defense-in-depth by both validating and escaping
 * identifiers before they are used in GQL queries. Even though validation
 * should prevent injection, escaping provides an additional safety layer.
 *
 * GQL identifiers that match the simple pattern (starting with letter/underscore,
 * containing only alphanumeric and underscores) are returned as-is.
 * Otherwise, they are wrapped in backticks with internal backticks escaped.
 *
 * @param identifier - The identifier to escape
 * @param type - The type of identifier for validation error messages
 * @returns The escaped identifier safe for query interpolation
 * @throws SecurityError if the identifier fails validation
 *
 * @example
 * ```typescript
 * escapeGQLIdentifier('Person', 'label')     // Returns: "Person"
 * escapeGQLIdentifier('user_name', 'label')  // Returns: "user_name"
 * ```
 */
export function escapeGQLIdentifier(identifier: string, type: IdentifierType): string {
  // First validate the identifier
  validateIdentifier(identifier, type, false);

  // If it matches the simple identifier pattern, return as-is
  if (GQL_IDENTIFIER_PATTERN.test(identifier)) {
    return identifier;
  }

  // Otherwise, escape backticks and wrap in backticks
  // Note: After validation, this branch should rarely be reached since
  // validation enforces the simple pattern. This is defense-in-depth.
  const escaped = identifier.replace(/`/g, '``');
  return '`' + escaped + '`';
}

// RLS Predicate Validation
//
// Allowed keywords in predicates: true, false, null, and, or, not, is, in,
// contains, starts, ends, with, current_user, current_roles, exists, any, all,
// none, single, size, length, type, labels, keys, properties, id, coalesce,
// head, last, tail, nodes, relationships
//
// Allowed tokens: identifiers, dotted property access (n.prop), parameters ($param),
// operators (=, <>, <, >, <=, >=, !=, +, -, *, /, %), literals, brackets
//
// The validation uses a dangerous-pattern blocking approach rather than allowlist
// tokenization for better compatibility with valid predicate expressions.

// Dangerous patterns that indicate injection attempts
const RLS_PREDICATE_DANGEROUS_PATTERNS = [
  // Statement terminators and chaining
  /;/,
  // DDL/DML keywords that should never appear in predicates
  // These are dangerous as standalone keywords in predicates
  /\b(create|drop|delete|detach|set|remove|merge|call|load|unwind|foreach)\b/i,
  // Index hint injection
  /\busing\s+(index|scan)\b/i,
  // Policy/security manipulation commands (more specific patterns)
  // These look for specific command structures, not just the word "user"
  /\b(create|drop|alter)\s+(policy|role|user|permission)\b/i,
  /\b(grant|revoke|deny)\s+\w+/i,
  // Comment injection
  /\/\*/,
  /\*\//,
  /--/,
  /\/\//,
  // Line breaks that could be used for injection
  /[\r\n]/,
  // Backtick escaping
  /`/,
  // Multiple statements
  /\}\s*\{/,
];

/**
 * Validate an RLS policy predicate expression.
 *
 * This performs strict validation to prevent GQL injection attacks.
 * Only safe predicate expressions are allowed.
 *
 * @param predicate - The predicate expression to validate
 * @throws SecurityError if the predicate contains potentially dangerous patterns
 *
 * @example
 * ```typescript
 * // Valid predicates
 * validateRLSPredicate('n.owner = current_user()');
 * validateRLSPredicate('n.visibility = "public" OR n.owner = $user');
 * validateRLSPredicate('exists((n)-[:MEMBER_OF]->(:Team {id: $teamId}))');
 *
 * // Invalid predicates (will throw)
 * validateRLSPredicate('true; DROP POLICY admin'); // Injection attempt
 * validateRLSPredicate('n.x = 1 CREATE (m:Malicious)'); // DDL injection
 * ```
 */
export function validateRLSPredicate(predicate: string): void {
  if (!predicate) {
    throw new SecurityError({
      type: 'input',
      message: 'RLS predicate cannot be empty',
    });
  }

  // First, apply basic query validation (null bytes, control chars, length)
  validateQuery(predicate);

  // Check for dangerous patterns
  for (const pattern of RLS_PREDICATE_DANGEROUS_PATTERNS) {
    if (pattern.test(predicate)) {
      throw new SecurityError({
        type: 'input',
        message: 'RLS predicate contains disallowed pattern',
      });
    }
  }

  // Validate balanced parentheses and brackets
  let parenCount = 0;
  let bracketCount = 0;
  let braceCount = 0;
  let inString: string | null = null;

  for (let i = 0; i < predicate.length; i++) {
    const char = predicate[i];

    // Handle string literals
    if (inString) {
      // GAP #18: Count consecutive backslashes before quote character
      // to correctly handle escaped backslashes (\\) followed by quotes
      // Example: '\\'  - backslash escaped, quote ends string
      //          '\''  - quote escaped, still in string
      //          '\\\'  - backslash escaped + quote escaped, still in string
      if (char === inString) {
        let backslashCount = 0;
        let j = i - 1;
        while (j >= 0 && predicate[j] === '\\') {
          backslashCount++;
          j--;
        }
        // Quote is escaped only if preceded by odd number of backslashes
        // Even number means the backslashes escape each other, leaving quote unescaped
        if (backslashCount % 2 === 0) {
          inString = null;
        }
      }
      continue;
    }

    if (char === "'" || char === '"') {
      inString = char;
      continue;
    }

    // Count brackets
    switch (char) {
      case '(':
        parenCount++;
        break;
      case ')':
        parenCount--;
        break;
      case '[':
        bracketCount++;
        break;
      case ']':
        bracketCount--;
        break;
      case '{':
        braceCount++;
        break;
      case '}':
        braceCount--;
        break;
    }

    // Check for unbalanced brackets (potential injection)
    if (parenCount < 0 || bracketCount < 0 || braceCount < 0) {
      throw new SecurityError({
        type: 'input',
        message: 'RLS predicate contains unbalanced brackets',
      });
    }
  }

  // Ensure all brackets are closed
  if (parenCount !== 0 || bracketCount !== 0 || braceCount !== 0) {
    throw new SecurityError({
      type: 'input',
      message: 'RLS predicate contains unbalanced brackets',
    });
  }

  // Ensure string was closed
  if (inString) {
    throw new SecurityError({
      type: 'input',
      message: 'RLS predicate contains unclosed string literal',
    });
  }
}

/**
 * List of sensitive paths that should never be accessed as TLS certificates.
 * GAP #21: Expanded to include cloud credential paths and user home directories.
 */
const SENSITIVE_PATHS = [
  // System files
  '/etc/passwd',
  '/etc/shadow',
  '/etc/hosts',
  '/proc/',
  '/sys/',
  '/dev/',
  // Root home directory
  '/root/',
  // SSH keys
  '/.ssh/',
  // Kubernetes secrets
  '/var/run/secrets/',
  '/run/secrets/',
  // AWS credentials
  '/.aws/',
  '/credentials',
  // GCP credentials
  '/.config/gcloud/',
  '/gcloud/',
  // Azure credentials
  '/.azure/',
  // Environment files
  '/.env',
  '/env',
];

/**
 * Validate a path string against the sensitive paths blocklist.
 *
 * @param normalizedPath - The normalized path to check
 * @param fieldName - The field name for error messages
 * @throws SecurityError if the path matches a sensitive path
 */
function checkAgainstBlocklist(normalizedPath: string, fieldName: string): void {
  const lowerPath = normalizedPath.toLowerCase();
  for (const sensitive of SENSITIVE_PATHS) {
    if (lowerPath.includes(sensitive)) {
      throw new SecurityError({
        type: 'input',
        message: `${fieldName} path refers to a restricted system file`,
      });
    }
  }
}

/**
 * Validate a file path for TLS certificate loading.
 *
 * Prevents path traversal attacks by ensuring paths are absolute and don't
 * contain directory traversal sequences. Also resolves symlinks to prevent
 * TOCTOU attacks where a symlink points to a restricted file.
 *
 * @param path - The file path to validate
 * @param fieldName - The field name for error messages (e.g., 'tlsCA', 'tlsCert')
 * @throws SecurityError if the path is invalid or contains traversal sequences
 */
export function validateTLSCertPath(path: string, fieldName: string): void {
  if (!path) {
    throw new SecurityError({
      type: 'input',
      message: `${fieldName} path cannot be empty`,
    });
  }

  // Check for null bytes
  if (path.includes('\0')) {
    throw new SecurityError({
      type: 'input',
      message: `${fieldName} path contains null bytes`,
    });
  }

  // Normalize the path to detect traversal attempts
  const normalizedPath = path
    .replace(/\\/g, '/') // Normalize Windows paths
    .replace(/\/+/g, '/'); // Remove duplicate slashes

  // Check for directory traversal sequences
  if (normalizedPath.includes('/../') || normalizedPath.endsWith('/..')) {
    throw new SecurityError({
      type: 'input',
      message: `${fieldName} path contains directory traversal sequence`,
    });
  }

  // Check for traversal at start (../something)
  if (normalizedPath.startsWith('../') || normalizedPath === '..') {
    throw new SecurityError({
      type: 'input',
      message: `${fieldName} path contains directory traversal sequence`,
    });
  }

  // Check for encoded traversal attempts
  if (/%2e%2e/i.test(path) || /%252e/i.test(path)) {
    throw new SecurityError({
      type: 'input',
      message: `${fieldName} path contains encoded traversal sequence`,
    });
  }

  // GAP #21: Check original path against expanded blocklist
  checkAgainstBlocklist(normalizedPath, fieldName);

  // GAP #20: Resolve symlinks to prevent TOCTOU attacks
  // If the file exists, check if it's a symlink and validate the resolved path
  try {
    if (fs.existsSync(path)) {
      const stats = fs.lstatSync(path);
      if (stats.isSymbolicLink()) {
        // Resolve the symlink and validate the target path
        const resolvedPath = fs.realpathSync(path);
        const normalizedResolved = resolvedPath.replace(/\\/g, '/').replace(/\/+/g, '/');

        // Check resolved path against blocklist
        checkAgainstBlocklist(normalizedResolved, fieldName);

        // Check resolved path for traversal (shouldn't happen after realpath, but defense-in-depth)
        if (normalizedResolved.includes('/../') || normalizedResolved.endsWith('/..')) {
          throw new SecurityError({
            type: 'input',
            message: `${fieldName} symlink resolves to a path with directory traversal`,
          });
        }
      }
    }
  } catch (e) {
    // If it's already a SecurityError, rethrow it
    if (e instanceof SecurityError) {
      throw e;
    }
    // For other errors (e.g., permission denied), we continue with just the string validation
    // The actual file read will fail later with a more specific error
  }
}
