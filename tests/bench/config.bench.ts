/**
 * Configuration Benchmarks
 *
 * Measures performance of DSN parsing and configuration operations.
 */

import { describe, bench } from 'vitest';
import {
  parseDSN,
  defaultConfig,
  validateConfig,
  getAddress,
  cloneConfig,
} from '../../src/config.js';

// Test fixtures
const simpleDSN = 'localhost:3141';
const urlDSN = 'geode://localhost:3141';
const authDSN = 'geode://admin:secret@localhost:3141';
const fullDSN =
  'geode://admin:secret@localhost:3141?page_size=500&hello_name=test&conformance=full&insecure=true';
const ipv6DSN = '[::1]:3141';
const encodedDSN = 'geode://user%40domain:pass%3Dword@localhost:3141';

describe('Configuration Benchmarks', () => {
  describe('Default Config', () => {
    bench('create default config', () => {
      defaultConfig();
    });
  });

  describe('DSN Parsing', () => {
    bench('parse empty DSN', () => {
      parseDSN('');
    });

    bench('parse host only', () => {
      parseDSN('localhost');
    });

    bench('parse host:port', () => {
      parseDSN(simpleDSN);
    });

    bench('parse geode:// URL', () => {
      parseDSN(urlDSN);
    });

    bench('parse URL with auth', () => {
      parseDSN(authDSN);
    });

    bench('parse URL with all options', () => {
      parseDSN(fullDSN);
    });

    bench('parse IPv6 address', () => {
      parseDSN(ipv6DSN);
    });

    bench('parse URL with encoded credentials', () => {
      parseDSN(encodedDSN);
    });

    bench('parse with query params (5 params)', () => {
      parseDSN(
        'localhost:3141?page_size=500&hello_name=test&hello_ver=1.0&conformance=min&insecure=true'
      );
    });
  });

  describe('Config Validation', () => {
    const validConfig = defaultConfig();

    bench('validate config', () => {
      validateConfig(validConfig);
    });
  });

  describe('Config Operations', () => {
    const config = parseDSN(fullDSN);

    bench('get address (hostname)', () => {
      getAddress(config);
    });

    bench('get address (IPv6)', () => {
      getAddress({ ...config, host: '::1' });
    });

    bench('clone config', () => {
      cloneConfig(config);
    });
  });
});
