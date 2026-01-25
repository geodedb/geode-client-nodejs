/**
 * Validation Benchmarks
 *
 * Measures performance of input validation functions.
 */

import { describe, bench } from 'vitest';
import {
  validateQuery,
  validateParamName,
  validateParamValue,
  validateHostname,
  validatePort,
  validatePageSize,
  validateSavepointName,
  sanitizeForLog,
} from '../../src/validate.js';

// Test fixtures
const shortQuery = 'MATCH (n) RETURN n';
const mediumQuery = `
MATCH (a:Person)-[:KNOWS]->(b:Person)-[:WORKS_AT]->(c:Company)
WHERE a.age > 21 AND b.name CONTAINS 'Alice'
WITH a, b, c, count(*) AS cnt
ORDER BY cnt DESC
LIMIT 100
RETURN a.name AS person, collect(b.name) AS friends, c.name AS company
`;
const longQuery = 'MATCH (n) RETURN n '.repeat(1000);

const simpleValue = { name: 'Alice', age: 30, active: true };
const nestedValue = {
  user: {
    profile: {
      name: 'Alice',
      settings: {
        theme: 'dark',
        notifications: {
          email: true,
          push: false,
        },
      },
    },
  },
  metadata: {
    created: '2024-01-15',
    tags: ['developer', 'admin'],
  },
};
const arrayValue = Array.from({ length: 100 }, (_, i) => ({
  id: i,
  name: `Item ${i}`,
  value: i * 10,
}));

const logWithSensitive =
  'connecting to geode://localhost:3141 with password=secret123 and token=abc123xyz api_key=key999';

describe('Validation Benchmarks', () => {
  describe('Query Validation', () => {
    bench('validate short query', () => {
      validateQuery(shortQuery);
    });

    bench('validate medium query', () => {
      validateQuery(mediumQuery);
    });

    bench('validate long query', () => {
      validateQuery(longQuery);
    });

    bench('validate query with string literals', () => {
      validateQuery("MATCH (n) WHERE n.name = 'hello world' RETURN n");
    });
  });

  describe('Parameter Name Validation', () => {
    bench('validate simple name', () => {
      validateParamName('id');
    });

    bench('validate longer name', () => {
      validateParamName('user_profile_id');
    });

    bench('validate max length name', () => {
      validateParamName('a'.repeat(128));
    });

    bench('validate camelCase name', () => {
      validateParamName('userProfileSettings');
    });
  });

  describe('Parameter Value Validation', () => {
    bench('validate null', () => {
      validateParamValue(null);
    });

    bench('validate primitive', () => {
      validateParamValue(42);
    });

    bench('validate string', () => {
      validateParamValue('hello world');
    });

    bench('validate simple object', () => {
      validateParamValue(simpleValue);
    });

    bench('validate nested object', () => {
      validateParamValue(nestedValue);
    });

    bench('validate array (100 elements)', () => {
      validateParamValue(arrayValue);
    });
  });

  describe('Hostname Validation', () => {
    bench('validate localhost', () => {
      validateHostname('localhost');
    });

    bench('validate domain', () => {
      validateHostname('example.com');
    });

    bench('validate subdomain', () => {
      validateHostname('api.staging.example.com');
    });

    bench('validate IPv4', () => {
      validateHostname('192.168.1.1');
    });

    bench('validate IPv6', () => {
      validateHostname('::1');
    });

    bench('validate bracketed IPv6', () => {
      validateHostname('[2001:db8::1]');
    });
  });

  describe('Port Validation', () => {
    bench('validate port', () => {
      validatePort(3141);
    });

    bench('validate min port', () => {
      validatePort(1);
    });

    bench('validate max port', () => {
      validatePort(65535);
    });
  });

  describe('Page Size Validation', () => {
    bench('validate default page size', () => {
      validatePageSize(1000);
    });

    bench('validate large page size', () => {
      validatePageSize(100000);
    });
  });

  describe('Savepoint Name Validation', () => {
    bench('validate short name', () => {
      validateSavepointName('sp1');
    });

    bench('validate longer name', () => {
      validateSavepointName('before_critical_operation');
    });
  });

  describe('Log Sanitization', () => {
    bench('sanitize log with sensitive data', () => {
      sanitizeForLog(logWithSensitive);
    });

    bench('sanitize clean log', () => {
      sanitizeForLog('connecting to geode://localhost:3141 as user admin');
    });

    bench('sanitize long log', () => {
      sanitizeForLog(logWithSensitive.repeat(10));
    });
  });
});
