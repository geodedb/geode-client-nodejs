/**
 * gRPC Transport Layer
 *
 * Provides gRPC transport for communication with Geode server.
 * Uses @grpc/grpc-js with dynamic proto loading.
 *
 * Method mapping (QuicClientMessage field -> gRPC service RPC):
 *   hello     -> Handshake (unary)
 *   execute   -> Execute   (server-streaming: schema + data pages)
 *   pull      -> reads next buffered message from the Execute stream
 *   ping      -> Ping      (unary)
 *   begin     -> Begin     (unary)
 *   commit    -> Commit    (unary)
 *   rollback  -> Rollback  (unary)
 *   savepoint / rollbackTo -> not supported over gRPC
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { GeodeConfig } from './config.js';
import { getAddress } from './config.js';
import { DriverError, StatusClass, TransportError, ErrClosed } from './errors.js';
import {
  getProtoPath,
  type QuicClientMessage,
  type QuicServerMessage,
  type HelloResponse,
  type ExecutionResponse,
  type PingResponse,
  type BeginResponse,
  type CommitResponse,
  type RollbackResponse,
} from './proto.js';
import { type Transport, buildTLSConfig } from './transport.js';

// Get proto path from proto.ts (which handles CJS/ESM compatibility)
const PROTO_PATH = getProtoPath();

// Proto loader options.
//
// `longs: String` (not Number) is required for int64/uint64 fidelity: Number
// silently truncates any value above 2^53, which corrupts server-assigned graph
// ids (ENG-3908). The decimal strings are narrowed back to number/bigint at the
// JS boundary by protoValueToJS().
const PROTO_LOADER_OPTIONS: protoLoader.Options = {
  keepCase: false,
  longs: String,
  enums: Number,
  defaults: true,
  oneofs: true,
};

// Default backpressure threshold: pause stream when this many messages are buffered
const DEFAULT_BACKPRESSURE_THRESHOLD = 2;

// Default stream timeout (ms): abort stream if no data received within this period
const DEFAULT_STREAM_TIMEOUT_MS = 120_000;

// Service client type (dynamically loaded).
// Method names are camelCase of the proto RPC names.
interface GeodeServiceClient {
  handshake(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): grpc.ClientUnaryCall;
  execute(request: unknown): grpc.ClientReadableStream<unknown>;
  ping(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): grpc.ClientUnaryCall;
  begin(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): grpc.ClientUnaryCall;
  commit(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): grpc.ClientUnaryCall;
  rollback(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): grpc.ClientUnaryCall;
  close(): void;
}

/**
 * gRPC transport for Geode database.
 */
export class GrpcTransport implements Transport {
  private _client: GeodeServiceClient | null = null;
  private _closed = false;
  private _address: string;
  private _pendingResponses: QuicServerMessage[] = [];
  private _pendingProtoReads: Array<{
    resolve: (value: QuicServerMessage) => void;
    reject: (error: Error) => void;
  }> = [];
  private _activeStream: grpc.ClientReadableStream<unknown> | null = null;
  private _streamPaused = false;
  private _backpressureThreshold: number = DEFAULT_BACKPRESSURE_THRESHOLD;
  private _streamTimeoutMs: number = DEFAULT_STREAM_TIMEOUT_MS;
  private _streamTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private _streamComplete = false;

  constructor(address: string) {
    this._address = address;
  }

  /**
   * Connect to the Geode server using gRPC.
   */
  static async connect(cfg: GeodeConfig): Promise<GrpcTransport> {
    const address = getAddress(cfg);
    const transport = new GrpcTransport(address);

    // Configure stream timeout from config (0 = disabled)
    if (cfg.requestTimeout !== undefined) {
      transport._streamTimeoutMs = cfg.requestTimeout;
    }

    try {
      // Load proto definition
      const packageDefinition = await protoLoader.load(PROTO_PATH, PROTO_LOADER_OPTIONS);
      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as unknown as {
        geode: {
          GeodeService: new (
            address: string,
            credentials: grpc.ChannelCredentials,
            options?: grpc.ChannelOptions
          ) => GeodeServiceClient;
        };
      };

      // Build channel credentials
      let credentials: grpc.ChannelCredentials;
      if (cfg.tls === false) {
        credentials = grpc.credentials.createInsecure();
      } else if (cfg.insecureSkipVerify) {
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
        // Use TLS but skip certificate verification (for self-signed certs)
        // Load CA cert if provided, otherwise use null (skip CA validation)
        let rootCerts: Buffer | null = null;
        if (cfg.tlsCA) {
          rootCerts = await import('fs').then((fs) => fs.promises.readFile(cfg.tlsCA!));
        } else if (cfg.tlsCACert) {
          rootCerts = Buffer.from(cfg.tlsCACert);
        }
        credentials = grpc.credentials.createSsl(rootCerts, null, null, {
          checkServerIdentity: () => undefined,
          rejectUnauthorized: false,
        });
      } else {
        const sslOptions = await buildGrpcSslOptions(cfg);
        credentials = grpc.credentials.createSsl(
          sslOptions.rootCerts,
          sslOptions.privateKey,
          sslOptions.certChain
        );
      }

      // Channel options
      const options: grpc.ChannelOptions = {
        'grpc.max_receive_message_length': 16 * 1024 * 1024, // 16 MiB (matches QUIC transport)
        'grpc.max_send_message_length': 16 * 1024 * 1024,
        'grpc.keepalive_time_ms': cfg.keepAliveInterval ?? 10000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': 1,
      };

      if (cfg.insecureSkipVerify) {
        const authority = cfg.serverName ?? 'localhost';
        options['grpc.ssl_target_name_override'] = authority;
        options['grpc.default_authority'] = authority;
      }

      // Create client
      transport._client = new protoDescriptor.geode.GeodeService(address, credentials, options);

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
   * Send a protobuf message and queue the response.
   * For gRPC, this makes the appropriate RPC call based on the message type.
   */
  async sendProto(msg: QuicClientMessage, signal?: AbortSignal): Promise<void> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'sendProto', cause: new Error('Aborted') });
    }

    if (!this._client) {
      throw new TransportError({ operation: 'sendProto', cause: new Error('No client') });
    }

    try {
      if (msg.hello) {
        // hello -> Handshake RPC (unary)
        const response = await this.callUnary<HelloResponse>('handshake', msg.hello, signal);
        this.enqueueResponse({ hello: response });
      } else if (msg.execute) {
        // execute -> Execute RPC (server-streaming)
        // Starts the stream and resolves after the first message arrives or stream ends.
        // Subsequent messages are buffered with backpressure.
        await this.callServerStream(msg.execute, signal);
      } else if (msg.pull) {
        // pull -> no separate gRPC RPC; responses are already buffered
        // from the streaming Execute call. If the buffer is empty the
        // caller will get the response via receiveProto which checks
        // the pending queue. Nothing to do here.
        // However, if no buffered responses remain and the stream is complete,
        // push a synthetic final page so the caller knows we're done.
        if (this._pendingResponses.length === 0 && this._pendingProtoReads.length === 0) {
          // Resume the stream if paused, to allow more data to arrive
          if (this._activeStream && this._streamPaused) {
            this._streamPaused = false;
            this._activeStream.resume();
          }
          // If the stream is already complete, push a synthetic final page
          if (this._streamComplete || !this._activeStream) {
            this.enqueueResponse({
              execute: {
                status: {
                  statusClass: '00000',
                  statusSubclass: '',
                  additionalStatuses: [],
                  flaggerFindings: [],
                },
                payload: 'page',
                page: { rows: [], final: true, ordered: false, orderKeys: [] },
              } as ExecutionResponse,
            });
          }
        }
      } else if (msg.ping) {
        const response = await this.callUnary<PingResponse>('ping', msg.ping, signal);
        this.enqueueResponse({ ping: response });
      } else if (msg.begin) {
        const response = await this.callUnary<BeginResponse>('begin', msg.begin, signal);
        this.enqueueResponse({ begin: response });
      } else if (msg.commit) {
        const response = await this.callUnary<CommitResponse>('commit', msg.commit, signal);
        this.enqueueResponse({ commit: response });
      } else if (msg.rollback) {
        const response = await this.callUnary<RollbackResponse>('rollback', msg.rollback, signal);
        this.enqueueResponse({ rollback: response });
      } else if (msg.savepoint) {
        // Savepoint is not exposed as a gRPC RPC on the server.
        throw new DriverError({
          statusClass: StatusClass.SYSTEM,
          subclass: '',
          code: '58000',
          message:
            'Savepoint operations are not supported over gRPC transport. Use QUIC transport (quic://) for savepoint support.',
        });
      } else if (msg.rollbackTo) {
        // RollbackTo is not exposed as a gRPC RPC on the server.
        throw new DriverError({
          statusClass: StatusClass.SYSTEM,
          subclass: '',
          code: '58000',
          message:
            'Savepoint operations are not supported over gRPC transport. Use QUIC transport (quic://) for savepoint support.',
        });
      } else {
        throw new TransportError({
          operation: 'sendProto',
          cause: new Error('Unknown message type'),
        });
      }
    } catch (e) {
      if (e instanceof TransportError || e instanceof DriverError) throw e;
      throw new TransportError({
        operation: 'sendProto',
        address: this._address,
        cause: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  /**
   * Receive a protobuf message from the queue.
   * If no response is buffered, waits for the next streamed message.
   */
  async receiveProto(signal?: AbortSignal): Promise<QuicServerMessage> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'receiveProto', cause: new Error('Aborted') });
    }

    // Return queued response immediately if available
    const response = this._pendingResponses.shift();
    if (response) {
      // Resume the stream if backpressure was applied and buffer drained below threshold
      if (
        this._activeStream &&
        this._streamPaused &&
        this._pendingResponses.length < this._backpressureThreshold
      ) {
        this._streamPaused = false;
        this._activeStream.resume();
      }
      return response;
    }

    // If stream is still active, wait for the next message
    if (this._activeStream && !this._streamComplete) {
      return new Promise<QuicServerMessage>((resolve, reject) => {
        const pendingRead = { resolve, reject };
        this._pendingProtoReads.push(pendingRead);

        // Resume the stream if paused so data can flow
        if (this._activeStream && this._streamPaused) {
          this._streamPaused = false;
          this._activeStream.resume();
        }

        if (signal) {
          const onAbort = () => {
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

    // No response available - this shouldn't happen with proper sendProto usage
    throw new TransportError({
      operation: 'receiveProto',
      cause: new Error('No response available'),
    });
  }

  /**
   * Close the transport.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    this.clearStreamTimeout();

    if (this._activeStream) {
      this._activeStream.cancel();
      this._activeStream = null;
    }

    // Reject any pending reads
    const pendingReads = this._pendingProtoReads;
    this._pendingProtoReads = [];
    for (const p of pendingReads) {
      p.reject(ErrClosed());
    }

    if (this._client) {
      this._client.close();
      this._client = null;
    }
  }

  /**
   * Check if transport is closed.
   */
  isClosed(): boolean {
    return this._closed;
  }

  /**
   * Get remote address.
   */
  getAddress(): string {
    return this._address;
  }

  /**
   * Enqueue a response, resolving a pending read if one exists.
   */
  private enqueueResponse(response: QuicServerMessage): void {
    const pending = this._pendingProtoReads.shift();
    if (pending) {
      pending.resolve(response);
    } else {
      this._pendingResponses.push(response);
    }
  }

  /**
   * Make a unary RPC call.
   */
  private callUnary<T>(method: string, request: unknown, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this._client) {
        reject(new Error('No client'));
        return;
      }

      // Invoked below via clientMethod.call(this._client, ...), so `this` stays bound.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const clientMethod = this._client[method as keyof GeodeServiceClient] as (
        request: unknown,
        callback: (error: grpc.ServiceError | null, response: unknown) => void
      ) => grpc.ClientUnaryCall;

      if (typeof clientMethod !== 'function') {
        reject(new Error(`Unknown method: ${method}`));
        return;
      }

      const call = clientMethod.call(this._client, request, (error, response) => {
        if (error) {
          reject(
            new TransportError({
              operation: method,
              address: this._address,
              cause: new Error(`gRPC error ${error.code}: ${error.message}`),
            })
          );
        } else {
          resolve(response as T);
        }
      });

      if (signal) {
        const onAbort = () => {
          call.cancel();
          reject(new TransportError({ operation: method, cause: new Error('Aborted') }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /**
   * Call the server-streaming Execute RPC.
   * Uses backpressure to prevent unbounded buffering: pauses the stream when
   * the pending response buffer exceeds the threshold, resumes when drained.
   * Enforces a configurable timeout that fires when no data arrives within the period.
   */
  private callServerStream(request: unknown, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._client) {
        reject(new Error('No client'));
        return;
      }

      // Cancel any previous stream
      if (this._activeStream) {
        this._activeStream.cancel();
        this._activeStream = null;
      }

      this._streamComplete = false;
      this._streamPaused = false;
      let resolved = false;

      const stream = this._client.execute(request);
      this._activeStream = stream;

      // PERF-7: Set up stream inactivity timeout
      this.resetStreamTimeout(stream, reject, () => {
        resolved = true;
      });

      stream.on('data', (response: unknown) => {
        // Reset the inactivity timeout on each data event
        this.resetStreamTimeout(stream, reject, () => {
          resolved = true;
        });

        const execResponse = response as ExecutionResponse & {
          payload?: string;
        };
        this.enqueueResponse({ execute: execResponse });

        // Geode's gRPC Execute stream is complete once the final page is emitted.
        // Mark the stream complete immediately so the next query does not race with
        // the trailing end event and cancel an already-finished stream.
        if (
          (execResponse.payload === 'page' && execResponse.page?.final) ||
          execResponse.payload === 'error' ||
          execResponse.payload === 'heartbeat'
        ) {
          this.clearStreamTimeout();
          this._activeStream = null;
          this._streamComplete = true;
        }

        // PERF-2: Apply backpressure when buffer exceeds threshold
        if (
          this._activeStream === stream &&
          this._pendingResponses.length >= this._backpressureThreshold
        ) {
          this._streamPaused = true;
          stream.pause();
        }

        // Resolve the sendProto promise after the first message arrives,
        // so the caller can start consuming via receiveProto
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });

      stream.on('end', () => {
        this.clearStreamTimeout();
        if (this._activeStream === stream) {
          this._activeStream = null;
          this._streamComplete = true;
        }
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });

      stream.on('error', (error: grpc.ServiceError) => {
        this.clearStreamTimeout();
        if (this._activeStream === stream) {
          this._activeStream = null;
          this._streamComplete = true;
        }

        const transportError = new TransportError({
          operation: 'execute',
          address: this._address,
          cause: new Error(`gRPC error ${error.code}: ${error.message}`),
        });

        // Reject any pending reads for the active stream only.
        if (this._activeStream === null || this._streamComplete) {
          const pendingReads = this._pendingProtoReads;
          this._pendingProtoReads = [];
          for (const p of pendingReads) {
            p.reject(transportError);
          }
        }

        if (!resolved) {
          resolved = true;
          reject(transportError);
        }
      });

      if (signal) {
        const onAbort = () => {
          this.clearStreamTimeout();
          stream.cancel();
          if (!resolved) {
            resolved = true;
            reject(new TransportError({ operation: 'execute', cause: new Error('Aborted') }));
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /**
   * Reset the stream inactivity timeout. If no data arrives within
   * _streamTimeoutMs, the stream is cancelled and the promise rejected.
   */
  private resetStreamTimeout(
    stream: grpc.ClientReadableStream<unknown>,
    reject: (error: Error) => void,
    markResolved: () => void
  ): void {
    this.clearStreamTimeout();

    if (this._streamTimeoutMs <= 0) return;

    this._streamTimeoutTimer = setTimeout(() => {
      this._streamTimeoutTimer = null;
      if (this._activeStream === stream) {
        this._activeStream = null;
        this._streamComplete = true;
      }
      stream.cancel();

      const timeoutError = new TransportError({
        operation: 'execute',
        address: this._address,
        cause: new Error(
          `gRPC stream timed out: no data received within ${this._streamTimeoutMs}ms`
        ),
      });

      // Reject any pending reads
      if (this._activeStream === null || this._streamComplete) {
        const pendingReads = this._pendingProtoReads;
        this._pendingProtoReads = [];
        for (const p of pendingReads) {
          p.reject(timeoutError);
        }
      }

      markResolved();
      reject(timeoutError);
    }, this._streamTimeoutMs);
  }

  /**
   * Clear any active stream inactivity timeout.
   */
  private clearStreamTimeout(): void {
    if (this._streamTimeoutTimer !== null) {
      clearTimeout(this._streamTimeoutTimer);
      this._streamTimeoutTimer = null;
    }
  }

  /**
   * Check if closed and throw if so.
   */
  private checkClosed(): void {
    if (this._closed) {
      throw ErrClosed();
    }
  }
}

/**
 * Build SSL options for gRPC from GeodeConfig.
 *
 * Delegates to buildTLSConfig() for cert/key loading and validation,
 * then converts the result to gRPC's expected Buffer format (QUAL-R3).
 */
async function buildGrpcSslOptions(cfg: GeodeConfig): Promise<{
  rootCerts: Buffer | null;
  privateKey: Buffer | null;
  certChain: Buffer | null;
}> {
  const tlsConfig = await buildTLSConfig(cfg);

  // buildTLSConfig only produces string | undefined values (from readFile or PEM),
  // but the tls.SecureContextOptions type signature is broader. We narrow with a
  // runtime check and cast the well-known subset.
  const toBuffer = (value: unknown): Buffer | null => {
    if (value === undefined || value === null) return null;
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string') return Buffer.from(value);
    if (Array.isArray(value)) {
      return Buffer.concat(
        value.map((v: unknown) => (Buffer.isBuffer(v) ? v : Buffer.from(String(v))))
      );
    }
    return null;
  };

  return {
    rootCerts: toBuffer(tlsConfig.ca),
    privateKey: toBuffer(tlsConfig.key),
    certChain: toBuffer(tlsConfig.cert),
  };
}
