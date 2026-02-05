/**
 * Geode Client Configuration
 *
 * DSN parsing and configuration management.
 * Supports quic:// and grpc:// transport schemes.
 *
 * See geode/docs/DSN.md for the complete DSN specification.
 */

import { ConfigError } from './errors.js';

// Default configuration values
export const DEFAULT_PORT = 3141;
export const DEFAULT_GRPC_PORT = 50051;
export const DEFAULT_PAGE_SIZE = 1000;
export const DEFAULT_HELLO_NAME = 'geode-nodejs';
export const DEFAULT_HELLO_VERSION = '1.0.0';
export const DEFAULT_CONFORMANCE = 'min';
export const MAX_QUERY_LENGTH = 1 << 20; // 1MB
export const MAX_PAGE_SIZE = 100000;
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

/**
 * Transport type for client connections.
 */
export type TransportType = 'quic' | 'grpc';

/**
 * Supported DSN schemes.
 */
export const SUPPORTED_SCHEMES = ['quic', 'grpc'] as const;
export type DSNScheme = (typeof SUPPORTED_SCHEMES)[number];

/**
 * Validate that a port number is within valid TCP/UDP range.
 */
function isValidPort(port: number): boolean {
  return !isNaN(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/**
 * Geode connection configuration.
 */
export interface GeodeConfig {
  /** Server hostname or IP address */
  host: string;

  /** Server port (default: 3141 for QUIC, 50051 for gRPC) */
  port: number;

  /** Transport type (default: 'quic') */
  transport: TransportType;

  /** Number of rows per page (default: 1000) */
  pageSize: number;

  /** Client name sent in HELLO message */
  helloName: string;

  /** Client version sent in HELLO message */
  helloVersion: string;

  /** GQL conformance level (default: "min") */
  conformance: string;

  /** Username for authentication */
  username?: string;

  /** Password for authentication */
  password?: string;

  // TLS configuration
  /** Path to CA certificate file */
  tlsCA?: string;

  /** CA certificate as PEM string */
  tlsCACert?: string;

  /** Path to client certificate file (for mTLS) */
  tlsCert?: string;

  /** Client certificate as PEM string (for mTLS) */
  tlsCertPEM?: string;

  /** Path to client private key file (for mTLS) */
  tlsKey?: string;

  /** Client private key as PEM string (for mTLS) */
  tlsKeyPEM?: string;

  /** Skip TLS verification (DEVELOPMENT ONLY, never use in production) */
  insecureSkipVerify?: boolean;

  /** SNI server name override */
  serverName?: string;

  // Connection options
  /** Connection timeout in milliseconds (default: 30000) */
  connectTimeout?: number;

  /** Request timeout in milliseconds (default: 120000) */
  requestTimeout?: number;

  /** Keep-alive interval in milliseconds (default: 10000) */
  keepAliveInterval?: number;

  /** Maximum idle time in milliseconds (default: 30000) */
  maxIdleTime?: number;

  // gRPC-specific options
  /** Enable TLS for gRPC (default: true) */
  tls?: boolean;
}

/**
 * Connection pool configuration.
 */
export interface PoolConfig extends GeodeConfig {
  /** Minimum number of connections in pool (default: 2) */
  minConnections?: number;

  /** Maximum number of connections in pool (default: 10) */
  maxConnections?: number;

  /** Time to wait for connection in milliseconds (default: 30000) */
  acquireTimeout?: number;

  /** Idle connection lifetime in milliseconds (default: 60000) */
  idleTimeout?: number;
}

/**
 * Create a default configuration.
 */
export function defaultConfig(): GeodeConfig {
  return {
    host: 'localhost',
    port: DEFAULT_PORT,
    transport: 'quic',
    pageSize: DEFAULT_PAGE_SIZE,
    helloName: DEFAULT_HELLO_NAME,
    helloVersion: DEFAULT_HELLO_VERSION,
    conformance: DEFAULT_CONFORMANCE,
    connectTimeout: 30000,
    requestTimeout: 120000,
    keepAliveInterval: 10000,
    maxIdleTime: 30000,
    tls: true,
  };
}

/**
 * Parse a DSN (Data Source Name) string into configuration.
 *
 * Supported formats:
 *   - quic://host:port?options (QUIC transport, default)
 *   - grpc://host:port?options (gRPC transport)
 *   - host:port?options (defaults to QUIC)
 *   - host:port
 *   - host (uses default port)
 *
 * Supported options:
 *   - page_size: Results page size (default: 1000)
 *   - hello_name: Client name (default: "geode-nodejs")
 *   - hello_ver: Client version (default: "1.0.0")
 *   - conformance: GQL conformance level (default: "min")
 *   - username/user: Authentication username
 *   - password/pass: Authentication password
 *   - ca: Path to CA certificate
 *   - cert: Path to client certificate (for mTLS)
 *   - key: Path to client key (for mTLS)
 *   - insecure: Skip TLS verification (testing only)
 *   - tls: Enable/disable TLS for gRPC (default: true)
 *   - server_name: SNI server name
 *   - connect_timeout: Connection timeout in ms
 *   - request_timeout: Request timeout in ms
 *
 * Environment variables (used as defaults):
 *   - GEODE_HOST: Default host
 *   - GEODE_PORT: Default port
 *   - GEODE_TLS_CA: Default CA certificate path
 *   - GEODE_USERNAME: Default username
 *   - GEODE_PASSWORD: Default password
 *   - GEODE_TRANSPORT: Default transport type (quic or grpc)
 */
export function parseDSN(dsn: string): GeodeConfig {
  // CANARY: REQ=REQ-CLIENT-NODEJS-001; FEATURE="NodejsClientConnect"; ASPECT=DSNParse; STATUS=IMPL; OWNER=clients; UPDATED=2025-02-14
  const cfg = defaultConfig();

  // Apply environment variable defaults
  if (process.env['GEODE_HOST']) {
    cfg.host = process.env['GEODE_HOST'];
  }
  if (process.env['GEODE_PORT']) {
    const port = parseInt(process.env['GEODE_PORT'], 10);
    if (isValidPort(port)) {
      cfg.port = port;
    }
  }
  if (process.env['GEODE_TLS_CA']) {
    cfg.tlsCA = process.env['GEODE_TLS_CA'];
  }
  if (process.env['GEODE_USERNAME']) {
    cfg.username = process.env['GEODE_USERNAME'];
  }
  if (process.env['GEODE_PASSWORD']) {
    cfg.password = process.env['GEODE_PASSWORD'];
  }
  if (process.env['GEODE_TRANSPORT']) {
    const transport = process.env['GEODE_TRANSPORT'].toLowerCase();
    if (transport === 'grpc' || transport === 'quic') {
      cfg.transport = transport;
    }
  }

  dsn = dsn.trim();
  if (!dsn) {
    return cfg;
  }

  // Extract scheme if present
  const schemeMatch = dsn.match(/^([a-z]+):\/\//i);
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase();

    // Check for unsupported schemes
    if (!SUPPORTED_SCHEMES.includes(scheme as DSNScheme)) {
      throw new ConfigError({
        field: 'scheme',
        value: scheme,
        message: `unsupported scheme '${scheme}'. Supported schemes: ${SUPPORTED_SCHEMES.join(', ')}`,
      });
    }

    return parseURLDSN(dsn, cfg, scheme as DSNScheme);
  }

  // Parse as host:port?options (default to QUIC)
  return parseSimpleDSN(dsn, cfg);
}

/**
 * Determine transport type from scheme.
 */
function schemeToTransport(scheme: DSNScheme): TransportType {
  switch (scheme) {
    case 'grpc':
      return 'grpc';
    case 'quic':
    default:
      return 'quic';
  }
}

/**
 * Get default port for transport type.
 */
function getDefaultPortForTransport(transport: TransportType): number {
  return transport === 'grpc' ? DEFAULT_GRPC_PORT : DEFAULT_PORT;
}

/**
 * Parse a URL format DSN (quic://, grpc://).
 */
function parseURLDSN(dsn: string, cfg: GeodeConfig, scheme: DSNScheme): GeodeConfig {
  // Set transport based on scheme
  cfg.transport = schemeToTransport(scheme);

  // For URL parsing, normalize the scheme to a standard one
  const normalizedDsn = dsn.replace(/^[a-z]+:\/\//i, 'http://');

  let url: URL;
  try {
    url = new URL(normalizedDsn);
  } catch {
    throw new ConfigError({
      field: 'dsn',
      value: dsn,
      message: 'invalid URL format',
    });
  }

  if (!url.hostname) {
    throw new ConfigError({
      field: 'host',
      message: 'host is required',
    });
  }

  // Strip brackets from IPv6 addresses (URL class includes them)
  cfg.host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');

  if (url.port) {
    const port = parseInt(url.port, 10);
    if (!isValidPort(port)) {
      throw new ConfigError({
        field: 'port',
        value: url.port,
        message: `must be a valid port number (${MIN_PORT}-${MAX_PORT})`,
      });
    }
    cfg.port = port;
  } else {
    // Use transport-specific default port
    cfg.port = getDefaultPortForTransport(cfg.transport);
  }

  // Parse credentials from URL
  if (url.username) {
    cfg.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    cfg.password = decodeURIComponent(url.password);
  }

  // Parse query parameters
  applyQueryParams(url.searchParams, cfg);

  return cfg;
}

/**
 * Parse a simple host:port?options format DSN.
 */
function parseSimpleDSN(dsn: string, cfg: GeodeConfig): GeodeConfig {
  // Split off query string if present
  let queryStr = '';
  const queryIdx = dsn.indexOf('?');
  if (queryIdx >= 0) {
    queryStr = dsn.slice(queryIdx + 1);
    dsn = dsn.slice(0, queryIdx);
  }

  // Parse host:port
  if (dsn) {
    const result = parseHostPort(dsn);
    cfg.host = result.host;
    cfg.port = result.port;
  }

  // Parse query parameters
  if (queryStr) {
    const params = new URLSearchParams(queryStr);
    applyQueryParams(params, cfg);
  }

  return cfg;
}

/**
 * Parse host:port string with IPv6 support.
 */
function parseHostPort(addr: string): { host: string; port: number } {
  // Check for IPv6 address in brackets
  if (addr.startsWith('[')) {
    const closeBracket = addr.indexOf(']');
    if (closeBracket === -1) {
      throw new ConfigError({
        field: 'host',
        value: addr,
        message: 'invalid IPv6 address format',
      });
    }
    const host = addr.slice(1, closeBracket);
    const rest = addr.slice(closeBracket + 1);
    if (rest.startsWith(':')) {
      const port = parseInt(rest.slice(1), 10);
      if (!isValidPort(port)) {
        throw new ConfigError({
          field: 'port',
          value: rest.slice(1),
          message: `must be a valid port number (${MIN_PORT}-${MAX_PORT})`,
        });
      }
      return { host, port };
    }
    return { host, port: DEFAULT_PORT };
  }

  // Regular host:port
  const lastColon = addr.lastIndexOf(':');
  if (lastColon === -1) {
    return { host: addr, port: DEFAULT_PORT };
  }

  // Check if there are multiple colons (IPv6 without brackets)
  if (addr.indexOf(':') !== lastColon) {
    // Treat entire string as IPv6 host
    return { host: addr, port: DEFAULT_PORT };
  }

  const host = addr.slice(0, lastColon);
  const portStr = addr.slice(lastColon + 1);
  const port = parseInt(portStr, 10);

  if (!isValidPort(port)) {
    throw new ConfigError({
      field: 'port',
      value: portStr,
      message: `must be a valid port number (${MIN_PORT}-${MAX_PORT})`,
    });
  }

  if (!host) {
    throw new ConfigError({
      field: 'host',
      message: 'host is required',
    });
  }

  return { host, port };
}

/**
 * Apply URL query parameters to configuration.
 */
function applyQueryParams(params: URLSearchParams, cfg: GeodeConfig): void {
  for (const [key, value] of params) {
    switch (key) {
      case 'page_size': {
        const n = parseInt(value, 10);
        if (isNaN(n) || n <= 0) {
          throw new ConfigError({
            field: 'page_size',
            value,
            message: 'must be a positive integer',
          });
        }
        if (n > MAX_PAGE_SIZE) {
          throw new ConfigError({
            field: 'page_size',
            value,
            message: `must not exceed ${MAX_PAGE_SIZE}`,
          });
        }
        cfg.pageSize = n;
        break;
      }

      case 'hello_name':
        if (!value) {
          throw new ConfigError({
            field: 'hello_name',
            message: 'cannot be empty',
          });
        }
        cfg.helloName = value;
        break;

      case 'hello_ver':
        if (!value) {
          throw new ConfigError({
            field: 'hello_ver',
            message: 'cannot be empty',
          });
        }
        cfg.helloVersion = value;
        break;

      case 'conformance':
        cfg.conformance = value;
        break;

      case 'username':
      case 'user':
        cfg.username = value;
        break;

      case 'password':
      case 'pass':
        cfg.password = value;
        break;

      case 'ca':
      case 'ca_cert':
        cfg.tlsCA = value;
        break;

      case 'cert':
      case 'client_cert':
        cfg.tlsCert = value;
        break;

      case 'key':
      case 'client_key':
        cfg.tlsKey = value;
        break;

      case 'insecure_tls_skip_verify':
      case 'insecure':
      case 'skip_verify':
        cfg.insecureSkipVerify =
          value === 'true' || value === '1' || value === 'yes' || value === 'on';
        break;

      case 'tls':
        cfg.tls = value !== 'false' && value !== '0';
        break;

      case 'server_name':
        cfg.serverName = value;
        break;

      case 'connect_timeout':
      case 'timeout': {
        const n = parseInt(value, 10);
        if (!isNaN(n) && n > 0) {
          // If specified in seconds (timeout), convert to ms; connect_timeout is already in ms
          cfg.connectTimeout = key === 'timeout' ? n * 1000 : n;
        }
        break;
      }

      case 'request_timeout': {
        const n = parseInt(value, 10);
        if (!isNaN(n) && n > 0) {
          cfg.requestTimeout = n;
        }
        break;
      }

      // Ignore unknown parameters for forward compatibility
    }
  }

  // Validate mTLS configuration - XOR: one but not both
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Using logical OR for XOR check, not nullish fallback
  if ((cfg.tlsCert && !cfg.tlsKey) || (!cfg.tlsCert && cfg.tlsKey)) {
    throw new ConfigError({
      field: 'tls',
      message: 'both cert and key must be provided for mTLS',
    });
  }
}

/**
 * Validate configuration.
 */
export function validateConfig(cfg: GeodeConfig): void {
  if (!cfg.host) {
    throw new ConfigError({
      field: 'host',
      message: 'host is required',
    });
  }

  if (!cfg.port || cfg.port < 1 || cfg.port > 65535) {
    throw new ConfigError({
      field: 'port',
      value: String(cfg.port),
      message: 'must be a valid port number (1-65535)',
    });
  }

  if (cfg.pageSize <= 0) {
    throw new ConfigError({
      field: 'pageSize',
      value: String(cfg.pageSize),
      message: 'must be positive',
    });
  }

  if (cfg.pageSize > MAX_PAGE_SIZE) {
    throw new ConfigError({
      field: 'pageSize',
      value: String(cfg.pageSize),
      message: `must not exceed ${MAX_PAGE_SIZE}`,
    });
  }
}

/**
 * Get the server address in host:port format.
 */
export function getAddress(cfg: GeodeConfig): string {
  // Handle IPv6 addresses
  if (cfg.host.includes(':')) {
    return `[${cfg.host}]:${cfg.port}`;
  }
  return `${cfg.host}:${cfg.port}`;
}

/**
 * Clone configuration.
 */
export function cloneConfig(cfg: GeodeConfig): GeodeConfig {
  return { ...cfg };
}

/**
 * Redact credentials from a DSN string for safe logging.
 *
 * Replaces username and password with '***' to prevent credential exposure
 * in logs, error messages, or other output.
 *
 * @example
 * ```typescript
 * redactDSN('quic://admin:secret@localhost:3141')
 * // Returns: 'quic://***:***@localhost:3141'
 *
 * redactDSN('grpc://localhost:50051?username=admin&password=secret')
 * // Returns: 'grpc://localhost:50051?username=***&password=***'
 * ```
 */
export function redactDSN(dsn: string): string {
  if (!dsn) {
    return dsn;
  }

  // Handle URL format (quic://, grpc://)
  const schemeMatch = dsn.match(/^([a-z]+):\/\//i);
  if (schemeMatch) {
    const scheme = schemeMatch[1]!;
    try {
      // Normalize to http:// for URL parsing, then restore original scheme
      const normalizedDsn = dsn.replace(/^[a-z]+:\/\//i, 'http://');
      const url = new URL(normalizedDsn);

      // Redact username and password in URL
      if (url.username) {
        url.username = '***';
      }
      if (url.password) {
        url.password = '***';
      }

      // Redact password/pass query params
      if (url.searchParams.has('password')) {
        url.searchParams.set('password', '***');
      }
      if (url.searchParams.has('pass')) {
        url.searchParams.set('pass', '***');
      }
      if (url.searchParams.has('username')) {
        url.searchParams.set('username', '***');
      }
      if (url.searchParams.has('user')) {
        url.searchParams.set('user', '***');
      }

      // Restore original scheme
      return url.toString().replace(/^http:\/\//, `${scheme}://`);
    } catch {
      // If URL parsing fails, fall through to string-based redaction
    }
  }

  // String-based redaction for simple DSN format
  let result = dsn;

  // Redact password in query params
  result = result.replace(/(password|pass)=([^&]*)/gi, '$1=***');

  // Redact username in query params
  result = result.replace(/(username|user)=([^&]*)/gi, '$1=***');

  return result;
}

/**
 * Redact credentials from a configuration object for safe logging.
 *
 * Returns a new config object with password set to '***'.
 */
export function redactConfig(cfg: GeodeConfig): GeodeConfig {
  return {
    ...cfg,
    password: cfg.password ? '***' : undefined,
  };
}
