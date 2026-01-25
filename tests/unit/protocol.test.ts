import { describe, it, expect } from 'vitest';
import {
  parseFrame,
  isErrorFrame,
  isSchemaFrame,
  isBindingsFrame,
  isFinalFrame,
  frameToError,
  getColumnsFromSchema,
  buildHelloMessage,
  buildRunGQLMessage,
  buildPullMessage,
  buildBeginMessage,
  buildCommitMessage,
  buildRollbackMessage,
  buildSavepointMessage,
  buildRollbackToMessage,
  buildPingMessage,
  serializeMessage,
  rewritePlaceholders,
  countPlaceholders,
  mergeParams,
  MsgType,
  RespType,
} from '../../src/protocol.js';
import { TransportError, StatusClass } from '../../src/errors.js';

describe('protocol', () => {
  describe('parseFrame', () => {
    it('should parse valid JSON frame', () => {
      const json = JSON.stringify({
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: 'SCHEMA',
          columns: [{ name: 'n', type: 'NODE' }],
        },
      });

      const frame = parseFrame(json);

      expect(frame.status_class).toBe('00000');
      expect(frame.status_subclass).toBe('000');
      expect(frame.result.type).toBe('SCHEMA');
      expect(frame.result.columns).toHaveLength(1);
    });

    it('should parse Buffer input', () => {
      const json = JSON.stringify({
        status_class: '00000',
        status_subclass: '000',
        result: { type: 'STATUS' },
      });

      const frame = parseFrame(Buffer.from(json));

      expect(frame.result.type).toBe('STATUS');
    });

    it('should throw TransportError for invalid JSON', () => {
      expect(() => parseFrame('not json')).toThrow(TransportError);
    });

    it('should throw TransportError for missing result.type', () => {
      const json = JSON.stringify({
        status_class: '00000',
        result: {},
      });

      expect(() => parseFrame(json)).toThrow(TransportError);
    });
  });

  describe('frame type checks', () => {
    const schemaFrame = {
      status_class: '00000',
      status_subclass: '000',
      result: { type: RespType.SCHEMA, columns: [] },
    };

    const errorFrame = {
      status_class: '42000',
      status_subclass: '001',
      result: { type: RespType.ERROR, code: 'SyntaxError', message: 'Invalid' },
    };

    const bindingsFrame = {
      status_class: '00000',
      status_subclass: '000',
      result: { type: RespType.BINDINGS, rows: [], final: false },
    };

    const finalBindingsFrame = {
      status_class: '00000',
      status_subclass: '000',
      result: { type: RespType.BINDINGS, rows: [], final: true },
    };

    it('isErrorFrame should identify error frames', () => {
      expect(isErrorFrame(errorFrame)).toBe(true);
      expect(isErrorFrame(schemaFrame)).toBe(false);
    });

    it('isSchemaFrame should identify schema frames', () => {
      expect(isSchemaFrame(schemaFrame)).toBe(true);
      expect(isSchemaFrame(errorFrame)).toBe(false);
    });

    it('isBindingsFrame should identify bindings frames', () => {
      expect(isBindingsFrame(bindingsFrame)).toBe(true);
      expect(isBindingsFrame(schemaFrame)).toBe(false);
    });

    it('isFinalFrame should identify final frames', () => {
      expect(isFinalFrame(finalBindingsFrame)).toBe(true);
      expect(isFinalFrame(bindingsFrame)).toBe(false);
    });
  });

  describe('frameToError', () => {
    it('should convert error frame to DriverError', () => {
      const frame = {
        status_class: '42000',
        status_subclass: '001',
        result: {
          type: RespType.ERROR,
          code: 'SyntaxError',
          message: 'Invalid syntax at line 1',
          anchor: 'line 1, col 5',
          additional: [{ message: 'hint: check parentheses' }],
          flagger_findings: ['warning: deprecated'],
        },
      };

      const err = frameToError(frame);

      expect(err.statusClass).toBe('42000');
      expect(err.subclass).toBe('001');
      expect(err.code).toBe('SyntaxError');
      expect(err.message).toContain('Invalid syntax');
      expect(err.anchor).toBe('line 1, col 5');
      expect(err.additional).toContain('hint: check parentheses');
      expect(err.findings).toContain('warning: deprecated');
    });

    it('should handle missing optional fields', () => {
      const frame = {
        status_class: '58000',
        status_subclass: '000',
        result: {
          type: RespType.ERROR,
          code: 'InternalError',
          message: 'Something went wrong',
        },
      };

      const err = frameToError(frame);

      expect(err.code).toBe('InternalError');
      expect(err.anchor).toBeUndefined();
      expect(err.additional).toEqual([]);
      expect(err.findings).toEqual([]);
    });
  });

  describe('getColumnsFromSchema', () => {
    it('should extract column info from schema frame', () => {
      const frame = {
        status_class: '00000',
        status_subclass: '000',
        result: {
          type: RespType.SCHEMA,
          columns: [
            { name: 'id', type: 'INT' },
            { name: 'name', type: 'STRING' },
            { name: 'active', type: 'BOOL' },
          ],
        },
      };

      const columns = getColumnsFromSchema(frame);

      expect(columns).toHaveLength(3);
      expect(columns[0]).toEqual({ name: 'id', type: 'INT', kind: 'INT' });
      expect(columns[1]).toEqual({ name: 'name', type: 'STRING', kind: 'STRING' });
      expect(columns[2]).toEqual({ name: 'active', type: 'BOOL', kind: 'BOOL' });
    });

    it('should throw for non-schema frames', () => {
      const frame = {
        status_class: '00000',
        status_subclass: '000',
        result: { type: RespType.BINDINGS, rows: [] },
      };

      expect(() => getColumnsFromSchema(frame)).toThrow();
    });
  });

  describe('message builders', () => {
    describe('buildHelloMessage', () => {
      it('should build basic HELLO message', () => {
        const config = {
          host: 'localhost',
          port: 3141,
          pageSize: 1000,
          helloName: 'test-client',
          helloVersion: '1.0.0',
          conformance: 'min',
        };

        const msg = buildHelloMessage(config);

        expect(msg['type']).toBe(MsgType.HELLO);
        expect(msg['client_name']).toBe('test-client');
        expect(msg['client_ver']).toBe('1.0.0');
        expect(msg['wanted_conformance']).toBe('min');
        expect(msg['username']).toBeUndefined();
        expect(msg['password']).toBeUndefined();
      });

      it('should include credentials when provided', () => {
        const config = {
          host: 'localhost',
          port: 3141,
          pageSize: 1000,
          helloName: 'test-client',
          helloVersion: '1.0.0',
          conformance: 'min',
          username: 'admin',
          password: 'secret',
        };

        const msg = buildHelloMessage(config);

        expect(msg['username']).toBe('admin');
        expect(msg['password']).toBe('secret');
      });
    });

    describe('buildRunGQLMessage', () => {
      it('should build query message without params', () => {
        const msg = buildRunGQLMessage('MATCH (n) RETURN n');

        expect(msg['type']).toBe(MsgType.RUN_GQL);
        expect(msg['text']).toBe('MATCH (n) RETURN n');
        expect(msg['params']).toBeUndefined();
      });

      it('should build query message with params', () => {
        const msg = buildRunGQLMessage('MATCH (n) WHERE n.id = $id RETURN n', { id: 123 });

        expect(msg['type']).toBe(MsgType.RUN_GQL);
        expect(msg['text']).toBe('MATCH (n) WHERE n.id = $id RETURN n');
        expect(msg['params']).toEqual({ id: 123 });
      });

      it('should omit empty params', () => {
        const msg = buildRunGQLMessage('MATCH (n) RETURN n', {});

        expect(msg['params']).toBeUndefined();
      });
    });

    describe('buildPullMessage', () => {
      it('should build PULL message', () => {
        const msg = buildPullMessage(1, 1000);

        expect(msg['type']).toBe(MsgType.PULL);
        expect(msg['request_id']).toBe(1);
        expect(msg['page_size']).toBe(1000);
      });
    });

    describe('transaction messages', () => {
      it('should build BEGIN message', () => {
        const msg = buildBeginMessage();
        expect(msg['type']).toBe(MsgType.BEGIN);
      });

      it('should build COMMIT message', () => {
        const msg = buildCommitMessage();
        expect(msg['type']).toBe(MsgType.COMMIT);
      });

      it('should build ROLLBACK message', () => {
        const msg = buildRollbackMessage();
        expect(msg['type']).toBe(MsgType.ROLLBACK);
      });

      it('should build SAVEPOINT message', () => {
        const msg = buildSavepointMessage('sp1');
        expect(msg['type']).toBe(MsgType.SAVEPOINT);
        expect(msg['name']).toBe('sp1');
      });

      it('should build ROLLBACK_TO message', () => {
        const msg = buildRollbackToMessage('sp1');
        expect(msg['type']).toBe(MsgType.ROLLBACK_TO);
        expect(msg['name']).toBe('sp1');
      });
    });

    describe('buildPingMessage', () => {
      it('should build PING message', () => {
        const msg = buildPingMessage();
        expect(msg['type']).toBe(MsgType.PING);
      });
    });
  });

  describe('serializeMessage', () => {
    it('should serialize message to JSON line', () => {
      const msg = { type: 'PING' };
      const buf = serializeMessage(msg);

      expect(buf.toString('utf-8')).toBe('{"type":"PING"}\n');
    });
  });

  describe('rewritePlaceholders', () => {
    it('should rewrite ? to $pN', () => {
      const result = rewritePlaceholders('MATCH (n) WHERE n.id = ? AND n.name = ?', [123, 'test']);

      expect(result.query).toBe('MATCH (n) WHERE n.id = $p1 AND n.name = $p2');
      expect(result.params).toEqual({ p1: 123, p2: 'test' });
    });

    it('should handle no placeholders', () => {
      const result = rewritePlaceholders('MATCH (n) RETURN n', []);

      expect(result.query).toBe('MATCH (n) RETURN n');
      expect(result.params).toEqual({});
    });

    it('should skip placeholders in string literals', () => {
      const result = rewritePlaceholders("MATCH (n) WHERE n.name = '?' RETURN n", []);

      expect(result.query).toBe("MATCH (n) WHERE n.name = '?' RETURN n");
      expect(result.params).toEqual({});
    });

    it('should handle escaped quotes in strings', () => {
      const result = rewritePlaceholders("MATCH (n) WHERE n.name = 'it\\'s ?' RETURN n", []);

      expect(result.query).toBe("MATCH (n) WHERE n.name = 'it\\'s ?' RETURN n");
    });
  });

  describe('countPlaceholders', () => {
    it('should count ? placeholders', () => {
      expect(countPlaceholders('MATCH (n) WHERE n.id = ? AND n.name = ?')).toBe(2);
      expect(countPlaceholders('MATCH (n) RETURN n')).toBe(0);
      expect(countPlaceholders('? ? ?')).toBe(3);
    });

    it('should not count ? in string literals', () => {
      expect(countPlaceholders("MATCH (n) WHERE n.name = '?' RETURN n")).toBe(0);
      expect(countPlaceholders("'?' AND ?")).toBe(1);
    });
  });

  describe('mergeParams', () => {
    it('should merge parameters', () => {
      const result = mergeParams({ p1: 1 }, { name: 'test' });
      expect(result).toEqual({ p1: 1, name: 'test' });
    });

    it('should handle empty named params', () => {
      const result = mergeParams({ p1: 1 });
      expect(result).toEqual({ p1: 1 });
    });

    it('should override with named params', () => {
      const result = mergeParams({ p1: 1 }, { p1: 2 });
      expect(result).toEqual({ p1: 2 });
    });
  });
});
