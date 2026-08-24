import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import protobuf from 'protobufjs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ENG-3908 (gRPC half of the bug).
 *
 * `GrpcTransport` loads the proto with `PROTO_LOADER_OPTIONS = { longs: Number, ... }`
 * (src/grpc-transport.ts:40-46). protobuf-loader therefore converts every
 * int64/uint64 to a JS double, which SILENTLY TRUNCATES ids above 2^53
 * (9007199254740993 -> 9007199254740992). Unlike the QUIC path there is no
 * error: the caller just gets the wrong id.
 *
 * Expected contract (same as QUIC, see src/types.ts `GQLId`): ids survive the
 * transport losslessly -- a `number` when safe, a `BigInt` otherwise.
 *
 * The test drives the real transport: it captures the loader options the module
 * actually passes, uses them to deserialize real wire bytes exactly the way
 * @grpc/proto-loader would, feeds the resulting object into the transport's
 * stream, and asserts what the caller finally sees.
 */

const __test_dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__test_dirname, '..', '..', 'proto', 'geode.proto');

const UNSAFE_ID = 9007199254740993n; // 2^53 + 1
const SAFE_ID = 4242n;

// Captured from the module under test: whatever conversion options
// GrpcTransport hands to @grpc/proto-loader.
let capturedLoaderOptions: Record<string, unknown> | undefined;

let latestMockStream: EventEmitter & {
  cancel: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

function createMockStream() {
  const stream = new EventEmitter() as EventEmitter & {
    cancel: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  stream.cancel = vi.fn();
  stream.pause = vi.fn();
  stream.resume = vi.fn();
  stream.destroy = vi.fn();
  latestMockStream = stream;
  return stream;
}

vi.mock('@grpc/grpc-js', () => {
  class MockGeodeService {
    close = vi.fn();
    handshake = vi.fn((_req: unknown, cb: (err: null, res: unknown) => void) => {
      cb(null, {});
      return {} as unknown;
    });
    execute = vi.fn(() => createMockStream());
    ping = vi.fn((_req: unknown, cb: (err: null, res: unknown) => void) => {
      cb(null, {});
      return {} as unknown;
    });
    begin = vi.fn((_req: unknown, cb: (err: null, res: unknown) => void) => {
      cb(null, {});
      return {} as unknown;
    });
    commit = vi.fn((_req: unknown, cb: (err: null, res: unknown) => void) => {
      cb(null, {});
      return {} as unknown;
    });
    rollback = vi.fn((_req: unknown, cb: (err: null, res: unknown) => void) => {
      cb(null, {});
      return {} as unknown;
    });
  }

  return {
    credentials: {
      createInsecure: vi.fn(() => 'insecure-creds'),
      createSsl: vi.fn(() => 'ssl-creds'),
    },
    loadPackageDefinition: vi.fn(() => ({
      geode: { GeodeService: MockGeodeService },
    })),
  };
});

vi.mock('@grpc/proto-loader', () => ({
  // Record the conversion options the transport asks for; the package
  // definition itself is unused because grpc-js is mocked.
  load: vi.fn((_protoPath: string, options: Record<string, unknown>) => {
    capturedLoaderOptions = options;
    return Promise.resolve({});
  }),
}));

import { GrpcTransport } from '../../src/grpc-transport.js';
import { rowToRecord } from '../../src/proto.js';
import type { GeodeConfig } from '../../src/config.js';

const root = protobuf.loadSync(PROTO_PATH);
const ExecutionResponseType = root.lookupType('geode.ExecutionResponse');

/**
 * Produce the JS object @grpc/proto-loader would hand to the stream's 'data'
 * listener for the given ExecutionResponse, using the conversion options the
 * transport itself configured.
 */
function deserializeAsGrpcWould(message: object): unknown {
  const bytes = ExecutionResponseType.encode(ExecutionResponseType.create(message)).finish();
  const opts = capturedLoaderOptions ?? {};
  return ExecutionResponseType.toObject(ExecutionResponseType.decode(bytes), {
    longs: opts['longs'] as never,
    enums: opts['enums'] as never,
    bytes: opts['bytes'] as never,
    defaults: opts['defaults'] as boolean | undefined,
    oneofs: opts['oneofs'] as boolean | undefined,
  });
}

function finalPageResponse(id: bigint): object {
  return {
    status: { statusClass: '00000', statusSubclass: '000' },
    page: {
      rows: [{ values: [{ intVal: { value: id.toString(), kind: 3 } }] }],
      final: true,
      ordered: false,
      orderKeys: [],
    },
  };
}

function nodePageResponse(id: bigint): object {
  return {
    status: { statusClass: '00000', statusSubclass: '000' },
    page: {
      rows: [{ values: [{ nodeVal: { id: id.toString(), labels: ['Person'], properties: [] } }] }],
      final: true,
      ordered: false,
      orderKeys: [],
    },
  };
}

const cfg: GeodeConfig = {
  host: 'localhost',
  port: 3141,
  tls: false,
  transport: 'grpc',
};

describe('ENG-3908 gRPC int64 fidelity', () => {
  let transport: Awaited<ReturnType<typeof GrpcTransport.connect>>;
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    capturedLoaderOptions = undefined;
    transport = await GrpcTransport.connect(cfg);
  });

  afterEach(async () => {
    await transport.close();
    if (originalNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = originalNodeEnv;
    }
    vi.clearAllMocks();
  });

  it('delivers a safe int64 id unchanged [control]', async () => {
    const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN id(n)' } });
    latestMockStream.emit('data', deserializeAsGrpcWould(finalPageResponse(SAFE_ID)));
    await sendPromise;

    const msg = await transport.receiveProto();
    const row = msg.execute?.page?.rows?.[0];
    expect(row).toBeDefined();
    const record = rowToRecord(row!, [{ name: 'id', type: 'BIGINT' }]);
    expect(record['id']).toBe(4242);
  });

  // Regression: ENG-3908 -- `longs: Number` truncated 9007199254740993 to
  // 9007199254740992 with no error, so the caller silently got the wrong id.
  it('delivers an int64 id above 2^53 without truncation [regression]', async () => {
    const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN id(n)' } });
    latestMockStream.emit('data', deserializeAsGrpcWould(finalPageResponse(UNSAFE_ID)));
    await sendPromise;

    const msg = await transport.receiveProto();
    const row = msg.execute?.page?.rows?.[0];
    expect(row).toBeDefined();
    const record = rowToRecord(row!, [{ name: 'id', type: 'BIGINT' }]);
    expect(record['id']).toBe(9007199254740993n);
  });

  // Regression: ENG-3908 -- same truncation on NodeValue.id (uint64).
  it('delivers a node id above 2^53 without truncation [regression]', async () => {
    const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN n' } });
    latestMockStream.emit('data', deserializeAsGrpcWould(nodePageResponse(UNSAFE_ID)));
    await sendPromise;

    const msg = await transport.receiveProto();
    const row = msg.execute?.page?.rows?.[0];
    expect(row).toBeDefined();
    const record = rowToRecord(row!, [{ name: 'n', type: 'NODE' }]);
    const node = record['n'] as { id: bigint; labels: string[] };
    expect(node.id).toBe(9007199254740993n);
  });

  it('does not lose precision on int64 max over gRPC [boundary]', async () => {
    const sendPromise = transport.sendProto({ execute: { query: 'RETURN 9223372036854775807' } });
    latestMockStream.emit('data', deserializeAsGrpcWould(finalPageResponse(9223372036854775807n)));
    await sendPromise;

    const msg = await transport.receiveProto();
    const row = msg.execute?.page?.rows?.[0];
    const record = rowToRecord(row!, [{ name: 'v', type: 'BIGINT' }]);
    expect(record['v']).toBe(9223372036854775807n);
  });
});
