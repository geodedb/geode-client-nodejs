/**
 * Property-Based Tests for Configuration
 *
 * Uses fast-check for generating arbitrary inputs to test DSN parsing robustness.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  parseDSN,
  formatDSN,
  validateConfig,
  defaultConfig,
  getAddress,
} from '../../src/config.js';
import { ConfigError } from '../../src/errors.js';

// Helper to generate strings from a character set
const stringFromChars = (chars: string, opts?: { minLength?: number; maxLength?: number }) =>
  fc
    .array(fc.constantFrom(...chars.split('')), {
      minLength: opts?.minLength ?? 0,
      maxLength: opts?.maxLength ?? 10,
    })
    .map((arr) => arr.join(''));

describe('Config Property Tests', () => {
  beforeEach(() => {
    for (const k of [
      'GEODE_HOST',
      'GEODE_PORT',
      'GEODE_TLS_CA',
      'GEODE_USERNAME',
      'GEODE_PASSWORD',
      'GEODE_TRANSPORT',
    ]) {
      delete process.env[k];
    }
  });

  describe('DSN Parsing Robustness', () => {
    it('should not crash on arbitrary strings', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            parseDSN(input);
            return true;
          } catch (e) {
            // Should only throw ConfigError, not crash
            expect(e).toBeInstanceOf(ConfigError);
            return true;
          }
        }),
        { numRuns: 1000 }
      );
    });

    it('should handle arbitrary unicode strings', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          try {
            parseDSN(input);
            return true;
          } catch (e) {
            expect(e).toBeInstanceOf(ConfigError);
            return true;
          }
        }),
        { numRuns: 500 }
      );
    });

    it('should parse valid host:port combinations', () => {
      fc.assert(
        fc.property(
          stringFromChars('abcdefghijklmnopqrstuvwxyz0123456789-.', {
            minLength: 1,
            maxLength: 63,
          }),
          fc.integer({ min: 1, max: 65535 }),
          (host, port) => {
            if (!host || host.length > 253) return true; // Skip invalid hosts

            try {
              const cfg = parseDSN(`${host}:${port}`);
              expect(cfg.host).toBe(host);
              expect(cfg.port).toBe(port);
              return true;
            } catch (e) {
              // Some generated hosts may be invalid
              expect(e).toBeInstanceOf(ConfigError);
              return true;
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('should handle quic:// URLs with arbitrary paths', () => {
      fc.assert(
        fc.property(fc.webUrl({ validSchemes: ['quic'] }), (url) => {
          // Replace http/https with quic
          const quicUrl = url.replace(/^https?:/, 'quic:');
          try {
            parseDSN(quicUrl);
            return true;
          } catch (e) {
            expect(e).toBeInstanceOf(ConfigError);
            return true;
          }
        }),
        { numRuns: 500 }
      );
    });

    it('should handle query parameters with arbitrary values', () => {
      fc.assert(
        fc.property(
          fc.record({
            page_size: fc.oneof(fc.integer(), fc.string()),
            hello_name: fc.string(),
            conformance: fc.string(),
            insecure: fc.oneof(fc.constant('true'), fc.constant('false'), fc.string()),
          }),
          (params) => {
            const queryString = Object.entries(params)
              .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
              .join('&');

            try {
              parseDSN(`localhost:3141?${queryString}`);
              return true;
            } catch (e) {
              expect(e).toBeInstanceOf(ConfigError);
              return true;
            }
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('DSN Roundtrip Properties', () => {
    it('should preserve valid port numbers', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 65535 }), (port) => {
          const cfg = parseDSN(`localhost:${port}`);
          expect(cfg.port).toBe(port);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve valid page_size values', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100000 }), (pageSize) => {
          const cfg = parseDSN(`localhost:3141?page_size=${pageSize}`);
          expect(cfg.pageSize).toBe(pageSize);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve conformance levels', () => {
      fc.assert(
        fc.property(fc.constantFrom('min', 'full', 'extended'), (conformance) => {
          const cfg = parseDSN(`localhost:3141?conformance=${conformance}`);
          expect(cfg.conformance).toBe(conformance);
          return true;
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('Config Validation Properties', () => {
    it('should accept configs with valid port range', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 65535 }), (port) => {
          const cfg = { ...defaultConfig(), port };
          expect(() => validateConfig(cfg)).not.toThrow();
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should reject configs with invalid port range', () => {
      fc.assert(
        fc.property(fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 65536 })), (port) => {
          const cfg = { ...defaultConfig(), port };
          expect(() => validateConfig(cfg)).toThrow(ConfigError);
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should accept configs with valid pageSize range', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100000 }), (pageSize) => {
          const cfg = { ...defaultConfig(), pageSize };
          expect(() => validateConfig(cfg)).not.toThrow();
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('should reject configs with invalid pageSize', () => {
      fc.assert(
        fc.property(fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 100001 })), (pageSize) => {
          const cfg = { ...defaultConfig(), pageSize };
          expect(() => validateConfig(cfg)).toThrow(ConfigError);
          return true;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Address Formatting', () => {
    it('should format IPv4 addresses correctly', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 })
          ),
          fc.integer({ min: 1, max: 65535 }),
          ([a, b, c, d], port) => {
            const host = `${a}.${b}.${c}.${d}`;
            const cfg = { ...defaultConfig(), host, port };
            const addr = getAddress(cfg);
            expect(addr).toBe(`${host}:${port}`);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should bracket IPv6 addresses', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('::1', '2001:db8::1', 'fe80::1', '::'),
          fc.integer({ min: 1, max: 65535 }),
          (host, port) => {
            const cfg = { ...defaultConfig(), host, port };
            const addr = getAddress(cfg);
            expect(addr).toBe(`[${host}]:${port}`);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('formatDSN round-trip', () => {
    const ident = (min = 1, max = 12) =>
      fc
        .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
          minLength: min,
          maxLength: max,
        })
        .map((a) => a.join(''));

    it('parse(format(parse(dsn))) deep-equals parse(dsn) for valid configs', () => {
      fc.assert(
        fc.property(
          ident(1, 20), // host label
          fc.integer({ min: 1, max: 65535 }), // port
          fc.constantFrom('quic', 'grpc'),
          fc.integer({ min: 1, max: 100000 }), // page_size
          fc.option(ident(), { nil: undefined }), // username
          fc.option(ident(), { nil: undefined }), // tenant
          fc.option(ident(), { nil: undefined }), // role
          (host, port, scheme, pageSize, username, tenant, role) => {
            const parts = [`${scheme}://`];
            if (username) parts.push(`${username}:pw@`);
            parts.push(`${host}.local:${port}?page_size=${pageSize}`);
            if (tenant) parts.push(`&tenant=${tenant}`);
            if (role) parts.push(`&role=${role}`);
            const cfg = parseDSN(parts.join(''));
            const round = parseDSN(formatDSN(cfg));
            expect(round).toEqual(cfg);
            return true;
          }
        ),
        { numRuns: 300 }
      );
    });
  });
});
