import { describe, it, expect } from 'vitest';
import protobuf from 'protobufjs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuicTransport } from '../../src/transport.js';
import { TransportError } from '../../src/errors.js';
import type { QuicServerMessage } from '../../src/proto.js';

/**
 * ENG-3908 (transport half of the bug).
 *
 * `QuicTransport.processData` decodes each length-prefixed frame inside a
 * try/catch. On a decode failure it only rejects a PARKED reader; when nothing
 * is parked -- the normal case for the inline fast path, where the server pushes
 * the schema and the final page before the client parks its next read -- both the
 * frame AND the error are dropped on the floor. The inline read then times out,
 * the client falls back to PULL, and the server answers 02000
 * "no active result set", which is the user-visible symptom.
 *
 * Post-fix expectations exercised here:
 *   1. Frames that arrive with no parked reader are buffered and delivered by a
 *      later `receiveProto()` -- including pages carrying int64 ids above 2^53.
 *   2. A frame that genuinely cannot be decoded surfaces an error to the next
 *      `receiveProto()` instead of silently vanishing.
 */

const __test_dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__test_dirname, '..', '..', 'proto', 'geode.proto');

const root = protobuf.loadSync(PROTO_PATH);
const ServerMessageType = root.lookupType('geode.QuicServerMessage');

const UNSAFE_ID = 9007199254740993n; // 2^53 + 1

type TransportInternals = {
  processData: (data: Buffer) => void;
};

/** Encode a QuicServerMessage as a 4-byte big-endian length-prefixed frame. */
function frame(msg: object): Buffer {
  const body = Buffer.from(ServerMessageType.encode(ServerMessageType.create(msg)).finish());
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(body.length, 0);
  return Buffer.concat([lenBuf, body]);
}

/** Length-prefixed frame whose body is not a decodable QuicServerMessage. */
function corruptFrame(): Buffer {
  // Field 1, wire type 2 (length-delimited) declaring 32 bytes but supplying 1:
  // the decoder hits a premature EOF.
  const body = Buffer.from([0x0a, 0x20, 0x01]);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(body.length, 0);
  return Buffer.concat([lenBuf, body]);
}

const SCHEMA_MSG = {
  execute: { schema: { columns: [{ name: 'id', type: 'BIGINT' }] } },
};

const FINAL_PAGE_MSG = {
  execute: {
    page: {
      rows: [{ values: [{ intVal: { value: UNSAFE_ID.toString(), kind: 3 } }] }],
      final: true,
      ordered: false,
      orderKeys: [],
    },
  },
};

/**
 * Await `receiveProto()` but fail fast instead of hanging forever. A timeout
 * here means the frame was silently dropped by the pump (the ENG-3908 symptom
 * that manifests to users as an inline-read timeout).
 */
async function receiveWithin(transport: QuicTransport, ms = 200): Promise<QuicServerMessage> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `receiveProto() did not settle within ${ms}ms - frame was silently dropped by processData`
          )
        ),
      ms
    );
    timer.unref();
  });
  try {
    return await Promise.race([transport.receiveProto(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('ENG-3908 QuicTransport.processData: frames arriving with no parked reader', () => {
  // Regression: the inline fast path delivers [schema][final page] in a single
  // read before the client parks a reader. The page carried an id above 2^53,
  // decode threw, and processData discarded both the frame and the error.
  it('buffers a schema + final page pushed in one chunk with no reader parked [regression]', async () => {
    const transport = new QuicTransport('mock:3141');
    const internal = transport as unknown as TransportInternals;

    // No reader is parked: the server pushed both frames inline.
    internal.processData(Buffer.concat([frame(SCHEMA_MSG), frame(FINAL_PAGE_MSG)]));

    const schemaMsg = await receiveWithin(transport);
    expect(schemaMsg.execute?.schema?.columns?.[0]?.name).toBe('id');

    const pageMsg = await receiveWithin(transport);
    const page = pageMsg.execute?.page;
    expect(page?.final).toBe(true);
    const decodedId = page?.rows?.[0]?.values?.[0]?.intVal?.value;
    expect(decodedId).toBeDefined();
    expect(BigInt(decodedId as number | bigint | string)).toBe(UNSAFE_ID);

    await transport.close();
  });

  it('delivers a final page with an unsafe id to a reader parked after arrival [regression]', async () => {
    const transport = new QuicTransport('mock:3141');
    const internal = transport as unknown as TransportInternals;

    internal.processData(frame(FINAL_PAGE_MSG));

    const msg = await receiveWithin(transport);
    const decodedId = msg.execute?.page?.rows?.[0]?.values?.[0]?.intVal?.value;
    expect(BigInt(decodedId as number | bigint | string)).toBe(UNSAFE_ID);

    await transport.close();
  });

  it('delivers a final page with an unsafe id to an already parked reader [regression]', async () => {
    const transport = new QuicTransport('mock:3141');
    const internal = transport as unknown as TransportInternals;

    // Reader parked first: today this rejects with a decode TransportError.
    const pending = receiveWithin(transport);
    internal.processData(frame(FINAL_PAGE_MSG));

    const msg = await pending;
    const decodedId = msg.execute?.page?.rows?.[0]?.values?.[0]?.intVal?.value;
    expect(BigInt(decodedId as number | bigint | string)).toBe(UNSAFE_ID);

    await transport.close();
  });
});

describe('ENG-3908 QuicTransport.processData: undecodable frames must not vanish', () => {
  it('surfaces a decode failure to the next receiveProto when no reader is parked', async () => {
    const transport = new QuicTransport('mock:3141');
    const internal = transport as unknown as TransportInternals;

    // Corrupt frame arrives while nothing is parked. Today the error is
    // swallowed and the caller waits forever; it must be observable instead.
    internal.processData(corruptFrame());

    await expect(receiveWithin(transport)).rejects.toThrow(TransportError);

    await transport.close();
  });

  it('still rejects a parked reader on a decode failure [control]', async () => {
    const transport = new QuicTransport('mock:3141');
    const internal = transport as unknown as TransportInternals;

    const pending = receiveWithin(transport);
    internal.processData(corruptFrame());

    await expect(pending).rejects.toThrow(TransportError);

    await transport.close();
  });
});

/**
 * ENG-3918 (RC-3, transport half).
 *
 * `startReading()` (transport.ts:296-329) breaks out of its read loop when the
 * stream reports `done` or throws, but it never latches `_closed`. The
 * transport therefore keeps reporting `isClosed() === false`, so
 * `Connection.isClosed` lies and the pool (whose only liveness predicate is
 * that flag) keeps the dead connection. Worse, a later `receiveProto()` parks a
 * reader on a pump that has already exited and waits forever.
 *
 * Post-fix: an ended or errored read stream latches the transport closed and
 * the failure is sticky - the next `receiveProto()` throws instead of hanging.
 */
type ReadableInternals = {
  _stream: unknown;
  startReading: () => void;
};

/**
 * Classify what `receiveProto()` does: settle with a value, reject with a real
 * transport failure, or hang until the watchdog fires (the ENG-3918 symptom).
 */
async function receiveOutcome(transport: QuicTransport): Promise<'resolved' | 'rejected' | 'hung'> {
  try {
    await receiveWithin(transport, 200);
    return 'resolved';
  } catch (e) {
    return /did not settle/.test((e as Error).message) ? 'hung' : 'rejected';
  }
}

/** Attach a caller-controlled ReadableStream to a QuicTransport's read pump. */
function attachReadable(transport: QuicTransport): ReadableStreamDefaultController<Uint8Array> {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  const internal = transport as unknown as ReadableInternals;
  internal._stream = { readable };
  internal.startReading();

  return controller;
}

describe('ENG-3918 QuicTransport: a dead read stream must be observable', () => {
  // Regression: server closed the stream; the transport still claims to be open.
  it('latches closed when the read stream ends [regression]', async () => {
    const transport = new QuicTransport('mock:3141');
    const controller = attachReadable(transport);

    controller.close();
    await new Promise((r) => setTimeout(r, 20));

    expect(transport.isClosed()).toBe(true);

    await transport.close();
  });

  it('fails the next receiveProto instead of parking a reader forever [regression]', async () => {
    const transport = new QuicTransport('mock:3141');
    const controller = attachReadable(transport);

    controller.close();
    await new Promise((r) => setTimeout(r, 20));

    // Today this parks on a pump that already exited and never settles.
    await expect(receiveOutcome(transport)).resolves.toBe('rejected');

    await transport.close();
  });

  it('latches closed and stays failed after a read-stream error', async () => {
    const transport = new QuicTransport('mock:3141');
    const controller = attachReadable(transport);

    controller.error(new Error('stream reset by peer'));
    await new Promise((r) => setTimeout(r, 20));

    expect(transport.isClosed()).toBe(true);
    await expect(receiveOutcome(transport)).resolves.toBe('rejected');

    await transport.close();
  });
});
