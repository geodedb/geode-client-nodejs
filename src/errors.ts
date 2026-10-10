/**
 * Geode Client Error Types
 *
 * Implements ISO/IEC 39075:2024 status codes for GQL error handling.
 */

// ISO/IEC 39075 status class constants
export const StatusClass = {
  SUCCESS: '00000',
  WARNING: '01000',
  NO_DATA: '02000',
  TRANSACTION_STATE: '25000',
  AUTH: '28000',
  SERIALIZATION: '40001',
  DEADLOCK: '40502',
  SYNTAX: '42000',
  CONSTRAINT: '23000',
  DUPLICATE: '42P07',
  INVALID_PARAM: '22023',
  SYSTEM: '58000',
} as const;

export type StatusClassType = (typeof StatusClass)[keyof typeof StatusClass];

/**
 * Base interface for all Geode errors.
 */
export interface GeodeError extends Error {
  /** ISO/IEC 39075 status class */
  readonly statusClass: StatusClassType;
  /** Whether this error can be retried */
  readonly isRetryable: boolean;
}

/**
 * Error returned from the Geode server.
 */
export class DriverError extends Error implements GeodeError {
  readonly statusClass: StatusClassType;
  readonly subclass: string;
  readonly code: string;
  readonly anchor?: string;
  readonly additional: string[];
  readonly findings: string[];

  constructor(options: {
    statusClass: StatusClassType;
    subclass: string;
    code: string;
    message: string;
    anchor?: string;
    additional?: string[];
    findings?: string[];
  }) {
    const msg = options.message
      ? `geode: ${options.code}: ${options.message}`
      : `geode: ${options.code}`;
    super(msg);
    this.name = 'DriverError';
    this.statusClass = options.statusClass;
    this.subclass = options.subclass;
    this.code = options.code;
    this.anchor = options.anchor;
    this.additional = options.additional ?? [];
    this.findings = options.findings ?? [];
    Object.setPrototypeOf(this, DriverError.prototype);
  }

  get isRetryable(): boolean {
    return (
      this.statusClass === StatusClass.SERIALIZATION || this.statusClass === StatusClass.DEADLOCK
    );
  }
}

/**
 * Transport layer error (QUIC/network failures).
 */
export class TransportError extends Error implements GeodeError {
  readonly statusClass = StatusClass.SYSTEM;
  readonly operation: string;
  readonly address?: string;
  readonly cause?: Error;

  constructor(options: { operation: string; address?: string; cause?: Error }) {
    const addr = options.address ? ` to ${options.address}` : '';
    const causeMsg = options.cause ? `: ${options.cause.message}` : '';
    super(`geode: transport ${options.operation}${addr}${causeMsg}`);
    this.name = 'TransportError';
    this.operation = options.operation;
    this.address = options.address;
    this.cause = options.cause;
    Object.setPrototypeOf(this, TransportError.prototype);
  }

  get isRetryable(): boolean {
    return true; // Transport errors are generally retryable
  }
}

/**
 * Configuration/DSN parsing error.
 */
// Fields that should never have their values included in error messages
const SENSITIVE_CONFIG_FIELDS = new Set([
  'password',
  'pass',
  'key',
  'secret',
  'token',
  'credential',
]);

export class ConfigError extends Error implements GeodeError {
  readonly statusClass = StatusClass.INVALID_PARAM;
  readonly field: string;
  readonly value?: string;

  constructor(options: { field: string; value?: string; message: string }) {
    // Redact values for sensitive fields to prevent credential leakage in logs
    const isSensitive = SENSITIVE_CONFIG_FIELDS.has(options.field.toLowerCase());
    const valStr =
      options.value !== undefined && !isSensitive ? `=${JSON.stringify(options.value)}` : '';
    super(`geode: config ${options.field}${valStr}: ${options.message}`);
    this.name = 'ConfigError';
    this.field = options.field;
    // Don't store sensitive values on the error object either
    this.value = isSensitive ? undefined : options.value;
    Object.setPrototypeOf(this, ConfigError.prototype);
  }

  get isRetryable(): boolean {
    return false; // Config errors require user intervention
  }
}

/**
 * Security validation error (TLS, input validation).
 */
export class SecurityError extends Error implements GeodeError {
  readonly statusClass = StatusClass.AUTH;
  readonly type: 'tls' | 'input' | 'validation';
  readonly cause?: Error;

  constructor(options: { type: 'tls' | 'input' | 'validation'; message: string; cause?: Error }) {
    const causeMsg = options.cause ? `: ${options.cause.message}` : '';
    super(`geode: security ${options.type}: ${options.message}${causeMsg}`);
    this.name = 'SecurityError';
    this.type = options.type;
    this.cause = options.cause;
    Object.setPrototypeOf(this, SecurityError.prototype);
  }

  get isRetryable(): boolean {
    return false; // Security errors require user intervention
  }
}

/**
 * Connection state error.
 */
export class StateError extends Error implements GeodeError {
  readonly statusClass = StatusClass.TRANSACTION_STATE;
  readonly currentState: ConnectionState;
  readonly operation: string;

  constructor(options: { currentState: ConnectionState; operation: string; message?: string }) {
    const msg = options.message
      ? `geode: state error: ${options.operation} (state=${options.currentState}): ${options.message}`
      : `geode: state error: ${options.operation} (state=${options.currentState})`;
    super(msg);
    this.name = 'StateError';
    this.currentState = options.currentState;
    this.operation = options.operation;
    Object.setPrototypeOf(this, StateError.prototype);
  }

  get isRetryable(): boolean {
    return false;
  }
}

/**
 * Connection state enumeration.
 */
export type ConnectionState =
  'idle' | 'executing' | 'in_transaction' | 'fetching' | 'closed' | 'error';

// Sentinel error messages (stable strings for identity checks)
export const ERR_INVALID_IDENT_MESSAGE = 'geode: identifier contains forbidden characters';
export const ERR_INVALID_STRING_MESSAGE = 'geode: string literal contains forbidden characters';
export const ERR_CLOSED_MESSAGE = 'geode: connection closed';
export const ERR_QUERY_IN_PROGRESS_MESSAGE = 'geode: query already in progress';
export const ERR_TX_IN_PROGRESS_MESSAGE = 'geode: transaction already in progress';
export const ERR_NO_TX_MESSAGE = 'geode: no transaction in progress';
export const ERR_TX_DONE_MESSAGE = 'geode: transaction already committed or rolled back';
export const ERR_ROWS_CLOSED_MESSAGE = 'geode: rows closed';
export const ERR_BAD_CONN_MESSAGE = 'geode: bad connection';
export const ERR_NO_ROWS_MESSAGE = 'geode: no rows in result set';

// Sentinel error factory functions
// Each call creates a fresh Error with an accurate stack trace at the throw site.
export function ErrInvalidIdent(): Error {
  return new Error(ERR_INVALID_IDENT_MESSAGE);
}
export function ErrInvalidString(): Error {
  return new Error(ERR_INVALID_STRING_MESSAGE);
}
export function ErrClosed(): Error {
  return new Error(ERR_CLOSED_MESSAGE);
}
/**
 * @deprecated No longer thrown by `Connection`. Concurrent requests on one
 * connection are serialized on the connection's exchange lock instead of
 * failing fast (ENG-3916). Kept exported so existing identity checks still
 * compile.
 */
export function ErrQueryInProgress(): Error {
  return new Error(ERR_QUERY_IN_PROGRESS_MESSAGE);
}
export function ErrTxInProgress(): Error {
  return new Error(ERR_TX_IN_PROGRESS_MESSAGE);
}
export function ErrNoTx(): Error {
  return new Error(ERR_NO_TX_MESSAGE);
}
export function ErrTxDone(): Error {
  return new Error(ERR_TX_DONE_MESSAGE);
}
export function ErrRowsClosed(): Error {
  return new Error(ERR_ROWS_CLOSED_MESSAGE);
}
export function ErrBadConn(): Error {
  return new Error(ERR_BAD_CONN_MESSAGE);
}
export function ErrNoRows(): Error {
  return new Error(ERR_NO_ROWS_MESSAGE);
}

/**
 * Check if an error is a specific sentinel error by message.
 */
export function isSentinelError(err: unknown, message: string): boolean {
  return err instanceof Error && err.message === message;
}

/**
 * Type guard for DriverError.
 */
export function isDriverError(err: unknown): err is DriverError {
  return err instanceof DriverError;
}

/**
 * Type guard for GeodeError.
 */
export function isGeodeError(err: unknown): err is GeodeError {
  return (
    err instanceof DriverError ||
    err instanceof TransportError ||
    err instanceof ConfigError ||
    err instanceof SecurityError ||
    err instanceof StateError
  );
}

/**
 * Check if an error is retryable.
 */
export function isRetryableError(err: unknown): boolean {
  if (isGeodeError(err)) {
    return err.isRetryable;
  }
  return false;
}

/**
 * Reports whether `err` is a Geode authentication/authorization failure
 * (GQL status class 28000 or the Geode-specific 08P01 password-reset
 * extension). Returns false for null and for non-driver errors.
 */
export function isAuthError(err: unknown): boolean {
  if (!isDriverError(err)) {
    return false;
  }
  return err.statusClass === StatusClass.AUTH || (err.statusClass as string) === '08P01';
}

/**
 * Reports whether `err` is a GQL parse/syntax error (status class 42000).
 * Returns false for null and for non-driver errors.
 */
export function isSyntaxError(err: unknown): boolean {
  if (!isDriverError(err)) {
    return false;
  }
  return err.statusClass === StatusClass.SYNTAX;
}
