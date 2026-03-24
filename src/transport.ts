/**
 * Transport Layer
 *
 * Provides transport abstraction for communication with Geode server.
 * Supports both QUIC (default) and gRPC transports.
 *
 * Wire format for QUIC: 4-byte Big Endian length prefix + protobuf message body.
 */

import * as tls from 'node:tls';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { GeodeConfig } from './config.js';
import { getAddress } from './config.js';
import { TransportError, ErrClosed } from './errors.js';
import { validateTLSCertPath } from './validate.js';
import {
  encodeWithLengthPrefix,
  decodeQuicServerMessage,
  decodeLengthPrefix,
  type QuicClientMessage,
  type QuicServerMessage,
} from './proto.js';

// ALPN protocol for Geode
const GEODE_ALPN = ['geode/1'];

// Maximum allowed sizes to prevent unbounded memory growth (CWE-400)
const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024; // 16 MiB per protobuf message
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024; // 64 MiB buffered

/**
 * Transport interface for communication with Geode server.
 */
export interface Transport {
  /** Send a protobuf message to the server */
  sendProto(msg: QuicClientMessage, signal?: AbortSignal): Promise<void>;

  /** Receive a protobuf message from the server */
  receiveProto(signal?: AbortSignal): Promise<QuicServerMessage>;

  /** Close the transport */
  close(): Promise<void>;

  /** Check if transport is closed */
  isClosed(): boolean;

  /** Get remote address */
  getAddress(): string;
}

/**
 * Build TLS configuration from GeodeConfig.
 */
export async function buildTLSConfig(cfg: GeodeConfig): Promise<tls.SecureContextOptions> {
  const options: tls.SecureContextOptions = {
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
  };

  // Load CA certificate
  if (cfg.tlsCACert) {
    options.ca = cfg.tlsCACert;
  } else if (cfg.tlsCA) {
    // GAP #12: Validate path to prevent directory traversal attacks
    validateTLSCertPath(cfg.tlsCA, 'tlsCA');
    try {
      options.ca = await fs.promises.readFile(cfg.tlsCA, 'utf-8');
    } catch (e) {
      throw new TransportError({
        operation: 'load_ca_cert',
        cause: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  // Load client certificate for mTLS
  if (cfg.tlsCertPEM) {
    options.cert = cfg.tlsCertPEM;
  } else if (cfg.tlsCert) {
    // GAP #12: Validate path to prevent directory traversal attacks
    validateTLSCertPath(cfg.tlsCert, 'tlsCert');
    try {
      options.cert = await fs.promises.readFile(cfg.tlsCert, 'utf-8');
    } catch (e) {
      throw new TransportError({
        operation: 'load_client_cert',
        cause: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  // Load client key for mTLS
  if (cfg.tlsKeyPEM) {
    options.key = cfg.tlsKeyPEM;
  } else if (cfg.tlsKey) {
    // GAP #12: Validate path to prevent directory traversal attacks
    validateTLSCertPath(cfg.tlsKey, 'tlsKey');
    try {
      options.key = await fs.promises.readFile(cfg.tlsKey, 'utf-8');
    } catch (e) {
      throw new TransportError({
        operation: 'load_client_key',
        cause: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  return options;
}

/**
 * Abstract base class for transports.
 */
export abstract class BaseTransport implements Transport {
  protected _closed = false;
  protected _address: string;

  constructor(address: string) {
    this._address = address;
  }

  abstract sendProto(msg: QuicClientMessage, signal?: AbortSignal): Promise<void>;
  abstract receiveProto(signal?: AbortSignal): Promise<QuicServerMessage>;
  abstract close(): Promise<void>;

  isClosed(): boolean {
    return this._closed;
  }

  getAddress(): string {
    return this._address;
  }

  protected checkClosed(): void {
    if (this._closed) {
      throw ErrClosed();
    }
  }
}

/**
 * QUIC transport using @matrixai/quic.
 *
 * This implementation uses the quiche QUIC library via native bindings.
 * Wire format: 4-byte Big Endian length prefix + protobuf message body.
 */
export class QuicTransport extends BaseTransport {
  private _client: unknown = null;
  private _stream: unknown = null;
  private _chunks: Buffer[] = [];
  private _totalLength = 0;
  private _maxMessageSize: number;
  private _maxBufferBytes: number;
  private _pendingProtoReads: Array<{
    resolve: (value: QuicServerMessage) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    address: string,
    maxMessageSize: number = DEFAULT_MAX_MESSAGE_SIZE,
    maxBufferBytes: number = DEFAULT_MAX_BUFFER_BYTES
  ) {
    super(address);
    this._maxMessageSize = maxMessageSize;
    this._maxBufferBytes = maxBufferBytes;
  }

  /**
   * Connect to the Geode server using QUIC.
   */
  static async connect(cfg: GeodeConfig): Promise<QuicTransport> {
    const address = getAddress(cfg);
    const transport = new QuicTransport(address);

    try {
      // Dynamically import @matrixai/quic
      const { QUICClient } = await import('@matrixai/quic');

      // Parse host and port
      const [host = 'localhost', portStr] = address.includes('[')
        ? [address.slice(1, address.lastIndexOf(']')), address.slice(address.lastIndexOf(':') + 1)]
        : address.split(':');
      const port = parseInt(portStr ?? '3141', 10);

      // Create crypto ops using Node.js crypto
      const cryptoOps = {
        ops: {
          randomBytes: (data: ArrayBuffer): Promise<void> => {
            const buf = Buffer.from(data);
            crypto.randomFillSync(buf);
            return Promise.resolve();
          },
        },
      };

      // Build TLS config
      const tlsConfig = await buildTLSConfig(cfg);

      // Create QUIC client configuration
      const config: Record<string, unknown> = {
        applicationProtos: GEODE_ALPN,
        maxIdleTimeout: cfg.maxIdleTime ?? 30000,
        initialMaxData: 10_000_000,
        initialMaxStreamDataBidiLocal: 1_000_000,
        initialMaxStreamDataBidiRemote: 1_000_000,
        initialMaxStreamsBidi: 100,
      };

      // Configure TLS
      if (cfg.insecureSkipVerify) {
        // Security safeguard: warn about insecure configuration
        const isProduction =
          process.env['NODE_ENV'] === 'production' || process.env['GEODE_ENV'] === 'production';
        if (isProduction) {
          // eslint-disable-next-line no-console -- Intentional security warning
          console.warn(
            'SECURITY WARNING: insecureSkipVerify is enabled in production environment. ' +
              'This disables TLS certificate verification and exposes the connection to MITM attacks. ' +
              'Set GEODE_ALLOW_INSECURE_PRODUCTION=true to override this warning.'
          );
          if (process.env['GEODE_ALLOW_INSECURE_PRODUCTION'] !== 'true') {
            throw new TransportError({
              operation: 'connect',
              cause: new Error(
                'insecureSkipVerify is not allowed in production. ' +
                  'Configure proper TLS certificates or set GEODE_ALLOW_INSECURE_PRODUCTION=true to override.'
              ),
            });
          }
        }
        config.verifyPeer = false;
      }
      if (tlsConfig.ca) {
        config.caCerts = [tlsConfig.ca];
      }
      if (tlsConfig.cert && tlsConfig.key) {
        config.cert = tlsConfig.cert;
        config.key = tlsConfig.key;
      }

      // Create QUIC client
      /* eslint-disable @typescript-eslint/await-thenable */
      const client = await QUICClient.createQUICClient(
        {
          host,
          port,
          serverName: cfg.serverName ?? host,
          crypto: cryptoOps,
          config,
        },
        { timer: cfg.connectTimeout ?? 30000 }
      );
      transport._client = client;

      // Open a bidirectional stream
      const connection = client.connection;
      const stream = await connection.newStream();
      transport._stream = stream;
      /* eslint-enable @typescript-eslint/await-thenable */

      // Start reading from stream
      transport.startReading();

      return transport;
    } catch (e) {
      await transport.close();
      throw new TransportError({
        operation: 'connect',
        address,
        cause: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  /**
   * Start reading from the stream in the background.
   */
  private startReading(): void {
    if (!this._stream) return;

    const stream = this._stream as {
      readable: ReadableStream<Uint8Array>;
    };

    const reader = stream.readable.getReader();

    const read = async () => {
      try {
        while (!this._closed) {
          const { done, value } = await reader.read();
          if (done) {
            // Stream ended - reject any pending reads
            this.rejectPendingReads(
              new TransportError({
                operation: 'read',
                cause: new Error('Stream ended unexpectedly'),
              })
            );
            break;
          }
          if (value) {
            this.processData(Buffer.from(value));
          }
        }
      } catch (err) {
        // Stream error - reject any pending reads with the error
        if (!this._closed) {
          this.rejectPendingReads(
            new TransportError({
              operation: 'read',
              cause: err instanceof Error ? err : new Error(String(err)),
            })
          );
        }
      } finally {
        reader.releaseLock();
      }
    };

    void read();
  }

  /**
   * Reject all pending reads with an error.
   */
  private rejectPendingReads(error: Error): void {
    const pending = this._pendingProtoReads;
    this._pendingProtoReads = [];
    for (const p of pending) {
      p.reject(error);
    }
  }

  /**
   * Consolidate the chunk list into a single buffer.
   * Called only when we know we have enough data for at least one operation.
   */
  private consolidateChunks(): Buffer {
    if (this._chunks.length === 0) {
      return Buffer.alloc(0);
    }
    if (this._chunks.length === 1) {
      return this._chunks[0]!;
    }
    const consolidated = Buffer.concat(this._chunks, this._totalLength);
    this._chunks = [consolidated];
    return consolidated;
  }

  /**
   * Process received data (length-prefixed protobuf messages).
   *
   * Uses a chunk list pattern instead of Buffer.concat on every call
   * to avoid O(n^2) copying of the accumulated buffer.
   */
  private processData(data: Buffer): void {
    this._chunks.push(data);
    this._totalLength += data.length;

    // Reject if accumulated buffer exceeds maximum allowed size (CWE-400)
    if (this._totalLength > this._maxBufferBytes) {
      this.handleOversize('buffer');
    }

    // Try to decode complete messages
    while (this._totalLength >= 4) {
      // Consolidate only when we need to read the length prefix
      const buf = this.consolidateChunks();
      const msgLen = decodeLengthPrefix(buf);

      // Reject oversized messages before buffering (CWE-400)
      if (msgLen > this._maxMessageSize) {
        this.handleOversize('message');
      }

      const totalLen = 4 + msgLen;

      if (this._totalLength < totalLen) {
        // Need more data
        break;
      }

      // Extract and decode the message
      const msgData = buf.subarray(4, totalLen);
      const remaining = buf.subarray(totalLen);

      // Update chunks to hold only the remainder
      if (remaining.length > 0) {
        this._chunks = [remaining];
      } else {
        this._chunks = [];
      }
      this._totalLength = remaining.length;

      try {
        const msg = decodeQuicServerMessage(msgData);

        // Resolve pending read or buffer the message
        const pending = this._pendingProtoReads.shift();
        if (pending) {
          pending.resolve(msg);
        }
        // Note: We don't buffer proto messages, they must be consumed immediately
      } catch (err) {
        // Reject pending reads on decode error
        const pending = this._pendingProtoReads.shift();
        if (pending) {
          pending.reject(
            new TransportError({
              operation: 'decode',
              cause: err instanceof Error ? err : new Error(String(err)),
            })
          );
        }
      }
    }
  }

  /**
   * Handle oversized data by closing the transport.
   */
  private handleOversize(kind: 'message' | 'buffer'): never {
    const error = new TransportError({
      operation: 'receive',
      cause: new Error(`Received ${kind} exceeds maximum allowed size`),
    });
    this._chunks = [];
    this._totalLength = 0;
    this.rejectPendingReads(error);
    void this.close();
    throw error;
  }

  /**
   * Send a protobuf message with length prefix.
   */
  async sendProto(msg: QuicClientMessage, signal?: AbortSignal): Promise<void> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'sendProto', cause: new Error('Aborted') });
    }

    if (!this._stream) {
      throw new TransportError({ operation: 'sendProto', cause: new Error('No stream') });
    }

    const data = encodeWithLengthPrefix(msg);

    try {
      const stream = this._stream as {
        writable: WritableStream<Uint8Array>;
      };

      const writer = stream.writable.getWriter();
      await writer.write(new Uint8Array(data));
      writer.releaseLock();
    } catch (e) {
      throw new TransportError({
        operation: 'sendProto',
        address: this._address,
        cause: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  /**
   * Receive a protobuf message.
   */
  async receiveProto(signal?: AbortSignal): Promise<QuicServerMessage> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'receiveProto', cause: new Error('Aborted') });
    }

    return new Promise((resolve, reject) => {
      let onAbort: (() => void) | null = null;

      const pendingRead = {
        resolve: (value: QuicServerMessage) => {
          if (onAbort && signal) {
            signal.removeEventListener('abort', onAbort);
          }
          resolve(value);
        },
        reject: (error: Error) => {
          if (onAbort && signal) {
            signal.removeEventListener('abort', onAbort);
          }
          reject(error);
        },
      };

      this._pendingProtoReads.push(pendingRead);

      if (signal) {
        onAbort = () => {
          const idx = this._pendingProtoReads.indexOf(pendingRead);
          if (idx !== -1) {
            this._pendingProtoReads.splice(idx, 1);
          }
          reject(new TransportError({ operation: 'receiveProto', cause: new Error('Aborted') }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    // Reject pending reads and clear buffers
    for (const pending of this._pendingProtoReads) {
      pending.reject(ErrClosed());
    }
    this._pendingProtoReads = [];
    this._chunks = [];
    this._totalLength = 0;

    // Close QUIC client
    if (this._client) {
      try {
        const client = this._client as { destroy: () => Promise<void> };
        await client.destroy();
      } catch {
        // Ignore close errors
      }
      this._client = null;
    }

    this._stream = null;
  }
}

/**
 * Mock transport for testing purposes.
 *
 * This allows unit testing without a real connection.
 */
export class MockTransport extends BaseTransport {
  private _protoSendQueue: QuicClientMessage[] = [];
  private _protoReceiveQueue: QuicServerMessage[] = [];
  private _pendingProtoReads: Array<{
    resolve: (value: QuicServerMessage) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(address = 'mock:3141') {
    super(address);
  }

  /**
   * Queue a protobuf response.
   */
  queueProtoResponse(response: QuicServerMessage): void {
    // Resolve pending read or queue
    const pending = this._pendingProtoReads.shift();
    if (pending) {
      pending.resolve(response);
    } else {
      this._protoReceiveQueue.push(response);
    }
  }

  /**
   * Get all sent protobuf messages.
   */
  getSentProtoMessages(): QuicClientMessage[] {
    return [...this._protoSendQueue];
  }

  /**
   * Clear sent messages.
   */
  clearSentMessages(): void {
    this._protoSendQueue = [];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async sendProto(msg: QuicClientMessage, signal?: AbortSignal): Promise<void> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'sendProto', cause: new Error('Aborted') });
    }

    this._protoSendQueue.push(msg);
  }

  async receiveProto(signal?: AbortSignal): Promise<QuicServerMessage> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'receiveProto', cause: new Error('Aborted') });
    }

    const queued = this._protoReceiveQueue.shift();
    if (queued) {
      return queued;
    }

    return new Promise((resolve, reject) => {
      let onAbort: (() => void) | null = null;

      const pendingRead = {
        resolve: (value: QuicServerMessage) => {
          if (onAbort && signal) {
            signal.removeEventListener('abort', onAbort);
          }
          resolve(value);
        },
        reject: (error: Error) => {
          if (onAbort && signal) {
            signal.removeEventListener('abort', onAbort);
          }
          reject(error);
        },
      };

      this._pendingProtoReads.push(pendingRead);

      if (signal) {
        onAbort = () => {
          const idx = this._pendingProtoReads.indexOf(pendingRead);
          if (idx !== -1) {
            this._pendingProtoReads.splice(idx, 1);
          }
          reject(new TransportError({ operation: 'receiveProto', cause: new Error('Aborted') }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    for (const pending of this._pendingProtoReads) {
      pending.reject(ErrClosed());
    }
    this._pendingProtoReads = [];
  }
}

/**
 * Create a transport for the given configuration.
 *
 * Selects between QUIC and gRPC based on config.transport.
 */
export async function createTransport(cfg: GeodeConfig): Promise<Transport> {
  if (cfg.transport === 'grpc') {
    const { GrpcTransport } = await import('./grpc-transport.js');
    return GrpcTransport.connect(cfg);
  }
  return QuicTransport.connect(cfg);
}

// Legacy export aliases
export { QuicTransport as MatrixQuicTransport };
export { QuicTransport as QuicheTransport };
