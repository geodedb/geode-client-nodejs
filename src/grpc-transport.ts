/**
 * gRPC Transport Layer
 *
 * Provides gRPC transport for communication with Geode server.
 * Uses @grpc/grpc-js with dynamic proto loading.
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'node:fs';
import type { GeodeConfig } from './config.js';
import { getAddress } from './config.js';
import { TransportError, ErrClosed } from './errors.js';
import { validateTLSCertPath } from './validate.js';
import {
  getProtoPath,
  type QuicClientMessage,
  type QuicServerMessage,
  type HelloResponse,
  type ExecutionResponse,
  type PullResponse,
  type PingResponse,
  type BeginResponse,
  type CommitResponse,
  type RollbackResponse,
  type SavepointResponse,
  type RollbackToResponse,
} from './proto.js';
import type { Transport } from './transport.js';

// Get proto path from proto.ts (which handles CJS/ESM compatibility)
const PROTO_PATH = getProtoPath();

// Proto loader options
const PROTO_LOADER_OPTIONS: protoLoader.Options = {
  keepCase: false,
  longs: Number,
  enums: Number,
  defaults: true,
  oneofs: true,
};

// Service client type (dynamically loaded)
interface GeodeServiceClient {
  hello(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): void;
  execute(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): void;
  executeStream(request: unknown): grpc.ClientReadableStream<unknown>;
  pull(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): void;
  ping(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): void;
  begin(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): void;
  commit(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): void;
  rollback(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): void;
  savepoint(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): void;
  rollbackTo(
    request: unknown,
    callback: (error: grpc.ServiceError | null, response: unknown) => void
  ): void;
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
  private _activeStream: grpc.ClientReadableStream<unknown> | null = null;

  constructor(address: string) {
    this._address = address;
  }

  /**
   * Connect to the Geode server using gRPC.
   */
  static async connect(cfg: GeodeConfig): Promise<GrpcTransport> {
    const address = getAddress(cfg);
    const transport = new GrpcTransport(address);

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
      if (cfg.tls === false || cfg.insecureSkipVerify) {
        credentials = grpc.credentials.createInsecure();
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
        'grpc.max_receive_message_length': 100 * 1024 * 1024, // 100MB
        'grpc.max_send_message_length': 100 * 1024 * 1024,
        'grpc.keepalive_time_ms': cfg.keepAliveInterval ?? 10000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': 1,
      };

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
        const response = await this.callUnary<HelloResponse>('hello', msg.hello, signal);
        this._pendingResponses.push({ hello: response });
      } else if (msg.execute) {
        const response = await this.callUnary<ExecutionResponse>('execute', msg.execute, signal);
        this._pendingResponses.push({ execute: response });
      } else if (msg.pull) {
        const response = await this.callUnary<PullResponse>('pull', msg.pull, signal);
        // PullResponse wraps ExecutionResponse
        if (response.response) {
          this._pendingResponses.push({ execute: response.response });
        }
      } else if (msg.ping) {
        const response = await this.callUnary<PingResponse>('ping', msg.ping, signal);
        this._pendingResponses.push({ ping: response });
      } else if (msg.begin) {
        const response = await this.callUnary<BeginResponse>('begin', msg.begin, signal);
        this._pendingResponses.push({ begin: response });
      } else if (msg.commit) {
        const response = await this.callUnary<CommitResponse>('commit', msg.commit, signal);
        this._pendingResponses.push({ commit: response });
      } else if (msg.rollback) {
        const response = await this.callUnary<RollbackResponse>('rollback', msg.rollback, signal);
        this._pendingResponses.push({ rollback: response });
      } else if (msg.savepoint) {
        const response = await this.callUnary<SavepointResponse>(
          'savepoint',
          msg.savepoint,
          signal
        );
        this._pendingResponses.push({ savepoint: response });
      } else if (msg.rollbackTo) {
        const response = await this.callUnary<RollbackToResponse>(
          'rollbackTo',
          msg.rollbackTo,
          signal
        );
        this._pendingResponses.push({ rollbackTo: response });
      } else {
        throw new TransportError({
          operation: 'sendProto',
          cause: new Error('Unknown message type'),
        });
      }
    } catch (e) {
      if (e instanceof TransportError) throw e;
      throw new TransportError({
        operation: 'sendProto',
        address: this._address,
        cause: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  /**
   * Receive a protobuf message from the queue.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Method must be async for interface compatibility
  async receiveProto(signal?: AbortSignal): Promise<QuicServerMessage> {
    this.checkClosed();

    if (signal?.aborted) {
      throw new TransportError({ operation: 'receiveProto', cause: new Error('Aborted') });
    }

    // Return queued response
    const response = this._pendingResponses.shift();
    if (response) {
      return response;
    }

    // No response available - this shouldn't happen with proper sendProto usage
    throw new TransportError({
      operation: 'receiveProto',
      cause: new Error('No response available'),
    });
  }

  /**
   * Legacy JSON send (not supported for gRPC).
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async send(_msg: Record<string, unknown>, _signal?: AbortSignal): Promise<void> {
    throw new TransportError({
      operation: 'send',
      cause: new Error('JSON mode not supported for gRPC transport'),
    });
  }

  /**
   * Legacy JSON receive (not supported for gRPC).
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async receive(_signal?: AbortSignal): Promise<Buffer> {
    throw new TransportError({
      operation: 'receive',
      cause: new Error('JSON mode not supported for gRPC transport'),
    });
  }

  /**
   * Close the transport.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    if (this._activeStream) {
      this._activeStream.cancel();
      this._activeStream = null;
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
   * Make a unary RPC call.
   */
  private callUnary<T>(method: string, request: unknown, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this._client) {
        reject(new Error('No client'));
        return;
      }

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
   * Check if closed and throw if so.
   */
  private checkClosed(): void {
    if (this._closed) {
      throw ErrClosed;
    }
  }
}

/**
 * Build SSL options for gRPC from GeodeConfig.
 */
async function buildGrpcSslOptions(cfg: GeodeConfig): Promise<{
  rootCerts: Buffer | null;
  privateKey: Buffer | null;
  certChain: Buffer | null;
}> {
  let rootCerts: Buffer | null = null;
  let privateKey: Buffer | null = null;
  let certChain: Buffer | null = null;

  // Load CA certificate
  if (cfg.tlsCACert) {
    rootCerts = Buffer.from(cfg.tlsCACert);
  } else if (cfg.tlsCA) {
    validateTLSCertPath(cfg.tlsCA, 'tlsCA');
    rootCerts = await fs.promises.readFile(cfg.tlsCA);
  }

  // Load client certificate for mTLS
  if (cfg.tlsCertPEM) {
    certChain = Buffer.from(cfg.tlsCertPEM);
  } else if (cfg.tlsCert) {
    validateTLSCertPath(cfg.tlsCert, 'tlsCert');
    certChain = await fs.promises.readFile(cfg.tlsCert);
  }

  // Load client key for mTLS
  if (cfg.tlsKeyPEM) {
    privateKey = Buffer.from(cfg.tlsKeyPEM);
  } else if (cfg.tlsKey) {
    validateTLSCertPath(cfg.tlsKey, 'tlsKey');
    privateKey = await fs.promises.readFile(cfg.tlsKey);
  }

  return { rootCerts, privateKey, certChain };
}
