import { describe, it, expect } from 'vitest';
import {
  DriverError,
  TransportError,
  ConfigError,
  SecurityError,
  StateError,
  StatusClass,
  isDriverError,
  isGeodeError,
  isRetryableError,
  ErrClosed,
  ErrQueryInProgress,
  ErrTxInProgress,
} from '../../src/errors.js';

describe('errors', () => {
  describe('DriverError', () => {
    it('should create error with all fields', () => {
      const err = new DriverError({
        statusClass: StatusClass.SYNTAX,
        subclass: '001',
        code: 'SyntaxError',
        message: 'Invalid syntax',
        anchor: 'line 1, col 5',
        additional: ['hint: check parentheses'],
        findings: ['warning: deprecated syntax'],
      });

      expect(err.statusClass).toBe(StatusClass.SYNTAX);
      expect(err.subclass).toBe('001');
      expect(err.code).toBe('SyntaxError');
      expect(err.message).toContain('SyntaxError');
      expect(err.message).toContain('Invalid syntax');
      expect(err.anchor).toBe('line 1, col 5');
      expect(err.additional).toEqual(['hint: check parentheses']);
      expect(err.findings).toEqual(['warning: deprecated syntax']);
      expect(err.name).toBe('DriverError');
    });

    it('should format error message correctly', () => {
      const err = new DriverError({
        statusClass: StatusClass.SYNTAX,
        subclass: '001',
        code: 'SyntaxError',
        message: 'Invalid syntax',
      });

      expect(err.message).toBe('geode: SyntaxError: Invalid syntax');
    });

    it('should handle missing message', () => {
      const err = new DriverError({
        statusClass: StatusClass.SYNTAX,
        subclass: '001',
        code: 'SyntaxError',
        message: '',
      });

      expect(err.message).toBe('geode: SyntaxError');
    });

    it('should identify retryable errors', () => {
      const serializationErr = new DriverError({
        statusClass: StatusClass.SERIALIZATION,
        subclass: '001',
        code: 'SerializationError',
        message: 'Serialization failure',
      });

      const deadlockErr = new DriverError({
        statusClass: StatusClass.DEADLOCK,
        subclass: '001',
        code: 'DeadlockError',
        message: 'Deadlock detected',
      });

      const syntaxErr = new DriverError({
        statusClass: StatusClass.SYNTAX,
        subclass: '001',
        code: 'SyntaxError',
        message: 'Invalid syntax',
      });

      expect(serializationErr.isRetryable).toBe(true);
      expect(deadlockErr.isRetryable).toBe(true);
      expect(syntaxErr.isRetryable).toBe(false);
    });
  });

  describe('TransportError', () => {
    it('should create error with all fields', () => {
      const cause = new Error('Connection refused');
      const err = new TransportError({
        operation: 'connect',
        address: 'localhost:3141',
        cause,
      });

      expect(err.operation).toBe('connect');
      expect(err.address).toBe('localhost:3141');
      expect(err.cause).toBe(cause);
      expect(err.statusClass).toBe(StatusClass.SYSTEM);
      expect(err.isRetryable).toBe(true);
      expect(err.name).toBe('TransportError');
    });

    it('should format error message with address', () => {
      const err = new TransportError({
        operation: 'connect',
        address: 'localhost:3141',
        cause: new Error('Connection refused'),
      });

      expect(err.message).toBe('geode: transport connect to localhost:3141: Connection refused');
    });

    it('should format error message without address', () => {
      const err = new TransportError({
        operation: 'parse',
        cause: new Error('Invalid JSON'),
      });

      expect(err.message).toBe('geode: transport parse: Invalid JSON');
    });
  });

  describe('ConfigError', () => {
    it('should create error with all fields', () => {
      const err = new ConfigError({
        field: 'port',
        value: 'abc',
        message: 'must be a number',
      });

      expect(err.field).toBe('port');
      expect(err.value).toBe('abc');
      expect(err.statusClass).toBe(StatusClass.INVALID_PARAM);
      expect(err.isRetryable).toBe(false);
      expect(err.name).toBe('ConfigError');
    });

    it('should format error message with value', () => {
      const err = new ConfigError({
        field: 'port',
        value: 'abc',
        message: 'must be a number',
      });

      expect(err.message).toBe('geode: config port="abc": must be a number');
    });

    it('should format error message without value', () => {
      const err = new ConfigError({
        field: 'host',
        message: 'is required',
      });

      expect(err.message).toBe('geode: config host: is required');
    });

    // Security tests for sensitive field redaction
    it('should redact password values from error message', () => {
      const err = new ConfigError({
        field: 'password',
        value: 'supersecret123',
        message: 'too short',
      });

      // Password value should not appear in the error message
      expect(err.message).toBe('geode: config password: too short');
      expect(err.message).not.toContain('supersecret123');
      // Value should not be stored on the error object either
      expect(err.value).toBeUndefined();
    });

    it('should redact secret values from error message', () => {
      const err = new ConfigError({
        field: 'secret',
        value: 'api-key-12345',
        message: 'invalid format',
      });

      expect(err.message).not.toContain('api-key-12345');
      expect(err.value).toBeUndefined();
    });

    it('should redact token values from error message', () => {
      const err = new ConfigError({
        field: 'token',
        value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        message: 'expired',
      });

      expect(err.message).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(err.value).toBeUndefined();
    });

    it('should redact key values from error message', () => {
      const err = new ConfigError({
        field: 'key',
        value: '/path/to/private.key',
        message: 'file not found',
      });

      expect(err.message).not.toContain('/path/to/private.key');
      expect(err.value).toBeUndefined();
    });

    it('should redact credential values from error message', () => {
      const err = new ConfigError({
        field: 'credential',
        value: 'admin:password',
        message: 'invalid',
      });

      expect(err.message).not.toContain('admin:password');
      expect(err.value).toBeUndefined();
    });

    it('should not redact non-sensitive fields', () => {
      const err = new ConfigError({
        field: 'host',
        value: 'localhost',
        message: 'unreachable',
      });

      // Non-sensitive fields should still include the value
      expect(err.message).toBe('geode: config host="localhost": unreachable');
      expect(err.value).toBe('localhost');
    });
  });

  describe('SecurityError', () => {
    it('should create error with all fields', () => {
      const cause = new Error('Certificate expired');
      const err = new SecurityError({
        type: 'tls',
        message: 'TLS handshake failed',
        cause,
      });

      expect(err.type).toBe('tls');
      expect(err.cause).toBe(cause);
      expect(err.statusClass).toBe(StatusClass.AUTH);
      expect(err.isRetryable).toBe(false);
      expect(err.name).toBe('SecurityError');
    });

    it('should format error message with cause', () => {
      const err = new SecurityError({
        type: 'tls',
        message: 'TLS handshake failed',
        cause: new Error('Certificate expired'),
      });

      expect(err.message).toBe('geode: security tls: TLS handshake failed: Certificate expired');
    });

    it('should format error message without cause', () => {
      const err = new SecurityError({
        type: 'input',
        message: 'Query contains null bytes',
      });

      expect(err.message).toBe('geode: security input: Query contains null bytes');
    });
  });

  describe('StateError', () => {
    it('should create error with all fields', () => {
      const err = new StateError({
        currentState: 'fetching',
        operation: 'query',
        message: 'cannot start new query',
      });

      expect(err.currentState).toBe('fetching');
      expect(err.operation).toBe('query');
      expect(err.statusClass).toBe(StatusClass.TRANSACTION_STATE);
      expect(err.isRetryable).toBe(false);
      expect(err.name).toBe('StateError');
    });

    it('should format error message with additional info', () => {
      const err = new StateError({
        currentState: 'fetching',
        operation: 'query',
        message: 'cannot start new query',
      });

      expect(err.message).toBe(
        'geode: state error: query (state=fetching): cannot start new query'
      );
    });

    it('should format error message without additional info', () => {
      const err = new StateError({
        currentState: 'closed',
        operation: 'query',
      });

      expect(err.message).toBe('geode: state error: query (state=closed)');
    });
  });

  describe('type guards', () => {
    it('isDriverError should identify DriverError', () => {
      const driverErr = new DriverError({
        statusClass: StatusClass.SYNTAX,
        subclass: '001',
        code: 'SyntaxError',
        message: 'test',
      });

      const transportErr = new TransportError({
        operation: 'connect',
      });

      expect(isDriverError(driverErr)).toBe(true);
      expect(isDriverError(transportErr)).toBe(false);
      expect(isDriverError(new Error('test'))).toBe(false);
      expect(isDriverError(null)).toBe(false);
    });

    it('isGeodeError should identify all Geode errors', () => {
      const driverErr = new DriverError({
        statusClass: StatusClass.SYNTAX,
        subclass: '001',
        code: 'SyntaxError',
        message: 'test',
      });

      const transportErr = new TransportError({
        operation: 'connect',
      });

      const configErr = new ConfigError({
        field: 'port',
        message: 'invalid',
      });

      const securityErr = new SecurityError({
        type: 'input',
        message: 'test',
      });

      const stateErr = new StateError({
        currentState: 'closed',
        operation: 'query',
      });

      expect(isGeodeError(driverErr)).toBe(true);
      expect(isGeodeError(transportErr)).toBe(true);
      expect(isGeodeError(configErr)).toBe(true);
      expect(isGeodeError(securityErr)).toBe(true);
      expect(isGeodeError(stateErr)).toBe(true);
      expect(isGeodeError(new Error('test'))).toBe(false);
    });

    it('isRetryableError should check retryability', () => {
      const retryableErr = new DriverError({
        statusClass: StatusClass.SERIALIZATION,
        subclass: '001',
        code: 'SerializationError',
        message: 'test',
      });

      const nonRetryableErr = new ConfigError({
        field: 'port',
        message: 'invalid',
      });

      const transportErr = new TransportError({
        operation: 'connect',
      });

      expect(isRetryableError(retryableErr)).toBe(true);
      expect(isRetryableError(nonRetryableErr)).toBe(false);
      expect(isRetryableError(transportErr)).toBe(true);
      expect(isRetryableError(new Error('test'))).toBe(false);
    });
  });

  describe('sentinel errors', () => {
    it('should have correct messages', () => {
      expect(ErrClosed.message).toBe('geode: connection closed');
      expect(ErrQueryInProgress.message).toBe('geode: query already in progress');
      expect(ErrTxInProgress.message).toBe('geode: transaction already in progress');
    });
  });
});
