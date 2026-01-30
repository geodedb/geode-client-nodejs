import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseDSN,
  defaultConfig,
  validateConfig,
  getAddress,
  cloneConfig,
  DEFAULT_PORT,
  DEFAULT_PAGE_SIZE,
  DEFAULT_HELLO_NAME,
  DEFAULT_HELLO_VERSION,
  DEFAULT_CONFORMANCE,
} from '../../src/config.js';
import { ConfigError } from '../../src/errors.js';

describe('config', () => {
  // Save and restore environment variables
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    originalEnv['GEODE_HOST'] = process.env['GEODE_HOST'];
    originalEnv['GEODE_PORT'] = process.env['GEODE_PORT'];
    originalEnv['GEODE_TLS_CA'] = process.env['GEODE_TLS_CA'];
    originalEnv['GEODE_USERNAME'] = process.env['GEODE_USERNAME'];
    originalEnv['GEODE_PASSWORD'] = process.env['GEODE_PASSWORD'];

    delete process.env['GEODE_HOST'];
    delete process.env['GEODE_PORT'];
    delete process.env['GEODE_TLS_CA'];
    delete process.env['GEODE_USERNAME'];
    delete process.env['GEODE_PASSWORD'];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('defaultConfig', () => {
    it('should return default values', () => {
      const cfg = defaultConfig();

      expect(cfg.host).toBe('localhost');
      expect(cfg.port).toBe(DEFAULT_PORT);
      expect(cfg.pageSize).toBe(DEFAULT_PAGE_SIZE);
      expect(cfg.helloName).toBe(DEFAULT_HELLO_NAME);
      expect(cfg.helloVersion).toBe(DEFAULT_HELLO_VERSION);
      expect(cfg.conformance).toBe(DEFAULT_CONFORMANCE);
    });
  });

  describe('parseDSN', () => {
    it('should parse empty DSN with defaults', () => {
      const cfg = parseDSN('');

      expect(cfg.host).toBe('localhost');
      expect(cfg.port).toBe(DEFAULT_PORT);
    });

    it('should parse host only', () => {
      const cfg = parseDSN('myserver');

      expect(cfg.host).toBe('myserver');
      expect(cfg.port).toBe(DEFAULT_PORT);
    });

    it('should parse host:port', () => {
      const cfg = parseDSN('myserver:8443');

      expect(cfg.host).toBe('myserver');
      expect(cfg.port).toBe(8443);
    });

    it('should parse geode:// URL', () => {
      const cfg = parseDSN('geode://myserver:8443');

      expect(cfg.host).toBe('myserver');
      expect(cfg.port).toBe(8443);
    });

    it('should parse URL with credentials', () => {
      const cfg = parseDSN('geode://admin:secret@myserver:3141');

      expect(cfg.host).toBe('myserver');
      expect(cfg.port).toBe(3141);
      expect(cfg.username).toBe('admin');
      expect(cfg.password).toBe('secret');
    });

    it('should URL-decode credentials', () => {
      const cfg = parseDSN('geode://user%40domain:pass%3Dword@myserver:3141');

      expect(cfg.username).toBe('user@domain');
      expect(cfg.password).toBe('pass=word');
    });

    it('should parse query parameters', () => {
      const cfg = parseDSN('myserver:3141?page_size=500&hello_name=test&conformance=full');

      expect(cfg.pageSize).toBe(500);
      expect(cfg.helloName).toBe('test');
      expect(cfg.conformance).toBe('full');
    });

    it('should parse URL query parameters', () => {
      const cfg = parseDSN('geode://myserver:3141?page_size=500&insecure=true');

      expect(cfg.pageSize).toBe(500);
      expect(cfg.insecureSkipVerify).toBe(true);
    });

    it('should parse TLS options', () => {
      const cfg = parseDSN(
        'myserver:3141?ca=/path/to/ca.crt&cert=/path/to/cert.crt&key=/path/to/key.pem'
      );

      expect(cfg.tlsCA).toBe('/path/to/ca.crt');
      expect(cfg.tlsCert).toBe('/path/to/cert.crt');
      expect(cfg.tlsKey).toBe('/path/to/key.pem');
    });

    it('should parse timeout options', () => {
      const cfg = parseDSN('myserver:3141?connect_timeout=5000&request_timeout=60000');

      expect(cfg.connectTimeout).toBe(5000);
      expect(cfg.requestTimeout).toBe(60000);
    });

    it('should parse server_name option', () => {
      const cfg = parseDSN('myserver:3141?server_name=custom.example.com');

      expect(cfg.serverName).toBe('custom.example.com');
    });

    it('should apply environment variables', () => {
      process.env['GEODE_HOST'] = 'envhost';
      process.env['GEODE_PORT'] = '9000';
      process.env['GEODE_TLS_CA'] = '/env/ca.crt';

      const cfg = parseDSN('');

      expect(cfg.host).toBe('envhost');
      expect(cfg.port).toBe(9000);
      expect(cfg.tlsCA).toBe('/env/ca.crt');
    });

    it('should prefer DSN over environment variables', () => {
      process.env['GEODE_HOST'] = 'envhost';
      process.env['GEODE_PORT'] = '9000';

      const cfg = parseDSN('dsnhost:8000');

      expect(cfg.host).toBe('dsnhost');
      expect(cfg.port).toBe(8000);
    });

    describe('IPv6 support', () => {
      it('should parse bracketed IPv6 address', () => {
        const cfg = parseDSN('[::1]:3141');

        expect(cfg.host).toBe('::1');
        expect(cfg.port).toBe(3141);
      });

      it('should parse bracketed IPv6 without port', () => {
        const cfg = parseDSN('[::1]');

        expect(cfg.host).toBe('::1');
        expect(cfg.port).toBe(DEFAULT_PORT);
      });

      it('should parse full IPv6 as host', () => {
        const cfg = parseDSN('2001:db8::1');

        expect(cfg.host).toBe('2001:db8::1');
        expect(cfg.port).toBe(DEFAULT_PORT);
      });
    });

    describe('error cases', () => {
      it('should reject invalid URL format', () => {
        expect(() => parseDSN('geode://[invalid')).toThrow(ConfigError);
      });

      it('should reject missing host in URL', () => {
        expect(() => parseDSN('geode://:3141')).toThrow(ConfigError);
      });

      it('should reject invalid page_size', () => {
        expect(() => parseDSN('myserver:3141?page_size=abc')).toThrow(ConfigError);
        expect(() => parseDSN('myserver:3141?page_size=0')).toThrow(ConfigError);
        expect(() => parseDSN('myserver:3141?page_size=-1')).toThrow(ConfigError);
      });

      it('should reject page_size exceeding max', () => {
        expect(() => parseDSN('myserver:3141?page_size=200000')).toThrow(ConfigError);
      });

      it('should reject empty hello_name', () => {
        expect(() => parseDSN('myserver:3141?hello_name=')).toThrow(ConfigError);
      });

      it('should reject incomplete mTLS config', () => {
        expect(() => parseDSN('myserver:3141?cert=/path/cert')).toThrow(ConfigError);
        expect(() => parseDSN('myserver:3141?key=/path/key')).toThrow(ConfigError);
      });

      // Port range validation tests
      it('should reject invalid port in simple DSN', () => {
        expect(() => parseDSN('myserver:abc')).toThrow(ConfigError);
        expect(() => parseDSN('myserver:99999')).toThrow(ConfigError);
        expect(() => parseDSN('myserver:0')).toThrow(ConfigError);
        expect(() => parseDSN('myserver:-1')).toThrow(ConfigError);
      });

      it('should reject invalid port in geode:// URL', () => {
        // Note: URL constructor rejects 99999 and -1 as invalid URLs,
        // so only port 0 can be tested here (accepted by URL but invalid port range)
        expect(() => parseDSN('geode://myserver:0')).toThrow(ConfigError);
      });

      it('should reject invalid port in IPv6 address', () => {
        expect(() => parseDSN('[::1]:99999')).toThrow(ConfigError);
        expect(() => parseDSN('[::1]:0')).toThrow(ConfigError);
        expect(() => parseDSN('geode://[::1]:99999')).toThrow(ConfigError);
      });
    });
  });

  describe('validateConfig', () => {
    it('should accept valid config', () => {
      const cfg = defaultConfig();
      expect(() => validateConfig(cfg)).not.toThrow();
    });

    it('should reject empty host', () => {
      const cfg = defaultConfig();
      cfg.host = '';
      expect(() => validateConfig(cfg)).toThrow(ConfigError);
    });

    it('should reject invalid port', () => {
      const cfg = defaultConfig();

      cfg.port = 0;
      expect(() => validateConfig(cfg)).toThrow(ConfigError);

      cfg.port = 70000;
      expect(() => validateConfig(cfg)).toThrow(ConfigError);
    });

    it('should reject port outside valid range (1-65535)', () => {
      const cfg = defaultConfig();

      // Test negative port
      cfg.port = -1;
      expect(() => validateConfig(cfg)).toThrow(ConfigError);

      // Test port above max
      cfg.port = 65536;
      expect(() => validateConfig(cfg)).toThrow(ConfigError);

      // Test very large port number
      cfg.port = 99999;
      expect(() => validateConfig(cfg)).toThrow(ConfigError);
    });

    it('should accept valid port boundaries', () => {
      const cfg = defaultConfig();

      // Test minimum valid port
      cfg.port = 1;
      expect(() => validateConfig(cfg)).not.toThrow();

      // Test maximum valid port
      cfg.port = 65535;
      expect(() => validateConfig(cfg)).not.toThrow();

      // Test common ports
      cfg.port = 3141;
      expect(() => validateConfig(cfg)).not.toThrow();

      cfg.port = 443;
      expect(() => validateConfig(cfg)).not.toThrow();
    });

    it('should reject invalid pageSize', () => {
      const cfg = defaultConfig();

      cfg.pageSize = 0;
      expect(() => validateConfig(cfg)).toThrow(ConfigError);

      cfg.pageSize = -1;
      expect(() => validateConfig(cfg)).toThrow(ConfigError);

      cfg.pageSize = 200000;
      expect(() => validateConfig(cfg)).toThrow(ConfigError);
    });
  });

  describe('getAddress', () => {
    it('should format IPv4 address', () => {
      const cfg = defaultConfig();
      cfg.host = '127.0.0.1';
      cfg.port = 3141;

      expect(getAddress(cfg)).toBe('127.0.0.1:3141');
    });

    it('should format hostname', () => {
      const cfg = defaultConfig();
      cfg.host = 'localhost';
      cfg.port = 8443;

      expect(getAddress(cfg)).toBe('localhost:8443');
    });

    it('should format IPv6 address with brackets', () => {
      const cfg = defaultConfig();
      cfg.host = '::1';
      cfg.port = 3141;

      expect(getAddress(cfg)).toBe('[::1]:3141');
    });
  });

  describe('cloneConfig', () => {
    it('should create independent copy', () => {
      const cfg = defaultConfig();
      cfg.host = 'original';

      const clone = cloneConfig(cfg);
      clone.host = 'cloned';

      expect(cfg.host).toBe('original');
      expect(clone.host).toBe('cloned');
    });
  });
});
