/**
 * Scripted in-process Geode server transport.
 *
 * Mirrors what the REAL Geode QUIC server does
 * (`src/server/quic_connection_handler.zig:7544-7566`):
 *
 *   EXECUTE -> SCHEMA, then EVERY data page is PUSHED as an `execute`
 *              response until `final = true`. There is no PULL round trip in
 *              the happy path.
 *   PULL    -> always answered with a `pull`-wrapped response. Once the result
 *              has been delivered inline the server no longer has an active
 *              result set, so it answers 02000 "no active result set"
 *              (`quic_connection_handler.zig:7701`).
 *   PING    -> `{ ping: { ok: true } }`.
 *
 * Emissions go through a single promise chain so the fake keeps the strict
 * ordering of a single QUIC stream: a delayed message blocks the ones behind
 * it, exactly like the real byte stream.
 *
 * This is a scripted protocol double (established convention in this repo, see
 * `tests/unit/inline-pull-desync.test.ts`), NOT a mock of client behaviour: the
 * real `Connection`/`QueryResult` logic runs unmodified against it.
 */

import { TransportError } from '../../../src/errors.js';
import type { Transport } from '../../../src/transport.js';
import type { GeodeConfig } from '../../../src/config.js';
import type { QuicClientMessage, QuicServerMessage } from '../../../src/proto.js';

/** One scripted answer to one EXECUTE. */
export interface PushScript {
  /** Single column name the query returns. */
  column: string;
  /** One entry per pushed page; each entry lists the string values of its rows. */
  pages: string[][];
  /** Delay before SCHEMA is emitted (models a slow server). */
  schemaDelayMs?: number;
  /** Delay before each page is emitted. */
  pageDelayMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class ScriptedGeodeServer implements Transport {
  readonly sent: QuicClientMessage[] = [];

  private _scripts: PushScript[];
  private _queue: QuicServerMessage[] = [];
  private _readers: Array<{
    resolve: (msg: QuicServerMessage) => void;
    reject: (err: Error) => void;
  }> = [];
  private _closed = false;
  private _chain: Promise<void> = Promise.resolve();

  constructor(scripts: PushScript[]) {
    this._scripts = [...scripts];
  }

  /** Server messages the client never read: anything > 0 means it is out of phase. */
  get unconsumed(): number {
    return this._queue.length;
  }

  /** Message kinds the client sent, in order (e.g. `hello,execute,pull`). */
  get sentKinds(): string[] {
    return this.sent.map((m) => Object.keys(m)[0] ?? 'unknown');
  }

  async sendProto(msg: QuicClientMessage, signal?: AbortSignal): Promise<void> {
    if (this._closed) {
      throw new TransportError({ operation: 'sendProto', cause: new Error('Transport closed') });
    }
    if (signal?.aborted) {
      throw new TransportError({ operation: 'sendProto', cause: new Error('Aborted') });
    }

    this.sent.push(msg);

    if (msg.hello) {
      this._emit(0, {
        hello: {
          success: true,
          sessionId: 'scripted-session',
          errorMessage: '',
          capabilities: [],
        },
      });
      return;
    }

    if (msg.execute) {
      const script = this._scripts.shift();
      if (!script) {
        throw new TransportError({
          operation: 'sendProto',
          cause: new Error('scripted server ran out of query scripts'),
        });
      }
      this._emit(script.schemaDelayMs ?? 0, {
        execute: { schema: { columns: [{ name: script.column, type: 'STRING' }] } },
      });
      script.pages.forEach((page, i) => {
        this._emit(script.pageDelayMs ?? 0, {
          execute: {
            page: {
              rows: page.map((value) => ({ values: [{ stringVal: { value, kind: 1 } }] })),
              final: i === script.pages.length - 1,
              ordered: false,
              orderKeys: [],
            },
          },
        });
      });
      return;
    }

    if (msg.pull) {
      // The rows were already pushed, so the server has no active result set.
      this._emit(0, {
        pull: {
          response: {
            status: {
              statusClass: '02000',
              statusSubclass: '000',
              additionalStatuses: [],
              flaggerFindings: [],
            },
            error: {
              code: '02000',
              message: 'no active result set',
              type: 'ERROR',
              anchor: '',
            },
          },
        },
      });
      return;
    }

    if (msg.ping) {
      this._emit(0, { ping: { ok: true } });
      return;
    }

    throw new TransportError({
      operation: 'sendProto',
      cause: new Error(`scripted server received an unsupported message: ${Object.keys(msg)[0]}`),
    });
  }

  async receiveProto(signal?: AbortSignal): Promise<QuicServerMessage> {
    if (this._closed) {
      throw new TransportError({ operation: 'receiveProto', cause: new Error('Transport closed') });
    }
    if (signal?.aborted) {
      throw new TransportError({ operation: 'receiveProto', cause: new Error('Aborted') });
    }

    const queued = this._queue.shift();
    if (queued) {
      return queued;
    }

    return new Promise<QuicServerMessage>((resolve, reject) => {
      let onAbort: (() => void) | null = null;
      const reader = {
        resolve: (msg: QuicServerMessage) => {
          if (onAbort && signal) signal.removeEventListener('abort', onAbort);
          resolve(msg);
        },
        reject: (err: Error) => {
          if (onAbort && signal) signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      };
      this._readers.push(reader);

      if (signal) {
        onAbort = () => {
          const idx = this._readers.indexOf(reader);
          if (idx !== -1) this._readers.splice(idx, 1);
          reject(new TransportError({ operation: 'receiveProto', cause: new Error('Aborted') }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  close(): Promise<void> {
    this._closed = true;
    const readers = this._readers;
    this._readers = [];
    for (const r of readers) {
      r.reject(
        new TransportError({ operation: 'receiveProto', cause: new Error('Transport closed') })
      );
    }
    return Promise.resolve();
  }

  isClosed(): boolean {
    return this._closed;
  }

  getAddress(): string {
    return 'scripted:3141';
  }

  private _emit(delayMs: number, msg: QuicServerMessage): void {
    this._chain = this._chain.then(async () => {
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      if (this._closed) {
        return;
      }
      const reader = this._readers.shift();
      if (reader) {
        reader.resolve(msg);
      } else {
        this._queue.push(msg);
      }
    });
  }
}

/** Base client config for scripted-server tests. */
export const scriptedConfig = (overrides: Partial<GeodeConfig> = {}): GeodeConfig => ({
  host: 'localhost',
  port: 3141,
  pageSize: 100,
  transport: 'quic',
  helloName: 'test',
  helloVersion: '1.0.0',
  conformance: 'min',
  requestTimeout: 2000,
  ...overrides,
});

/** Column names carried by the first row of a raw result set. */
export const columnsOf = (rows: Record<string, unknown>[]): string[] => Object.keys(rows[0] ?? {});

export { sleep };
