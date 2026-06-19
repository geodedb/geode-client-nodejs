/**
 * Geode Client for Node.js
 *
 * A high-performance client library for the Geode graph database,
 * implementing ISO/IEC 39075:2024 GQL standard over QUIC + TLS 1.3 or gRPC.
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
  type TransportType,
  type DSNScheme,
  parseDSN,
  formatDSN,
  defaultConfig,
  validateConfig,
  getAddress,
  cloneConfig,
  redactDSN,
  redactConfig,
  DEFAULT_PORT,
  DEFAULT_GRPC_PORT,
  DEFAULT_PAGE_SIZE,
  DEFAULT_HELLO_NAME,
  DEFAULT_HELLO_VERSION,
  DEFAULT_CONFORMANCE,
  MAX_QUERY_LENGTH,
  MAX_PAGE_SIZE,
  SUPPORTED_SCHEMES,
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
  ErrInvalidIdent,
  ErrInvalidString,
  ErrClosed,
  ErrQueryInProgress,
  ErrTxInProgress,
  ErrNoTx,
  ErrTxDone,
  ErrRowsClosed,
  ErrBadConn,
  ErrNoRows,
  ERR_INVALID_IDENT_MESSAGE,
  ERR_INVALID_STRING_MESSAGE,
  ERR_CLOSED_MESSAGE,
  ERR_QUERY_IN_PROGRESS_MESSAGE,
  ERR_TX_IN_PROGRESS_MESSAGE,
  ERR_NO_TX_MESSAGE,
  ERR_TX_DONE_MESSAGE,
  ERR_ROWS_CLOSED_MESSAGE,
  ERR_BAD_CONN_MESSAGE,
  ERR_NO_ROWS_MESSAGE,
  isSentinelError,
  isDriverError,
  isGeodeError,
  isRetryableError,
  isAuthError,
  isSyntaxError,
} from './errors.js';

// Quoting helpers
export { quoteIdent, quoteString, sanitizeGraphName } from './quote.js';

// Transport (for advanced usage and testing)
export {
  type Transport,
  BaseTransport,
  QuicTransport,
  QuicheTransport,
  MockTransport,
  createTransport,
  buildTLSConfig,
} from './transport.js';

// gRPC Transport
export { GrpcTransport } from './grpc-transport.js';

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

// Protobuf wire protocol (for advanced usage)
export {
  encodeWithLengthPrefix,
  encodeQuicClientMessage,
  decodeQuicServerMessage,
  decodeLengthPrefix,
  protoValueToJS,
  jsToProtoValue,
  buildHelloRequest,
  buildExecuteRequest,
  buildPullRequest,
  buildPingRequest,
  buildBeginRequest,
  buildCommitRequest,
  buildRollbackRequest,
  buildSavepointRequest,
  buildRollbackToRequest,
  rowToRecord,
  getProtoPath,
  ensureProtoInitialized,
  initProtoSync,
  type HelloRequest,
  type HelloResponse,
  type ExecuteRequest,
  type ExecutionResponse,
  type SchemaDefinition,
  type ColumnDefinition,
  type DataPage,
  type Row as ProtoRow,
  type ProtoValue,
  type ProtoError,
  type PingRequest,
  type PingResponse,
  type BeginRequest,
  type BeginResponse,
  type CommitRequest,
  type CommitResponse,
  type RollbackRequest,
  type RollbackResponse,
  type QuicClientMessage,
  type QuicServerMessage,
  type Param,
  type PullRequest,
  type PullResponse,
  type Status,
} from './proto.js';

// Retry policy
export { defaultRetryPolicy, backoffDelay, retry, type RetryPolicy } from './retry.js';

// Schema loading
export { parseSchemaFS, type Statement } from './schema.js';

// Pipeline / batch execution
export {
  batchExec,
  pipelineExec,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_WORKERS,
  type PipelineExecutor,
  type PipelineTx,
} from './pipeline.js';

// Re-export decimal.js-light for type convenience
export type { default as Decimal } from 'decimal.js-light';

// Field-level encryption (FLE)
export { createCipher, GeodeCipher } from './crypto.js';
