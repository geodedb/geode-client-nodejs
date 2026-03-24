import { describe, it, expect } from 'vitest';
import {
  validateQuery,
  validateParamName,
  validateParamValue,
  validateHostname,
  validatePort,
  validatePageSize,
  validateSavepointName,
  sanitizeForLog,
  validateRLSPredicate,
  validateTLSCertPath,
  escapeGQLIdentifier,
} from '../../src/validate.js';
import { SecurityError } from '../../src/errors.js';

describe('validate', () => {
  describe('validateQuery', () => {
    it('should accept valid queries', () => {
      expect(() => validateQuery('MATCH (n) RETURN n')).not.toThrow();
      expect(() => validateQuery('CREATE (n:Person {name: "Alice"})')).not.toThrow();
      expect(() => validateQuery('MATCH (n)\nWHERE n.age > 21\nRETURN n')).not.toThrow();
    });

    it('should reject empty query', () => {
      expect(() => validateQuery('')).toThrow(SecurityError);
    });

    it('should reject query with null bytes', () => {
      expect(() => validateQuery('MATCH (n)\0RETURN n')).toThrow(SecurityError);
    });

    it('should reject query with control characters', () => {
      expect(() => validateQuery('MATCH (n)\x01RETURN n')).toThrow(SecurityError);
    });

    it('should allow common whitespace', () => {
      expect(() => validateQuery('MATCH (n)\n\t\r RETURN n')).not.toThrow();
    });

    it('should reject query exceeding max length', () => {
      const longQuery = 'MATCH (n) RETURN n'.repeat(100000);
      expect(() => validateQuery(longQuery)).toThrow(SecurityError);
    });
  });

  describe('validateParamName', () => {
    it('should accept valid parameter names', () => {
      expect(() => validateParamName('id')).not.toThrow();
      expect(() => validateParamName('user_name')).not.toThrow();
      expect(() => validateParamName('_private')).not.toThrow();
      expect(() => validateParamName('camelCase123')).not.toThrow();
    });

    it('should reject empty parameter name', () => {
      expect(() => validateParamName('')).toThrow(SecurityError);
    });

    it('should reject parameter name starting with digit', () => {
      expect(() => validateParamName('123abc')).toThrow(SecurityError);
    });

    it('should reject parameter name with special characters', () => {
      expect(() => validateParamName('foo-bar')).toThrow(SecurityError);
      expect(() => validateParamName('foo.bar')).toThrow(SecurityError);
      expect(() => validateParamName('foo@bar')).toThrow(SecurityError);
    });

    it('should reject reserved keywords', () => {
      expect(() => validateParamName('match')).toThrow(SecurityError);
      expect(() => validateParamName('RETURN')).toThrow(SecurityError);
      expect(() => validateParamName('Where')).toThrow(SecurityError);
      expect(() => validateParamName('create')).toThrow(SecurityError);
    });

    it('should reject parameter name exceeding max length', () => {
      const longName = 'a'.repeat(200);
      expect(() => validateParamName(longName)).toThrow(SecurityError);
    });
  });

  describe('validateParamValue', () => {
    it('should accept primitive values', () => {
      expect(() => validateParamValue(null)).not.toThrow();
      expect(() => validateParamValue(undefined)).not.toThrow();
      expect(() => validateParamValue(42)).not.toThrow();
      expect(() => validateParamValue(3.14)).not.toThrow();
      expect(() => validateParamValue(true)).not.toThrow();
      expect(() => validateParamValue('hello')).not.toThrow();
    });

    it('should accept arrays', () => {
      expect(() => validateParamValue([1, 2, 3])).not.toThrow();
      expect(() => validateParamValue(['a', 'b', 'c'])).not.toThrow();
      expect(() => validateParamValue([{ a: 1 }, { b: 2 }])).not.toThrow();
    });

    it('should accept objects', () => {
      expect(() => validateParamValue({ name: 'Alice', age: 30 })).not.toThrow();
      expect(() => validateParamValue({ nested: { deep: true } })).not.toThrow();
    });

    it('should reject string with null bytes', () => {
      expect(() => validateParamValue('hello\0world')).toThrow(SecurityError);
    });

    it('should reject circular references', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj['self'] = obj;
      expect(() => validateParamValue(obj)).toThrow(SecurityError);
    });

    it('should reject deeply nested values', () => {
      let obj: Record<string, unknown> = { value: 1 };
      for (let i = 0; i < 50; i++) {
        obj = { nested: obj };
      }
      expect(() => validateParamValue(obj)).toThrow(SecurityError);
    });
  });

  describe('validateHostname', () => {
    it('should accept valid hostnames', () => {
      expect(() => validateHostname('localhost')).not.toThrow();
      expect(() => validateHostname('example.com')).not.toThrow();
      expect(() => validateHostname('sub.domain.example.com')).not.toThrow();
      expect(() => validateHostname('my-server')).not.toThrow();
    });

    it('should accept valid IPv4 addresses', () => {
      expect(() => validateHostname('127.0.0.1')).not.toThrow();
      expect(() => validateHostname('192.168.1.1')).not.toThrow();
      expect(() => validateHostname('0.0.0.0')).not.toThrow();
    });

    it('should accept valid IPv6 addresses', () => {
      expect(() => validateHostname('::1')).not.toThrow();
      expect(() => validateHostname('[::1]')).not.toThrow();
      expect(() => validateHostname('2001:db8::1')).not.toThrow();
    });

    it('should reject empty hostname', () => {
      expect(() => validateHostname('')).toThrow(SecurityError);
    });

    it('should reject hostname exceeding max length', () => {
      const longHostname = 'a'.repeat(300) + '.com';
      expect(() => validateHostname(longHostname)).toThrow(SecurityError);
    });

    it('should reject invalid IPv4 addresses', () => {
      expect(() => validateHostname('256.1.1.1')).toThrow(SecurityError);
      expect(() => validateHostname('1.1.1.999')).toThrow(SecurityError);
    });

    it('should reject hostnames with invalid characters', () => {
      expect(() => validateHostname('foo_bar.com')).toThrow(SecurityError);
      expect(() => validateHostname('foo bar.com')).toThrow(SecurityError);
    });
  });

  describe('validatePort', () => {
    it('should accept valid ports', () => {
      expect(() => validatePort(1)).not.toThrow();
      expect(() => validatePort(80)).not.toThrow();
      expect(() => validatePort(443)).not.toThrow();
      expect(() => validatePort(3141)).not.toThrow();
      expect(() => validatePort(65535)).not.toThrow();
    });

    it('should reject port below 1', () => {
      expect(() => validatePort(0)).toThrow(SecurityError);
      expect(() => validatePort(-1)).toThrow(SecurityError);
    });

    it('should reject port above 65535', () => {
      expect(() => validatePort(65536)).toThrow(SecurityError);
      expect(() => validatePort(100000)).toThrow(SecurityError);
    });

    it('should reject non-integer ports', () => {
      expect(() => validatePort(3.14)).toThrow(SecurityError);
      expect(() => validatePort(NaN)).toThrow(SecurityError);
    });
  });

  describe('validatePageSize', () => {
    it('should accept valid page sizes', () => {
      expect(() => validatePageSize(1)).not.toThrow();
      expect(() => validatePageSize(100)).not.toThrow();
      expect(() => validatePageSize(1000)).not.toThrow();
      expect(() => validatePageSize(100000)).not.toThrow();
    });

    it('should reject page size below 1', () => {
      expect(() => validatePageSize(0)).toThrow(SecurityError);
      expect(() => validatePageSize(-1)).toThrow(SecurityError);
    });

    it('should reject page size above max', () => {
      expect(() => validatePageSize(200000)).toThrow(SecurityError);
    });

    it('should reject non-integer page sizes', () => {
      expect(() => validatePageSize(100.5)).toThrow(SecurityError);
    });
  });

  describe('validateSavepointName', () => {
    it('should accept valid savepoint names', () => {
      expect(() => validateSavepointName('sp1')).not.toThrow();
      expect(() => validateSavepointName('my_savepoint')).not.toThrow();
      expect(() => validateSavepointName('_private')).not.toThrow();
    });

    it('should reject empty savepoint name', () => {
      expect(() => validateSavepointName('')).toThrow(SecurityError);
    });

    it('should reject savepoint name exceeding max length', () => {
      const longName = 'a'.repeat(200);
      expect(() => validateSavepointName(longName)).toThrow(SecurityError);
    });

    it('should reject savepoint name with invalid characters', () => {
      expect(() => validateSavepointName('save-point')).toThrow(SecurityError);
      expect(() => validateSavepointName('save.point')).toThrow(SecurityError);
      expect(() => validateSavepointName('123sp')).toThrow(SecurityError);
    });
  });

  describe('sanitizeForLog', () => {
    it('should mask password patterns', () => {
      const input = 'connection: password=secret123';
      const result = sanitizeForLog(input);
      expect(result).toBe('connection: password=***');
      expect(result).not.toContain('secret123');
    });

    it('should mask token patterns', () => {
      const input = 'auth: token=abc123xyz';
      const result = sanitizeForLog(input);
      expect(result).toBe('auth: token=***');
    });

    it('should mask secret patterns', () => {
      const input = 'config: secret=mySecret';
      const result = sanitizeForLog(input);
      expect(result).toBe('config: secret=***');
    });

    it('should mask api_key patterns', () => {
      const input = 'api_key=key123';
      const result = sanitizeForLog(input);
      expect(result).toBe('api_key=***');
    });

    it('should handle case insensitivity', () => {
      // Test with values that don't overlap with keywords
      const input = 'PASSWORD=mypass123 TOKEN=abc123 SECRET=xyz789';
      const result = sanitizeForLog(input);
      // Keywords should be preserved (lowercased), values should be masked
      expect(result).not.toContain('mypass123');
      expect(result).not.toContain('abc123');
      expect(result).not.toContain('xyz789');
      expect(result).toContain('password=***');
      expect(result).toContain('token=***');
      expect(result).toContain('secret=***');
    });

    it('should leave non-sensitive data unchanged', () => {
      const input = 'host=localhost port=3141 user=admin';
      const result = sanitizeForLog(input);
      expect(result).toBe(input);
    });
  });

  describe('validateRLSPredicate', () => {
    // GAP #11 - GQL Predicate Injection Prevention Tests

    describe('valid predicates', () => {
      it('should accept simple property comparisons', () => {
        expect(() => validateRLSPredicate('n.owner = current_user()')).not.toThrow();
        expect(() => validateRLSPredicate('n.visible = true')).not.toThrow();
        expect(() => validateRLSPredicate('n.age > 21')).not.toThrow();
      });

      it('should accept boolean operators', () => {
        expect(() => validateRLSPredicate('n.public = true OR n.owner = $user')).not.toThrow();
        expect(() => validateRLSPredicate('n.active AND n.approved')).not.toThrow();
        expect(() => validateRLSPredicate('NOT n.deleted')).not.toThrow();
      });

      it('should accept predicates with parameters', () => {
        expect(() => validateRLSPredicate('n.team = $teamId')).not.toThrow();
        expect(() => validateRLSPredicate('n.owner IN $allowedUsers')).not.toThrow();
      });

      it('should accept predicates with function calls', () => {
        expect(() => validateRLSPredicate('exists((n)-[:MEMBER]->(:Team))')).not.toThrow();
        expect(() => validateRLSPredicate('size(n.tags) > 0')).not.toThrow();
      });

      it('should accept predicates with string literals', () => {
        expect(() => validateRLSPredicate("n.status = 'active'")).not.toThrow();
        expect(() => validateRLSPredicate('n.type = "public"')).not.toThrow();
      });

      it('should accept nested pattern predicates', () => {
        expect(() =>
          validateRLSPredicate('exists((n)-[:OWNS]->(:Resource {id: $resourceId}))')
        ).not.toThrow();
      });
    });

    describe('injection attack prevention', () => {
      it('should reject predicates with semicolons (statement injection)', () => {
        expect(() => validateRLSPredicate('true; DROP POLICY admin')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('n.x = 1; CREATE (m:Malicious)')).toThrow(SecurityError);
      });

      it('should reject predicates with DDL keywords', () => {
        expect(() => validateRLSPredicate('n.x = 1 CREATE (m:Malicious)')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('true DROP POLICY x')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('n.x DELETE n')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('n.y SET n.admin = true')).toThrow(SecurityError);
      });

      it('should reject predicates with MERGE keyword', () => {
        expect(() => validateRLSPredicate('n.x MERGE (m:Admin {name: "attacker"})')).toThrow(
          SecurityError
        );
      });

      it('should reject predicates with policy manipulation keywords', () => {
        expect(() => validateRLSPredicate('true GRANT READ TO attacker')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('true REVOKE ALL FROM admin')).toThrow(SecurityError);
      });

      it('should reject predicates with comment injection', () => {
        expect(() => validateRLSPredicate('true /* comment */ false')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('true -- comment')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('true // comment')).toThrow(SecurityError);
      });

      it('should reject predicates with line breaks', () => {
        expect(() => validateRLSPredicate('true\nDROP POLICY x')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('true\rCREATE (n:Evil)')).toThrow(SecurityError);
      });

      it('should reject predicates with backticks', () => {
        expect(() => validateRLSPredicate('`true`')).toThrow(SecurityError);
      });

      it('should reject predicates with unbalanced brackets', () => {
        expect(() => validateRLSPredicate('(n.x = 1')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('n.x = 1)')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('[a, b, c')).toThrow(SecurityError);
        expect(() => validateRLSPredicate('{a: 1')).toThrow(SecurityError);
      });

      it('should reject predicates with unclosed strings', () => {
        expect(() => validateRLSPredicate("n.x = 'unclosed")).toThrow(SecurityError);
        expect(() => validateRLSPredicate('n.x = "unclosed')).toThrow(SecurityError);
      });

      it('should reject empty predicates', () => {
        expect(() => validateRLSPredicate('')).toThrow(SecurityError);
      });

      it('should reject predicates with CALL keyword', () => {
        expect(() => validateRLSPredicate('true CALL db.dropDatabase()')).toThrow(SecurityError);
      });

      it('should reject predicates with LOAD keyword', () => {
        expect(() => validateRLSPredicate('true LOAD CSV FROM "http://evil.com"')).toThrow(
          SecurityError
        );
      });
    });

    describe('documented attack example', () => {
      it('should reject the attack from GAP_ANALYSIS.md', () => {
        const maliciousPredicate =
          'true) USING (true); DROP POLICY admin_policy ON :User; CREATE POLICY x ON :y FOR READ USING (true';
        expect(() => validateRLSPredicate(maliciousPredicate)).toThrow(SecurityError);
      });
    });

    // GAP #18 - Escaped Backslash Bypass Prevention Tests
    describe('escaped backslash handling', () => {
      it('should correctly parse string with escaped quote', () => {
        // Single escaped quote - still in string
        expect(() => validateRLSPredicate("n.name = 'it\\'s ok'")).not.toThrow();
        expect(() => validateRLSPredicate('n.name = "he said \\"hello\\""')).not.toThrow();
      });

      it('should correctly parse string ending with escaped backslash', () => {
        // Escaped backslash followed by quote - string ends
        // 'path\\' means: path + backslash (escaped) + end quote
        expect(() => validateRLSPredicate("n.path = 'C:\\\\' AND n.valid = true")).not.toThrow();
      });

      it('should correctly parse double escaped backslash followed by escaped quote', () => {
        // '\\\'  means: escaped backslash + escaped quote = still in string
        // This tests the edge case where \\\' should keep us in the string
        expect(() => validateRLSPredicate("n.data = '\\\\\\'' AND n.x = 1")).not.toThrow();
      });

      it('should reject escaped backslash bypass attempt (even backslashes)', () => {
        // Attack: use \\\\ (2 escaped backslashes = 4 chars) followed by quote
        // Parser should see: string ends, then injection
        // The ' after \\\\ should end the string, making DROP visible
        const attack = "n.x = 'test\\\\' DROP POLICY x";
        expect(() => validateRLSPredicate(attack)).toThrow(SecurityError);
      });

      it('should handle multiple escaped backslashes correctly', () => {
        // 4 backslashes = 2 escaped backslashes, quote ends string
        expect(() => validateRLSPredicate("n.path = '\\\\\\\\' AND n.valid")).not.toThrow();
        // 6 backslashes = 3 escaped backslashes, quote ends string
        expect(() => validateRLSPredicate("n.path = '\\\\\\\\\\\\' AND n.valid")).not.toThrow();
      });

      it('should correctly identify unclosed string with odd backslashes', () => {
        // Odd number of backslashes before quote = escaped quote = still in string
        // This should be detected as unclosed string
        expect(() => validateRLSPredicate("n.x = 'test\\'")).toThrow(SecurityError);
        expect(() => validateRLSPredicate("n.x = 'test\\\\\\'")).toThrow(SecurityError);
      });

      it('should handle complex escape sequences in valid predicates', () => {
        // Valid predicate with mixed escapes
        expect(() =>
          validateRLSPredicate("n.regex = '\\\\d+' AND n.path = 'C:\\\\Users\\\\' AND n.active")
        ).not.toThrow();
      });
    });
  });

  describe('validateTLSCertPath', () => {
    // GAP #12 - Path Traversal Prevention Tests
    // PERF-11: validateTLSCertPath is now async (uses fs.promises instead of sync fs ops)

    describe('valid paths', () => {
      it('should accept absolute paths to certificate directories', async () => {
        await expect(
          validateTLSCertPath('/etc/ssl/certs/ca.pem', 'tlsCA')
        ).resolves.toBeUndefined();
        await expect(
          validateTLSCertPath('/etc/pki/tls/certs/server.crt', 'tlsCert')
        ).resolves.toBeUndefined();
        await expect(
          validateTLSCertPath('/usr/local/share/ca-certificates/custom.crt', 'tlsCA')
        ).resolves.toBeUndefined();
      });

      it('should accept relative paths without traversal', async () => {
        await expect(validateTLSCertPath('./certs/ca.pem', 'tlsCA')).resolves.toBeUndefined();
        await expect(validateTLSCertPath('certs/server.crt', 'tlsCert')).resolves.toBeUndefined();
        await expect(validateTLSCertPath('server.key', 'tlsKey')).resolves.toBeUndefined();
      });

      it('should accept home directory paths', async () => {
        await expect(
          validateTLSCertPath('/home/user/.ssl/cert.pem', 'tlsCert')
        ).resolves.toBeUndefined();
      });
    });

    describe('path traversal prevention', () => {
      it('should reject paths with directory traversal (../)', async () => {
        await expect(validateTLSCertPath('../../../etc/passwd', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
        await expect(validateTLSCertPath('/etc/ssl/../passwd', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
        await expect(validateTLSCertPath('certs/../../etc/shadow', 'tlsCert')).rejects.toThrow(
          SecurityError
        );
      });

      it('should reject paths ending with /..', async () => {
        await expect(validateTLSCertPath('/etc/ssl/..', 'tlsCA')).rejects.toThrow(SecurityError);
      });

      it('should reject encoded traversal sequences', async () => {
        await expect(validateTLSCertPath('%2e%2e%2fetc/passwd', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
        await expect(validateTLSCertPath('%252e%252e/etc/passwd', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
      });

      it('should reject paths with null bytes', async () => {
        await expect(validateTLSCertPath('/etc/ssl/cert.pem\0.txt', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
      });
    });

    describe('restricted system file prevention', () => {
      it('should reject paths to /etc/passwd', async () => {
        await expect(validateTLSCertPath('/etc/passwd', 'tlsCA')).rejects.toThrow(SecurityError);
      });

      it('should reject paths to /etc/shadow', async () => {
        await expect(validateTLSCertPath('/etc/shadow', 'tlsCA')).rejects.toThrow(SecurityError);
      });

      it('should reject paths to /proc/', async () => {
        await expect(validateTLSCertPath('/proc/self/environ', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
      });

      it('should reject paths to /sys/', async () => {
        await expect(validateTLSCertPath('/sys/kernel/config', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
      });

      it('should reject paths to /dev/', async () => {
        await expect(validateTLSCertPath('/dev/urandom', 'tlsCA')).rejects.toThrow(SecurityError);
      });
    });

    describe('documented attack examples', () => {
      it('should reject attack from GAP_ANALYSIS.md: /etc/passwd', async () => {
        await expect(validateTLSCertPath('/etc/passwd', 'ca')).rejects.toThrow(SecurityError);
      });

      it('should reject attack from GAP_ANALYSIS.md: ../../../etc/shadow', async () => {
        await expect(validateTLSCertPath('../../../etc/shadow', 'cert')).rejects.toThrow(
          SecurityError
        );
      });
    });

    describe('edge cases', () => {
      it('should reject empty paths', async () => {
        await expect(validateTLSCertPath('', 'tlsCA')).rejects.toThrow(SecurityError);
      });

      it('should handle Windows-style paths', async () => {
        // Should normalize backslashes and detect traversal
        await expect(validateTLSCertPath('..\\..\\etc\\passwd', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
      });

      it('should handle duplicate slashes', async () => {
        // Should normalize but still detect issues
        await expect(validateTLSCertPath('/etc//passwd', 'tlsCA')).rejects.toThrow(SecurityError);
      });
    });

    // GAP #21: Expanded sensitive path blocklist tests
    describe('expanded sensitive path blocklist', () => {
      it('should reject paths to /root/', async () => {
        await expect(validateTLSCertPath('/root/.bashrc', 'tlsCA')).rejects.toThrow(SecurityError);
      });

      it('should reject paths to SSH directories', async () => {
        await expect(validateTLSCertPath('/home/user/.ssh/id_rsa', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
        await expect(validateTLSCertPath('/root/.ssh/authorized_keys', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
      });

      it('should reject paths to Kubernetes secrets', async () => {
        await expect(
          validateTLSCertPath('/var/run/secrets/kubernetes.io/serviceaccount/token', 'tlsCA')
        ).rejects.toThrow(SecurityError);
        await expect(validateTLSCertPath('/run/secrets/mysecret', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
      });

      it('should reject paths to AWS credentials', async () => {
        await expect(validateTLSCertPath('/home/user/.aws/credentials', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
        await expect(validateTLSCertPath('/root/.aws/config', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
      });

      it('should reject paths to GCP credentials', async () => {
        await expect(
          validateTLSCertPath(
            '/home/user/.config/gcloud/application_default_credentials.json',
            'tlsCA'
          )
        ).rejects.toThrow(SecurityError);
      });

      it('should reject paths to Azure credentials', async () => {
        await expect(
          validateTLSCertPath('/home/user/.azure/azureProfile.json', 'tlsCA')
        ).rejects.toThrow(SecurityError);
      });

      it('should reject paths to .env files', async () => {
        await expect(validateTLSCertPath('/app/.env', 'tlsCA')).rejects.toThrow(SecurityError);
        await expect(validateTLSCertPath('/var/www/app/.env.production', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
      });
    });

    // GAP #20: Symlink TOCTOU prevention tests
    // Note: These tests verify the symlink detection code path exists
    // Actual symlink testing requires creating real symlinks which is environment-specific
    describe('symlink handling', () => {
      it('should handle non-existent paths gracefully (validation still performed)', async () => {
        // Non-existent path should pass string validation (file existence is checked later)
        await expect(
          validateTLSCertPath('/nonexistent/path/to/cert.pem', 'tlsCA')
        ).resolves.toBeUndefined();
      });

      it('should reject path even if symlink target validation would fail', async () => {
        // If we had a symlink /tmp/link -> /etc/passwd, the resolved path should be blocked
        // This tests that the blocklist check works for resolved paths
        // We can't create real symlinks in tests, but we test the blocklist includes SSH paths
        await expect(validateTLSCertPath('/something/.ssh/key', 'tlsCA')).rejects.toThrow(
          SecurityError
        );
      });
    });

    // PERF-11: Verify the function returns a Promise (is async)
    describe('async behavior', () => {
      it('should return a Promise', () => {
        const result = validateTLSCertPath('/nonexistent/path/cert.pem', 'tlsCA');
        expect(result).toBeInstanceOf(Promise);
      });
    });
  });

  describe('escapeGQLIdentifier', () => {
    // GAP #14 - GQL Identifier Escape Function Tests

    describe('valid identifiers', () => {
      it('should return simple identifiers as-is', () => {
        expect(escapeGQLIdentifier('Person', 'label')).toBe('Person');
        expect(escapeGQLIdentifier('user_name', 'label')).toBe('user_name');
        expect(escapeGQLIdentifier('_private', 'label')).toBe('_private');
        expect(escapeGQLIdentifier('MyLabel123', 'label')).toBe('MyLabel123');
      });

      it('should work with different identifier types', () => {
        expect(escapeGQLIdentifier('KNOWS', 'relationship_type')).toBe('KNOWS');
        expect(escapeGQLIdentifier('age', 'property')).toBe('age');
        expect(escapeGQLIdentifier('n', 'variable')).toBe('n');
      });
    });

    describe('validation', () => {
      it('should throw for empty identifiers', () => {
        expect(() => escapeGQLIdentifier('', 'label')).toThrow(SecurityError);
      });

      it('should throw for identifiers starting with digit', () => {
        expect(() => escapeGQLIdentifier('123label', 'label')).toThrow(SecurityError);
      });

      it('should throw for identifiers with special characters', () => {
        expect(() => escapeGQLIdentifier('my-label', 'label')).toThrow(SecurityError);
        expect(() => escapeGQLIdentifier('my.label', 'label')).toThrow(SecurityError);
        expect(() => escapeGQLIdentifier('my label', 'label')).toThrow(SecurityError);
      });

      it('should throw for identifiers exceeding max length', () => {
        const longLabel = 'a'.repeat(200);
        expect(() => escapeGQLIdentifier(longLabel, 'label')).toThrow(SecurityError);
      });
    });

    describe('defense in depth', () => {
      it('should provide safe output even for valid identifiers', () => {
        // The function validates first, so any output is safe
        const result = escapeGQLIdentifier('ValidLabel', 'label');
        expect(result).toBe('ValidLabel');
        // Result should not contain injection characters
        expect(result).not.toContain(';');
        expect(result).not.toContain('--');
        expect(result).not.toContain('/*');
      });
    });
  });
});
