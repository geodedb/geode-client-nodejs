/**
 * Geode Client for Node.js
 *
 * A high-performance client library for the Geode graph database,
 * implementing ISO/IEC 39075:2024 GQL standard over QUIC + TLS 1.3.
 *
 * @packageDocumentation
 */

// Main client exports
export { GeodeClient, createClient, createClientWithConfig, type ClientOptions } from './client.js';

// Connection management
export { Connection, type QueryOptions, type QueryParams } from './connection.js';
export { ConnectionPool } from './pool.js';

// Configuration
export {
  type GeodeConfig,
  type PoolConfig,
  parseDSN,
  defaultConfig,
  validateConfig,
  getAddress,
  cloneConfig,
  DEFAULT_PORT,
  DEFAULT_PAGE_SIZE,
  DEFAULT_HELLO_NAME,
  DEFAULT_HELLO_VERSION,
  DEFAULT_CONFORMANCE,
  MAX_QUERY_LENGTH,
  MAX_PAGE_SIZE,
} from './config.js';

// Query results
export { QueryResult, QueryResultIterator } from './result.js';

// Transactions
export { Transaction, withTransaction } from './transaction.js';

// Types
export {
  type GQLValueKind,
  type GQLType,
  type GQLRange,
  type GQLId,
  type GQLNode,
  type GQLEdge,
  type RawEdge,
  type GQLPath,
  GQLValue,
  parseGQLType,
  fromJSON,
  type ColumnDef,
  type ColumnInfo,
  type Row,
  parseRow,
  rowToObject,
} from './types.js';

// Errors
export {
  type GeodeError,
  DriverError,
  TransportError,
  ConfigError,
  SecurityError,
  StateError,
  type ConnectionState,
  StatusClass,
  type StatusClassType,
  ErrClosed,
  ErrQueryInProgress,
  ErrTxInProgress,
  ErrNoTx,
  ErrTxDone,
  ErrRowsClosed,
  ErrBadConn,
  isDriverError,
  isGeodeError,
  isRetryableError,
} from './errors.js';

// Protocol (for advanced usage)
export {
  MsgType,
  RespType,
  type Frame,
  type FrameResult,
  type AdditionalInfo,
  parseFrame,
  isErrorFrame,
  isSchemaFrame,
  isBindingsFrame,
  isFinalFrame,
  frameToError,
  getColumnsFromSchema,
  buildHelloMessage,
  buildRunGQLMessage,
  buildPullMessage,
  buildBeginMessage,
  buildCommitMessage,
  buildRollbackMessage,
  buildSavepointMessage,
  buildRollbackToMessage,
  buildPingMessage,
  serializeMessage,
  rewritePlaceholders,
  countPlaceholders,
  mergeParams,
} from './protocol.js';

// Transport (for advanced usage and testing)
export {
  type Transport,
  BaseTransport,
  QuicheTransport,
  MockTransport,
  createTransport,
  buildTLSConfig,
} from './transport.js';

// Validation
export {
  validateQuery,
  validateParamName,
  validateParamValue,
  validateHostname,
  validatePort,
  validatePageSize,
  validateSavepointName,
  sanitizeForLog,
} from './validate.js';

// Query Builder
export {
  QueryBuilder,
  PatternBuilder,
  PredicateBuilder,
  NodePatternBuilder,
  EdgePatternBuilder,
  query,
  pattern,
  predicate,
  node,
  edge,
  type EdgeDirection,
  type SortDirection,
  type PredicateOp,
  type NodePattern,
  type EdgePattern,
  type PatternElement,
} from './query-builder.js';

// Prepared Statements
export { PreparedStatement, prepare, extractParameters, type ParameterInfo } from './prepared.js';

// Query Explain/Profile
export {
  explain,
  profile,
  formatPlan,
  formatProfile,
  type QueryPlan,
  type QueryProfile,
  type PlanOperation,
  type OperationTiming,
  type ExplainOptions,
} from './explain.js';

// Batch Operations
export {
  batch,
  batchAll,
  batchFirst,
  batchMap,
  batchParallel,
  type BatchQuery,
  type BatchResult,
  type BatchSummary,
  type BatchOptions,
} from './batch.js';

// Authentication & Authorization
export {
  AuthClient,
  createAuthClient,
  type User,
  type Role,
  type Permission,
  type RLSPolicy,
  type CreateUserOptions,
  type CreateRoleOptions,
  type CreateRLSPolicyOptions,
} from './auth.js';

// Re-export decimal.js-light for type convenience
export type { default as Decimal } from 'decimal.js-light';
