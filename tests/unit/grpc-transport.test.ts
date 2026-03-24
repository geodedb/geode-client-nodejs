import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * SEC-P6-4: gRPC transport must reject insecureSkipVerify in production
 * SEC-P6-5: gRPC max message size must match QUIC transport (16 MiB)
 * PERF-2: Backpressure on gRPC streaming to prevent unbounded buffering
 * PERF-7: Stream inactivity timeout on gRPC streaming calls
 * QUAL-A5: Clear DriverError for savepoint/rollbackTo operations
 *
 * These tests verify the gRPC transport's security hardening, backpressure,
 * timeout, and unsupported operation handling.
 */

// We need to test the GrpcTransport.connect() static method.
// Since it requires @grpc/grpc-js and proto loading, we mock those dependencies
// but test the security logic (production guard and channel options) directly.

// Create a mock stream factory that's accessible in tests
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

// Mock @grpc/grpc-js to avoid needing a real gRPC server
vi.mock('@grpc/grpc-js', () => {
  const createInsecure = vi.fn(() => 'insecure-creds');
  const createSsl = vi.fn(() => 'ssl-creds');

  // Use a proper class so `new` works
  class MockGeodeService {
    close = vi.fn();
    handshake = vi.fn((_req: unknown, cb: (err: null, res: unknown) => void) => {
      cb(null, { version: '1.0' });
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
    credentials: { createInsecure, createSsl },
    loadPackageDefinition: vi.fn(() => ({
      geode: {
        GeodeService: MockGeodeService,
      },
    })),
  };
});

// Mock @grpc/proto-loader
vi.mock('@grpc/proto-loader', () => ({
  load: vi.fn().mockResolvedValue({}),
}));

// Mock proto.ts
vi.mock('../../src/proto.js', () => ({
  getProtoPath: vi.fn(() => '/fake/geode.proto'),
}));

// Mock transport.js to provide a stubbed buildTLSConfig
vi.mock('../../src/transport.js', () => ({
  buildTLSConfig: vi.fn().mockResolvedValue({ minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }),
}));

import { GrpcTransport } from '../../src/grpc-transport.js';
import { DriverError } from '../../src/errors.js';
import type { GeodeConfig } from '../../src/config.js';

describe('GrpcTransport security hardening', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalGeodeEnv = process.env['GEODE_ENV'];
  const originalAllowInsecure = process.env['GEODE_ALLOW_INSECURE_PRODUCTION'];

  afterEach(() => {
    // Restore environment variables
    if (originalNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = originalNodeEnv;
    }
    if (originalGeodeEnv === undefined) {
      delete process.env['GEODE_ENV'];
    } else {
      process.env['GEODE_ENV'] = originalGeodeEnv;
    }
    if (originalAllowInsecure === undefined) {
      delete process.env['GEODE_ALLOW_INSECURE_PRODUCTION'];
    } else {
      process.env['GEODE_ALLOW_INSECURE_PRODUCTION'] = originalAllowInsecure;
    }
    vi.clearAllMocks();
  });

  describe('SEC-P6-4: production insecureSkipVerify guard', () => {
    it('should throw when insecureSkipVerify is true and NODE_ENV=production', async () => {
      process.env['NODE_ENV'] = 'production';
      delete process.env['GEODE_ALLOW_INSECURE_PRODUCTION'];

      const cfg: GeodeConfig = {
        host: 'localhost',
        port: 3141,
        insecureSkipVerify: true,
        transport: 'grpc',
      };

      await expect(GrpcTransport.connect(cfg)).rejects.toThrow(
        'insecureSkipVerify is not allowed in production'
      );
    });

    it('should throw when insecureSkipVerify is true and GEODE_ENV=production', async () => {
      delete process.env['NODE_ENV'];
      process.env['GEODE_ENV'] = 'production';
      delete process.env['GEODE_ALLOW_INSECURE_PRODUCTION'];

      const cfg: GeodeConfig = {
        host: 'localhost',
        port: 3141,
        insecureSkipVerify: true,
        transport: 'grpc',
      };

      await expect(GrpcTransport.connect(cfg)).rejects.toThrow(
        'insecureSkipVerify is not allowed in production'
      );
    });

    it('should allow insecureSkipVerify in production when GEODE_ALLOW_INSECURE_PRODUCTION=true', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['GEODE_ALLOW_INSECURE_PRODUCTION'] = 'true';

      const cfg: GeodeConfig = {
        host: 'localhost',
        port: 3141,
        insecureSkipVerify: true,
        transport: 'grpc',
      };

      // Should not throw - connect should succeed (with mocked gRPC)
      const transport = await GrpcTransport.connect(cfg);
      expect(transport).toBeDefined();
      await transport.close();
    });

    it('should allow insecureSkipVerify in non-production environments', async () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['GEODE_ENV'];
      delete process.env['GEODE_ALLOW_INSECURE_PRODUCTION'];

      const cfg: GeodeConfig = {
        host: 'localhost',
        port: 3141,
        insecureSkipVerify: true,
        transport: 'grpc',
      };

      const transport = await GrpcTransport.connect(cfg);
      expect(transport).toBeDefined();
      await transport.close();
    });
  });

  describe('SEC-P6-5: max message size consistency', () => {
    it('should use 16 MiB max message size matching QUIC transport', async () => {
      process.env['NODE_ENV'] = 'test';
      delete process.env['GEODE_ENV'];

      const cfg: GeodeConfig = {
        host: 'localhost',
        port: 3141,
        tls: false,
        transport: 'grpc',
      };

      // Spy on the GeodeService constructor to capture channel options
      const grpcModule = await import('@grpc/grpc-js');
      const loadPkgDef = grpcModule.loadPackageDefinition as ReturnType<typeof vi.fn>;
      // Save the original implementation to restore after test
      const originalImpl = loadPkgDef.getMockImplementation();
      const constructorCalls: unknown[][] = [];
      const MockService = class {
        close = vi.fn();
        handshake = vi.fn();
        execute = vi.fn(() => createMockStream());
        constructor(...args: unknown[]) {
          constructorCalls.push(args);
        }
      };
      loadPkgDef.mockReturnValue({
        geode: {
          GeodeService: MockService,
        },
      });

      try {
        const transport = await GrpcTransport.connect(cfg);
        expect(transport).toBeDefined();

        // Verify the constructor was called with correct max message sizes
        expect(constructorCalls.length).toBeGreaterThan(0);
        const channelOptions = constructorCalls[0][2] as Record<string, number>;
        const expectedSize = 16 * 1024 * 1024; // 16 MiB

        expect(channelOptions['grpc.max_receive_message_length']).toBe(expectedSize);
        expect(channelOptions['grpc.max_send_message_length']).toBe(expectedSize);

        await transport.close();
      } finally {
        // Restore the original mock implementation so later tests aren't affected
        if (originalImpl) {
          loadPkgDef.mockImplementation(originalImpl);
        }
      }
    });
  });
});

describe('QUAL-A5: gRPC savepoint/rollbackTo errors', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should throw DriverError for savepoint operations', async () => {
    process.env['NODE_ENV'] = 'test';
    const cfg: GeodeConfig = {
      host: 'localhost',
      port: 3141,
      tls: false,
      transport: 'grpc',
    };

    const transport = await GrpcTransport.connect(cfg);

    try {
      await transport.sendProto({ savepoint: { name: 'sp1' } });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DriverError);
      const driverErr = err as DriverError;
      expect(driverErr.statusClass).toBe('58000');
      expect(driverErr.message).toContain(
        'Savepoint operations are not supported over gRPC transport'
      );
      expect(driverErr.message).toContain('Use QUIC transport');
    } finally {
      await transport.close();
    }
  });

  it('should throw DriverError for rollbackTo operations', async () => {
    process.env['NODE_ENV'] = 'test';
    const cfg: GeodeConfig = {
      host: 'localhost',
      port: 3141,
      tls: false,
      transport: 'grpc',
    };

    const transport = await GrpcTransport.connect(cfg);

    try {
      await transport.sendProto({ rollbackTo: { name: 'sp1' } });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DriverError);
      const driverErr = err as DriverError;
      expect(driverErr.statusClass).toBe('58000');
      expect(driverErr.message).toContain(
        'Savepoint operations are not supported over gRPC transport'
      );
      expect(driverErr.message).toContain('Use QUIC transport');
    } finally {
      await transport.close();
    }
  });

  it('should not throw DriverError for supported operations like ping', async () => {
    process.env['NODE_ENV'] = 'test';
    const cfg: GeodeConfig = {
      host: 'localhost',
      port: 3141,
      tls: false,
      transport: 'grpc',
    };

    const transport = await GrpcTransport.connect(cfg);

    // ping should succeed (mocked)
    await transport.sendProto({ ping: {} });
    const response = await transport.receiveProto();
    expect(response).toBeDefined();
    expect(response.ping).toBeDefined();

    await transport.close();
  });
});

describe('PERF-2: gRPC streaming backpressure', () => {
  let transport: GrpcTransport;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    const cfg: GeodeConfig = {
      host: 'localhost',
      port: 3141,
      tls: false,
      transport: 'grpc',
      requestTimeout: 0, // Disable timeout for backpressure tests
    };
    transport = await GrpcTransport.connect(cfg);
  });

  afterEach(async () => {
    await transport.close();
    vi.clearAllMocks();
  });

  it('should pause the stream when buffer exceeds backpressure threshold', async () => {
    // Start an execute call - this returns after first data event
    const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN n' } });

    // Emit multiple data events to exceed the threshold (default = 2)
    const mockResponse = {
      status: {
        statusClass: '00000',
        statusSubclass: '',
        additionalStatuses: [],
        flaggerFindings: [],
      },
      payload: 'page',
      page: { rows: [{ n: 1 }], final: false, ordered: false, orderKeys: [] },
    };

    // First message resolves the sendProto promise
    latestMockStream.emit('data', mockResponse);
    await sendPromise;

    // Second message should trigger backpressure (buffer reaches threshold of 2)
    latestMockStream.emit('data', mockResponse);

    // Stream should have been paused
    expect(latestMockStream.pause).toHaveBeenCalled();
  });

  it('should resume the stream when receiveProto drains the buffer', async () => {
    const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN n' } });

    const mockResponse = {
      status: {
        statusClass: '00000',
        statusSubclass: '',
        additionalStatuses: [],
        flaggerFindings: [],
      },
      payload: 'page',
      page: { rows: [{ n: 1 }], final: false, ordered: false, orderKeys: [] },
    };

    // Emit enough to trigger backpressure
    latestMockStream.emit('data', mockResponse);
    await sendPromise;
    latestMockStream.emit('data', mockResponse);
    latestMockStream.emit('data', mockResponse);

    expect(latestMockStream.pause).toHaveBeenCalled();

    // Drain the buffer via receiveProto
    await transport.receiveProto();
    await transport.receiveProto();

    // After draining below threshold, stream should be resumed
    expect(latestMockStream.resume).toHaveBeenCalled();
  });

  it('should resolve pending reads directly without buffering when a reader is waiting', async () => {
    const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN n' } });

    const mockResponse = {
      status: {
        statusClass: '00000',
        statusSubclass: '',
        additionalStatuses: [],
        flaggerFindings: [],
      },
      payload: 'page',
      page: { rows: [{ n: 1 }], final: false, ordered: false, orderKeys: [] },
    };

    // First message resolves sendProto
    latestMockStream.emit('data', mockResponse);
    await sendPromise;

    // Consume the first buffered message
    await transport.receiveProto();

    // Now start a receiveProto that will wait (no data buffered)
    const receivePromise = transport.receiveProto();

    // Emit another message - should resolve the pending read directly
    const mockResponse2 = {
      status: {
        statusClass: '00000',
        statusSubclass: '',
        additionalStatuses: [],
        flaggerFindings: [],
      },
      payload: 'page',
      page: { rows: [{ n: 2 }], final: true, ordered: false, orderKeys: [] },
    };
    latestMockStream.emit('data', mockResponse2);

    const result = await receivePromise;
    expect(result).toBeDefined();
    expect(result.execute).toBeDefined();
  });
});

describe('PERF-7: gRPC stream inactivity timeout', () => {
  afterEach(async () => {
    vi.clearAllMocks();
  });

  it('should timeout when no data is received within the configured period', async () => {
    vi.useFakeTimers();
    process.env['NODE_ENV'] = 'test';
    const cfg: GeodeConfig = {
      host: 'localhost',
      port: 3141,
      tls: false,
      transport: 'grpc',
      requestTimeout: 500, // 500ms timeout
    };
    const transport = await GrpcTransport.connect(cfg);

    try {
      const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN n' } });

      // Advance time past the timeout without emitting any data
      vi.advanceTimersByTime(600);

      await expect(sendPromise).rejects.toThrow('gRPC stream timed out');
      expect(latestMockStream.cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await transport.close();
    }
  });

  it('should reset the timeout on each data event', async () => {
    vi.useFakeTimers();
    process.env['NODE_ENV'] = 'test';
    const cfg: GeodeConfig = {
      host: 'localhost',
      port: 3141,
      tls: false,
      transport: 'grpc',
      requestTimeout: 500, // 500ms timeout
    };
    const transport = await GrpcTransport.connect(cfg);

    try {
      const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN n' } });

      const mockResponse = {
        status: {
          statusClass: '00000',
          statusSubclass: '',
          additionalStatuses: [],
          flaggerFindings: [],
        },
        payload: 'page',
        page: { rows: [{ n: 1 }], final: false, ordered: false, orderKeys: [] },
      };

      // Advance 400ms (below timeout), then emit data
      vi.advanceTimersByTime(400);
      latestMockStream.emit('data', mockResponse);
      await sendPromise;

      // Advance another 400ms (below timeout since it was reset by data event)
      vi.advanceTimersByTime(400);
      latestMockStream.emit('data', mockResponse);

      // Stream should NOT have been cancelled (timeout was reset)
      // We check that the stream is still active by consuming responses
      const result = await transport.receiveProto();
      expect(result).toBeDefined();
    } finally {
      vi.useRealTimers();
      await transport.close();
    }
  });

  it('should reject pending reads when stream times out', async () => {
    vi.useFakeTimers();
    process.env['NODE_ENV'] = 'test';
    const cfg: GeodeConfig = {
      host: 'localhost',
      port: 3141,
      tls: false,
      transport: 'grpc',
      requestTimeout: 500,
    };
    const transport = await GrpcTransport.connect(cfg);

    try {
      const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN n' } });

      const mockResponse = {
        status: {
          statusClass: '00000',
          statusSubclass: '',
          additionalStatuses: [],
          flaggerFindings: [],
        },
        payload: 'page',
        page: { rows: [{ n: 1 }], final: false, ordered: false, orderKeys: [] },
      };

      // Emit first data to resolve sendProto
      latestMockStream.emit('data', mockResponse);
      await sendPromise;

      // Consume the buffered message
      await transport.receiveProto();

      // Start waiting for next message
      const receivePromise = transport.receiveProto();

      // Advance past timeout without any more data
      vi.advanceTimersByTime(600);

      await expect(receivePromise).rejects.toThrow('gRPC stream timed out');
    } finally {
      vi.useRealTimers();
      await transport.close();
    }
  });

  it('should not timeout when requestTimeout is 0 (disabled)', async () => {
    vi.useFakeTimers();
    process.env['NODE_ENV'] = 'test';
    const cfg: GeodeConfig = {
      host: 'localhost',
      port: 3141,
      tls: false,
      transport: 'grpc',
      requestTimeout: 0, // disabled
    };
    const transport = await GrpcTransport.connect(cfg);

    try {
      const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN n' } });

      // Advance a very long time - should not timeout
      vi.advanceTimersByTime(300_000);

      // Stream should still be alive, not cancelled due to timeout
      // Now emit data and complete
      const mockResponse = {
        status: {
          statusClass: '00000',
          statusSubclass: '',
          additionalStatuses: [],
          flaggerFindings: [],
        },
        payload: 'page',
        page: { rows: [{ n: 1 }], final: true, ordered: false, orderKeys: [] },
      };
      latestMockStream.emit('data', mockResponse);
      await sendPromise;

      const result = await transport.receiveProto();
      expect(result).toBeDefined();
    } finally {
      vi.useRealTimers();
      await transport.close();
    }
  });

  it('should clear timeout when stream completes normally', async () => {
    vi.useFakeTimers();
    process.env['NODE_ENV'] = 'test';
    const cfg: GeodeConfig = {
      host: 'localhost',
      port: 3141,
      tls: false,
      transport: 'grpc',
      requestTimeout: 500,
    };
    const transport = await GrpcTransport.connect(cfg);

    try {
      const sendPromise = transport.sendProto({ execute: { query: 'MATCH (n) RETURN n' } });

      const mockResponse = {
        status: {
          statusClass: '00000',
          statusSubclass: '',
          additionalStatuses: [],
          flaggerFindings: [],
        },
        payload: 'page',
        page: { rows: [{ n: 1 }], final: true, ordered: false, orderKeys: [] },
      };

      latestMockStream.emit('data', mockResponse);
      await sendPromise;

      // End the stream normally
      latestMockStream.emit('end');

      // Advance past timeout - should not cause issues since stream ended
      vi.advanceTimersByTime(600);

      // Should be able to receive the buffered response
      const result = await transport.receiveProto();
      expect(result).toBeDefined();
    } finally {
      vi.useRealTimers();
      await transport.close();
    }
  });
});
