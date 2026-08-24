/**
 * Wire-compatibility tests for the protoc + ts-proto generated bindings.
 *
 * These assert that the new generated encode/decode produces wire bytes that
 * are byte-identical to the legacy protobufjs codec loading the same vendored
 * proto. This is the safety net guaranteeing the migration introduces no
 * protocol drift on the wire.
 */
import { describe, it, expect } from 'vitest';
import protobuf from 'protobufjs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeQuicClientMessage,
  decodeQuicServerMessage,
  buildHelloRequest,
  buildExecuteRequest,
  buildPullRequest,
  buildPingRequest,
  buildBeginRequest,
  buildCommitRequest,
  buildRollbackRequest,
  buildSavepointRequest,
  buildRollbackToRequest,
  type QuicClientMessage,
  type QuicServerMessage,
} from '../../src/proto.js';

const __test_dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__test_dirname, '..', '..', 'proto', 'geode.proto');

const root = protobuf.loadSync(PROTO_PATH);
const ClientType = root.lookupType('geode.QuicClientMessage');
const ServerType = root.lookupType('geode.QuicServerMessage');

/**
 * protobufjs accepts number | Long | decimal string for 64-bit fields, but not
 * the bigints the generated bindings use (ts-proto `forceLong=bigint`). Render
 * bigints as decimal strings so the legacy codec sees the same values; the
 * encoded bytes are unaffected by the representation.
 */
function toLegacyRepr<T>(value: T): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(toLegacyRepr);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toLegacyRepr(v)]));
  }
  return value;
}

/** Encode a client message via the legacy protobufjs codec. */
function legacyEncodeClient(msg: QuicClientMessage): Buffer {
  // fromObject() turns the decimal strings into protobufjs' own 64-bit
  // representation (Long), which verify() accepts.
  const legacyMsg = ClientType.fromObject(toLegacyRepr(msg) as Record<string, unknown>);
  const err = ClientType.verify(legacyMsg);
  if (err) throw new Error(`legacy verify failed: ${err}`);
  return Buffer.from(ClientType.encode(legacyMsg).finish());
}

/** Encode a server message via the legacy protobufjs codec (length-prefixed body only). */
function legacyEncodeServer(msg: QuicServerMessage): Buffer {
  return Buffer.from(ServerType.encode(ServerType.create(msg)).finish());
}

describe('proto wire compatibility (ts-proto vs protobufjs)', () => {
  const cases: Array<[string, QuicClientMessage]> = [
    ['HelloRequest minimal', buildHelloRequest('u', 'p', 'cn', 'cv', 'min')],
    [
      'HelloRequest with tenant+graph+role',
      buildHelloRequest('u', 'p', 'cn', 'cv', 'min', 'acme', 'g', 'analyst'),
    ],
    [
      'ExecuteRequest with params',
      buildExecuteRequest('sess-1', 'MATCH (n) RETURN n', {
        limit: 10,
        name: 'alice',
        active: true,
        ratio: 3.14,
        tags: ['a', 'b'],
        meta: { k: 'v' },
      }),
    ],
    ['PullRequest', buildPullRequest(7, 100, 'sess-1')],
    ['PingRequest', buildPingRequest()],
    ['BeginRequest', buildBeginRequest(true, 'sess-1')],
    ['CommitRequest', buildCommitRequest('sess-1')],
    ['RollbackRequest', buildRollbackRequest('sess-1')],
    ['SavepointRequest', buildSavepointRequest('sp1', 'sess-1')],
    ['RollbackToRequest', buildRollbackToRequest('sp1', 'sess-1')],
  ];

  for (const [name, msg] of cases) {
    it(`encodes ${name} byte-identically to protobufjs`, () => {
      const generated = encodeQuicClientMessage(msg);
      const legacy = legacyEncodeClient(msg);
      expect(Buffer.compare(generated, legacy)).toBe(0);
    });
  }

  it('decodes a protobufjs-encoded HelloResponse identically', () => {
    const server: QuicServerMessage = {
      hello: {
        success: true,
        sessionId: 'sess-xyz',
        errorMessage: '',
        capabilities: ['gql', 'transactions'],
        passwordResetRequired: false,
      },
    };
    const wire = legacyEncodeServer(server);
    const decoded = decodeQuicServerMessage(wire);
    expect(decoded.hello?.success).toBe(true);
    expect(decoded.hello?.sessionId).toBe('sess-xyz');
    expect(decoded.hello?.capabilities).toEqual(['gql', 'transactions']);
  });

  it('decodes a protobufjs-encoded ExecutionResponse with a data page', () => {
    const server: QuicServerMessage = {
      execute: {
        status: {
          statusClass: '00000',
          statusSubclass: '',
          additionalStatuses: [],
          flaggerFindings: [],
        },
        page: {
          rows: [{ values: [{ stringVal: { value: 'hi', kind: 1 } }] }],
          final: true,
          ordered: false,
          orderKeys: [],
        },
      },
    };
    const wire = legacyEncodeServer(server);
    const decoded = decodeQuicServerMessage(wire);
    expect(decoded.execute?.page?.final).toBe(true);
    expect(decoded.execute?.page?.rows[0]?.values[0]?.stringVal?.value).toBe('hi');
  });

  it('decodes a protobufjs-encoded PingResponse', () => {
    const wire = legacyEncodeServer({ ping: { ok: true } });
    const decoded = decodeQuicServerMessage(wire);
    expect(decoded.ping?.ok).toBe(true);
  });

  it('round-trips client encode -> protobufjs decode for the backup oneof (canonical fields)', () => {
    // Backup messages carry session_id / payload fields pulled in from canonical.
    const msg: QuicClientMessage = {
      uploadBackup: {
        sizeBytes: 3n,
        checksum: 'abc',
        sessionId: 'sess-1',
        payload: new Uint8Array([1, 2, 3]),
      },
    } as QuicClientMessage;
    const generated = encodeQuicClientMessage(msg);
    const decoded = ClientType.decode(generated) as unknown as {
      uploadBackup: { sessionId: string; payload: Uint8Array };
    };
    expect(decoded.uploadBackup.sessionId).toBe('sess-1');
    expect(Buffer.from(decoded.uploadBackup.payload)).toEqual(Buffer.from([1, 2, 3]));
  });
});
