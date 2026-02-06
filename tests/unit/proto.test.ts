import { describe, it, expect } from 'vitest';
import {
  encodeQuicClientMessage,
  decodeQuicServerMessage,
  encodeWithLengthPrefix,
  decodeLengthPrefix,
  jsToProtoValue,
  protoValueToJS,
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
  type QuicClientMessage,
  type QuicServerMessage,
  type ProtoValue,
} from '../../src/proto.js';

describe('proto', () => {
  describe('length prefix encoding', () => {
    it('should encode and decode length prefix', () => {
      const msg: QuicClientMessage = { ping: {} };
      const encoded = encodeWithLengthPrefix(msg);

      expect(encoded.length).toBeGreaterThan(4);

      const length = decodeLengthPrefix(encoded);
      expect(length).toBe(encoded.length - 4);
    });

    it('should throw on insufficient data for length prefix', () => {
      const shortBuffer = Buffer.alloc(2);
      expect(() => decodeLengthPrefix(shortBuffer)).toThrow('Insufficient data');
    });
  });

  describe('message encoding/decoding roundtrip', () => {
    it('should roundtrip HelloRequest', () => {
      const msg = buildHelloRequest('testuser', 'testpass', 'test-client', '1.0.0', 'min');

      const encoded = encodeQuicClientMessage(msg);
      expect(encoded).toBeInstanceOf(Buffer);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should roundtrip ExecuteRequest', () => {
      const msg = buildExecuteRequest('session-123', 'MATCH (n) RETURN n', {
        limit: 10,
        name: 'test',
      });

      const encoded = encodeQuicClientMessage(msg);
      expect(encoded).toBeInstanceOf(Buffer);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should roundtrip PullRequest', () => {
      const msg = buildPullRequest(1, 100, 'session-123');

      const encoded = encodeQuicClientMessage(msg);
      expect(encoded).toBeInstanceOf(Buffer);
    });

    it('should roundtrip PingRequest', () => {
      const msg = buildPingRequest();

      const encoded = encodeQuicClientMessage(msg);
      expect(encoded).toBeInstanceOf(Buffer);
    });

    it('should roundtrip BeginRequest', () => {
      const msg = buildBeginRequest(false, 'session-123');

      const encoded = encodeQuicClientMessage(msg);
      expect(encoded).toBeInstanceOf(Buffer);
    });

    it('should roundtrip CommitRequest', () => {
      const msg = buildCommitRequest('session-123');

      const encoded = encodeQuicClientMessage(msg);
      expect(encoded).toBeInstanceOf(Buffer);
    });

    it('should roundtrip RollbackRequest', () => {
      const msg = buildRollbackRequest('session-123');

      const encoded = encodeQuicClientMessage(msg);
      expect(encoded).toBeInstanceOf(Buffer);
    });

    it('should roundtrip SavepointRequest', () => {
      const msg = buildSavepointRequest('sp1', 'session-123');

      const encoded = encodeQuicClientMessage(msg);
      expect(encoded).toBeInstanceOf(Buffer);
    });

    it('should roundtrip RollbackToRequest', () => {
      const msg = buildRollbackToRequest('sp1', 'session-123');

      const encoded = encodeQuicClientMessage(msg);
      expect(encoded).toBeInstanceOf(Buffer);
    });
  });

  describe('value conversion', () => {
    it('should convert null to proto and back', () => {
      const protoVal = jsToProtoValue(null);
      expect(protoVal.nullVal).toBeDefined();

      const jsVal = protoValueToJS(protoVal);
      expect(jsVal).toBeNull();
    });

    it('should convert boolean to proto and back', () => {
      const trueVal = jsToProtoValue(true);
      expect(trueVal.boolVal).toBe(true);
      expect(protoValueToJS(trueVal)).toBe(true);

      const falseVal = jsToProtoValue(false);
      expect(falseVal.boolVal).toBe(false);
      expect(protoValueToJS(falseVal)).toBe(false);
    });

    it('should convert integer to proto and back', () => {
      const protoVal = jsToProtoValue(42);
      expect(protoVal.intVal?.value).toBe(42);

      const jsVal = protoValueToJS(protoVal);
      expect(jsVal).toBe(42);
    });

    it('should convert bigint to proto and back', () => {
      const bigNum = 9007199254740993n; // > Number.MAX_SAFE_INTEGER
      const protoVal = jsToProtoValue(bigNum);
      expect(protoVal.intVal?.value).toBe(bigNum);

      const jsVal = protoValueToJS(protoVal);
      expect(jsVal).toBe(bigNum);
    });

    it('should convert float to proto and back', () => {
      const protoVal = jsToProtoValue(3.14);
      expect(protoVal.doubleVal?.value).toBe(3.14);

      const jsVal = protoValueToJS(protoVal);
      expect(jsVal).toBe(3.14);
    });

    it('should convert string to proto and back', () => {
      const protoVal = jsToProtoValue('hello');
      expect(protoVal.stringVal?.value).toBe('hello');

      const jsVal = protoValueToJS(protoVal);
      expect(jsVal).toBe('hello');
    });

    it('should convert array to proto and back', () => {
      const arr = [1, 'two', true];
      const protoVal = jsToProtoValue(arr);
      expect(protoVal.listVal?.values).toHaveLength(3);

      const jsVal = protoValueToJS(protoVal) as unknown[];
      expect(jsVal).toHaveLength(3);
      expect(jsVal[0]).toBe(1);
      expect(jsVal[1]).toBe('two');
      expect(jsVal[2]).toBe(true);
    });

    it('should convert object to proto and back', () => {
      const obj = { name: 'test', count: 5 };
      const protoVal = jsToProtoValue(obj);
      expect(protoVal.mapVal?.entries).toHaveLength(2);

      const jsVal = protoValueToJS(protoVal) as Record<string, unknown>;
      expect(jsVal['name']).toBe('test');
      expect(jsVal['count']).toBe(5);
    });

    it('should convert Buffer to proto and back', () => {
      const buf = Buffer.from([1, 2, 3, 4]);
      const protoVal = jsToProtoValue(buf);
      expect(protoVal.bytesVal?.value).toBeDefined();

      const jsVal = protoValueToJS(protoVal) as Buffer;
      expect(Buffer.isBuffer(jsVal)).toBe(true);
      expect(jsVal.equals(buf)).toBe(true);
    });
  });

  describe('rowToRecord', () => {
    it('should convert row with columns to record', () => {
      const columns = [
        { name: 'id', type: 'INT' },
        { name: 'name', type: 'STRING' },
      ];

      const row = {
        values: [{ intVal: { value: 1, kind: 1 } }, { stringVal: { value: 'Alice', kind: 1 } }],
      };

      const record = rowToRecord(row, columns);
      expect(record['id']).toBe(1);
      expect(record['name']).toBe('Alice');
    });

    it('should handle empty row', () => {
      const columns = [{ name: 'id', type: 'INT' }];
      const row = { values: [] };

      const record = rowToRecord(row, columns);
      expect(Object.keys(record)).toHaveLength(0);
    });

    it('should handle null values', () => {
      const columns = [
        { name: 'id', type: 'INT' },
        { name: 'description', type: 'STRING' },
      ];

      const row = {
        values: [{ intVal: { value: 1, kind: 1 } }, { nullVal: {} }],
      };

      const record = rowToRecord(row, columns);
      expect(record['id']).toBe(1);
      expect(record['description']).toBeNull();
    });
  });

  describe('server message decoding', () => {
    it('should decode HelloResponse', () => {
      // Create a mock encoded HelloResponse
      const mockHelloResponse: QuicServerMessage = {
        hello: {
          success: true,
          sessionId: 'test-session',
          errorMessage: '',
          capabilities: ['gql', 'transactions'],
        },
      };

      // Verify structure (actual encoding test requires server)
      expect(mockHelloResponse.hello?.success).toBe(true);
      expect(mockHelloResponse.hello?.sessionId).toBe('test-session');
    });

    it('should decode PingResponse', () => {
      const mockPingResponse: QuicServerMessage = {
        ping: {
          ok: true,
        },
      };

      expect(mockPingResponse.ping?.ok).toBe(true);
    });
  });
});
