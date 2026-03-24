import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * SEC-P6-4: gRPC transport must reject insecureSkipVerify in production
 * SEC-P6-5: gRPC max message size must match QUIC transport (16 MiB)
 *
 * These tests verify the gRPC transport's security hardening by importing
 * the module and checking its behavior under production conditions.
 */

// We need to test the GrpcTransport.connect() static method.
// Since it requires @grpc/grpc-js and proto loading, we mock those dependencies
// but test the security logic (production guard and channel options) directly.

// Mock @grpc/grpc-js to avoid needing a real gRPC server
vi.mock('@grpc/grpc-js', () => {
  const createInsecure = vi.fn(() => 'insecure-creds');
  const createSsl = vi.fn(() => 'ssl-creds');

  // Use a proper class so `new` works
  class MockGeodeService {
    close = vi.fn();
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

// Mock validate.js
vi.mock('../../src/validate.js', () => ({
  validateTLSCertPath: vi.fn(),
}));

import { GrpcTransport } from '../../src/grpc-transport.js';
import type { GeodeConfig } from '../../src/config.js';
import * as grpc from '@grpc/grpc-js';

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
    vi.restoreAllMocks();
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
      const constructorCalls: unknown[][] = [];
      const MockService = class {
        close = vi.fn();
        constructor(...args: unknown[]) {
          constructorCalls.push(args);
        }
      };
      loadPkgDef.mockReturnValue({
        geode: {
          GeodeService: MockService,
        },
      });

      const transport = await GrpcTransport.connect(cfg);
      expect(transport).toBeDefined();

      // Verify the constructor was called with correct max message sizes
      expect(constructorCalls.length).toBeGreaterThan(0);
      const channelOptions = constructorCalls[0][2] as Record<string, number>;
      const expectedSize = 16 * 1024 * 1024; // 16 MiB

      expect(channelOptions['grpc.max_receive_message_length']).toBe(expectedSize);
      expect(channelOptions['grpc.max_send_message_length']).toBe(expectedSize);

      await transport.close();
    });
  });
});
