/**
 * QUIC Transport Layer
 *
 * Provides QUIC + TLS 1.3 transport for communication with Geode server.
 */

import * as tls from 'node:tls';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import type { GeodeConfig } from './config.js';
import { getAddress } from './config.js';
import { TransportError, ErrClosed } from './errors.js';

// ALPN protocol for Geode
const GEODE_ALPN = ['geode/1'];

/**
 * Transport interface for communication with Geode server.
 */
export interface Transport {
  /** Send a message to the server */
  send(msg: Record<string, unknown>, signal?: AbortSignal): Promise<void>;

  /** Receive a message from the server */
  receive(signal?: AbortSignal): Promise<Buffer>;

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
 * Abstract base class for QUIC transports.
 * Allows for different QUIC implementations.
 */
export abstract class BaseTransport implements Transport {
  protected _closed = false;
  protected _address: string;

  constructor(address: string) {
    this._address = address;
  }

  abstract send(msg: Record<string, unknown>, signal?: AbortSignal): Promise<void>;
  abstract receive(signal?: AbortSignal): Promise<Buffer>;
  abstract close(): Promise<void>;

  isClosed(): boolean {
    return this._closed;
  }

  getAddress(): string {
    return this._address;
  }

  protected checkClosed(): void {
    if (this._closed) {
      throw ErrClosed;
    }
  }
}

/**
 * QUIC transport using @matrixai/quic.
 *
 * This implementation uses the quiche QUIC library via native bindings.
 */
export class MatrixQuicTransport extends BaseTransport {
  private _client: unknown = null;
  private _stream: unknown = null;
  private _readBuffer: Buffer[] = [];
  private _lineBuffer = '';
  private _pendingReads: Array<{
    resolve: (value: Buffer) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(address: string) {
    super(address);
  }

  /**
   * Connect to the Geode server using QUIC.
   */
  static async connect(cfg: GeodeConfig): Promise<MatrixQuicTransport> {
    const address = getAddress(cfg);
    const transport = new MatrixQuicTransport(address);

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
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/await-thenable */
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
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/await-thenable */

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
    const pending = this._pendingReads;
    this._pendingReads = [];
    for (const p of pending) {
      p.reject(error);
    }
  }

  /**
   * Process received data, splitting by newlines.
   */
  private processData(data: Buffer): void {
    this._lineBuffer += data.toString('utf-8');

    let newlineIdx: number;
    while ((newlineIdx = this._lineBuffer.indexOf('\n')) !== -1) {
      const line = this._lineBuffer.slice(0, newlineIdx);
      this._lineBuffer = this._lineBuffer.slice(newlineIdx + 1);

      if (line.length > 0) {
        const pending = this._pendingReads.shift();
        if (pending) {
          pending.resolve(Buffer.from(line, 'utf-8'));
        } else {
          this._readBuffer.push(Buffer.from(line, 'utf-8'));
        }
      }
    }
  }

  async send(msg: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'send', cause: new Error('Aborted') });
    }

    if (!this._stream) {
      throw new TransportError({ operation: 'send', cause: new Error('No stream') });
    }

    const data = Buffer.from(JSON.stringify(msg) + '\n', 'utf-8');

    try {
      const stream = this._stream as {
        writable: WritableStream<Uint8Array>;
      };

      const writer = stream.writable.getWriter();
      await writer.write(new Uint8Array(data));
      writer.releaseLock();
    } catch (e) {
      throw new TransportError({
        operation: 'send',
        address: this._address,
        cause: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  async receive(signal?: AbortSignal): Promise<Buffer> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'receive', cause: new Error('Aborted') });
    }

    // Check buffer first
    const buffered = this._readBuffer.shift();
    if (buffered) {
      return buffered;
    }

    // Wait for data
    return new Promise((resolve, reject) => {
      const pendingRead = { resolve, reject };

      if (signal) {
        const onAbort = () => {
          // CRITICAL: Remove this pending read from the queue before rejecting
          // to prevent data loss when the abort signal fires after data arrives
          const idx = this._pendingReads.indexOf(pendingRead);
          if (idx !== -1) {
            this._pendingReads.splice(idx, 1);
          }
          reject(new TransportError({ operation: 'receive', cause: new Error('Aborted') }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this._pendingReads.push(pendingRead);
    });
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    // Reject pending reads
    for (const pending of this._pendingReads) {
      pending.reject(ErrClosed);
    }
    this._pendingReads = [];

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
 * This allows unit testing without a real QUIC connection.
 */
export class MockTransport extends BaseTransport {
  private _sendQueue: Record<string, unknown>[] = [];
  private _receiveQueue: Buffer[] = [];
  private _pendingReads: Array<{
    resolve: (value: Buffer) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(address = 'mock:3141') {
    super(address);
  }

  /**
   * Queue a response to be returned by receive().
   */
  queueResponse(response: Record<string, unknown>): void {
    const data = Buffer.from(JSON.stringify(response), 'utf-8');
    this._receiveQueue.push(data);

    // Resolve any pending reads
    const pending = this._pendingReads.shift();
    if (pending) {
      const queued = this._receiveQueue.shift();
      if (queued) {
        pending.resolve(queued);
      }
    }
  }

  /**
   * Get all sent messages.
   */
  getSentMessages(): Record<string, unknown>[] {
    return [...this._sendQueue];
  }

  /**
   * Clear sent messages.
   */
  clearSentMessages(): void {
    this._sendQueue = [];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async send(msg: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'send', cause: new Error('Aborted') });
    }

    this._sendQueue.push(msg);
  }

  async receive(signal?: AbortSignal): Promise<Buffer> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'receive', cause: new Error('Aborted') });
    }

    const queued = this._receiveQueue.shift();
    if (queued) {
      return queued;
    }

    return new Promise((resolve, reject) => {
      const pendingRead = { resolve, reject };

      if (signal) {
        const onAbort = () => {
          // CRITICAL: Remove this pending read from the queue before rejecting
          // to prevent data loss when the abort signal fires after data arrives
          const idx = this._pendingReads.indexOf(pendingRead);
          if (idx !== -1) {
            this._pendingReads.splice(idx, 1);
          }
          reject(new TransportError({ operation: 'receive', cause: new Error('Aborted') }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this._pendingReads.push(pendingRead);
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    for (const pending of this._pendingReads) {
      pending.reject(ErrClosed);
    }
    this._pendingReads = [];
  }
}

/**
 * Create a transport for the given configuration.
 *
 * Uses MatrixQuicTransport by default.
 */
export async function createTransport(cfg: GeodeConfig): Promise<Transport> {
  return MatrixQuicTransport.connect(cfg);
}

// Export for backwards compatibility
export { MatrixQuicTransport as QuicheTransport };
