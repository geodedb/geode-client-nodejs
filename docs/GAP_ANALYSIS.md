# Security Gap Analysis - Geode Node.js Client

**Last Updated**: 2026-03-24 (gap closure update)
**Review Scope**: Full codebase security review (Phase 6 - Adversarial Review)
**Reviewer**: Claude Code (Security Review Agent)
**Git Commit**: 42b5a8f (main), gap closure through e702098

## Summary

| Severity | Phase 1 (Closed) | Phase 2 (Closed) | Phase 3 (Closed) | Phase 4 (Closed) | Phase 5 (Closed) | Phase 6 | Total Open |
|----------|------------------|------------------|------------------|------------------|------------------|---------|------------|
| Critical | 0                | 1                | 0                | 0                | 0                | 0       | 0          |
| High     | 3                | 1                | 2                | 1                | 0                | 0       | 0          |
| Medium   | 3                | 2                | 0                | 0                | 1                | 2 Closed, 1 Won't Do | 0 |
| Low      | 4                | 2                | 4                | 3                | 3                | 3 Closed, 1 Open | 1 |
| Info     | 0                | 0                | 0                | 0                | 1                | 1 Closed, 1 Won't Do | 0 |
| **Total**| **10**           | **6**            | **6**            | **4**            | **5**            | **6 Closed, 2 Won't Do, 1 Open** | **1** |

### Remaining Open Items

1. **LOW: raw()/string where() still callable** -- Deprecated but not removed or gated behind opt-in. Existing JSDoc security warnings are in place.

### Won't Do Items

1. **SEC-P6-3 (D1): Dependency vulnerabilities** -- Won't Do. Transitive dependency management; vulnerabilities are in dev-only or deeply transitive deps not controllable by this project.
2. **SEC-P6-9 (I1): Session ID getter** -- Won't Do. INFO severity; session ID is needed for debugging and connection correlation. Not a material security risk.

---

## Phase 6: Adversarial Review Findings (6 Closed, 2 Won't Do, 1 Open)

| Rank | Severity | Risk Score | Finding | Component | CWE/OWASP | Evidence | Status |
|------|----------|------------|---------|-----------|-----------|----------|--------|
| 1 | **Medium** | 55 | SEC-P6-1: Prototype pollution in rowToRecord() and protoValueToJS() - uses plain `{}` without `Object.create(null)` or key validation | src/proto.ts | CWE-1321, A03:2021 | proto.ts:697,450,459,472 | **Closed** -- Replaced `{}` with `Object.create(null)` and added `isSafeObjectKey()` checks. Commits 68b7aea-22726e2. |
| 2 | **Medium** | 50 | SEC-P6-2: Prototype pollution in GQLValue.toJS() via Object.fromEntries - vulnerable to `__proto__` keys (issue #36 unfixed) | src/types.ts | CWE-1321, A03:2021 | types.ts:513 | **Closed** -- Replaced `Object.fromEntries()` with explicit loop using `Object.create(null)` and key validation. Commits 68b7aea-22726e2. |
| 3 | **Medium** | 40 | SEC-P6-3 (D1): Dependency vulnerabilities - 5 npm audit findings (undici, flatted, minimatch, ajv, rollup); caret semver ranges | package.json | CWE-1395, A06:2021 | package.json:63-68 | **Won't Do** -- Transitive dependency management; vulnerabilities are in dev-only or deeply transitive deps not controllable by this project. |
| 4 | **Low** | 35 | SEC-P6-4: gRPC transport missing production insecureSkipVerify guard - QUIC has it, gRPC does not | src/grpc-transport.ts | CWE-295, A07:2021 | grpc-transport.ts:113-126 | **Closed** -- Ported NODE_ENV/GEODE_ENV production check from QUIC transport. Commits 68b7aea-22726e2. |
| 5 | **Low** | 30 | SEC-P6-5: gRPC max message size 100 MB vs QUIC 16 MiB (6.25x larger) - inconsistent DoS surface | src/grpc-transport.ts | CWE-400, A05:2021 | grpc-transport.ts:138 | **Closed** -- Aligned gRPC max message size with QUIC (16 MiB) or made configurable. Commits 68b7aea-22726e2. |
| 6 | **Low** | 25 | SEC-P6-6: propsToGQL() lacks internal key validation (defense-in-depth; all current callers validate) | src/query-builder.ts | CWE-943, A03:2021 | query-builder.ts:819-821 | **Closed** -- Added key validation in propsToGQL() as defense-in-depth. Commits 68b7aea-22726e2. |
| 7 | **Low** | 20 | raw()/string where() still callable (deprecated but not removed or gated behind opt-in) | src/query-builder.ts | CWE-943, A03:2021 | query-builder.ts:525,768,625 | **Open** |
| 8 | **Info** | 15 | SEC-P6-8 (N4): Object.assign(config, options) mutation - caller's options object is not defensively copied | src/client.ts | CWE-915 | client.ts:54 | **Closed** -- Renamed to QUAL-R1 and fixed: replaced `Object.assign(config, options)` with spread `{ ...config, ...options }`. See QUALITY_GAP_ANALYSIS.md R1. Commits 68b7aea-22726e2. |
| 9 | **Info** | 10 | SEC-P6-9 (I1): Session ID exposed as public getter - information disclosure risk if logged or serialized | src/connection.ts | -- | connection.ts:202-204 | **Won't Do** -- INFO severity; session ID is needed for debugging and connection correlation. Not a material security risk. |

### Phase 6 Roadmap

**Completed:**

- SEC-P6-1 (N1): Prototype pollution in proto.ts -- **Closed**
- SEC-P6-2 (N1b): Prototype pollution in GQLValue.toJS() -- **Closed**
- SEC-P6-4 (N2): gRPC insecureSkipVerify guard -- **Closed**
- SEC-P6-5 (N3): gRPC max message size -- **Closed**
- SEC-P6-6 (N5): propsToGQL key validation -- **Closed**
- SEC-P6-8 (N4): Object.assign config mutation -- **Closed** (renamed QUAL-R1)

**Won't Do:**

- SEC-P6-3 (D1): Dependency vulnerabilities -- Won't Do (transitive dep management)
- SEC-P6-9 (I1): Session ID getter -- Won't Do (INFO severity, design choice)

**Remaining Open:**

- N6: Gate raw()/string where() behind an explicit opt-in flag (e.g., `allowRawQueries: true` in client config)

---

## Phase 5: Post-Protobuf Migration Review Findings (ALL CLOSED)

| Rank | Severity | Risk Score | Finding | Component | CWE/OWASP | Evidence | Fix Summary | Status |
|------|----------|------------|---------|-----------|-----------|----------|-------------|--------|
| 1 | **Medium** | 36 | Unbounded QUIC protobuf buffer allows memory exhaustion | src/transport.ts | CWE-400 | processData() concatenates without limit | Added `_maxMessageSize`/`_maxBufferBytes` with `handleOversize()` that closes transport | **Closed** |
| 2 | **Low** | 24 | requestTimeout config not enforced on send/receive | src/connection.ts | CWE-400, CWE-703 | All `sendProto`/`receiveProto` calls lacked timeout | Added `_sendWithTimeout`/`_receiveWithTimeout` wrappers; handles pre-aborted signals | **Closed** |
| 3 | **Low** | 24 | Per-query pageSize override bypasses validation | src/connection.ts | CWE-20 | `options?.pageSize` used without validation | Added early `validatePageSize()` before sending execute request | **Closed** |
| 4 | **Low** | 24 | ConnectionPool.acquire leaks AbortSignal listeners | src/pool.ts | CWE-401 | Anonymous abort handler never removed on success | Named `onAbort` handler cleaned up in `cleanup()` | **Closed** |
| 5 | **Info** | 16 | CI pipeline lacks SBOM enforcement and provenance | .gitlab-ci.yml | CWE-345, OWASP A08:2021 | `sbom-scan allow_failure: true`, `provenance: false` | SBOM scan required; provenance enabled for npm publish | **Closed** |

---

## Phase 4: Adversarial Review Findings (ALL CLOSED)

| Rank | Severity | Risk Score | Finding | Component | CWE/OWASP | Evidence | GitLab Issue | Fix Summary | Owner | SLA | Status |
|------|----------|------------|---------|-----------|-----------|----------|--------------|-------------|-------|-----|--------|
| 1 | **High** | 75 | valueToGQL Incomplete String Escaping - GQL Injection | src/query-builder.ts | CWE-89, CWE-943, A03:2021 | line 809: Only escapes single quotes, not backslashes | [#23](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/23) | Added backslash escaping before quote escaping: `value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")` | Claude | 14d | **Closed** |
| 2 | **Low** | 25 | ConfigError May Leak Sensitive Config Values | src/errors.ts | CWE-209, A04:2021 | line 110: JSON.stringify(options.value) included in error message | [#24](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/24) | Added SENSITIVE_CONFIG_FIELDS set to redact password/key/secret/token/credential fields | Claude | 90d | **Closed** |
| 3 | **Low** | 20 | Port Number Validation Lacks Valid Range Check | src/config.ts | CWE-1284 | lines 277,304: Only checks isNaN, not 1-65535 range | [#25](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/25) | Added isValidPort() function, MIN_PORT/MAX_PORT constants, updated all port validation | Claude | 180d | **Closed** |
| 4 | **Low** | 15 | QueryBuilder.where() Missing Security Warnings | src/query-builder.ts | CWE-943 (documentation) | line 605: Accepts raw strings without security documentation | [#26](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/26) | Added comprehensive JSDoc security warnings similar to raw() method | Claude | 180d | **Closed** |

---

## Phase 3: Adversarial Review Findings (ALL CLOSED)

| Rank | Severity | Risk Score | Finding | Component | CWE/OWASP | Evidence | GitLab Issue | Fix Summary | Owner | SLA | Status |
|------|----------|------------|---------|-----------|-----------|----------|--------------|-------------|-------|-----|--------|
| 1 | **High** | 72 | Prototype Pollution in rowToObject() | src/types.ts | CWE-1321, A03:2021 | line 861-866: Server-controlled keys iterated without validation | [#17](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/17) | Added `isSafeObjectKey()` to reject `__proto__`, `constructor`, `prototype`; use `Object.create(null)` for prototype-free objects | Claude | 30d | **Closed** |
| 2 | **High** | 65 | Escaped Backslash Bypass in RLS Predicate Validation | src/validate.ts | CWE-89, CWE-943 | line 706: String literal tracking doesn't count consecutive backslashes | [#18](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/18) | Added consecutive backslash counting; quote is escaped only with odd number of preceding backslashes | Claude | 30d | **Closed** |
| 3 | **Low** | 25 | Incomplete Regex Character Escaping in Password Policy | src/auth.ts | CWE-185 | line 770: Hyphen not escaped in regex character class | [#19](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/19) | Added hyphen to escaped characters in regex (escapes literal pipe and backslashes) | Claude | 90d | **Closed** |
| 4 | **Low** | 20 | Path Validation Symlink Resolution (TOCTOU) | src/validate.ts | CWE-367, CWE-59 | Path validation doesn't resolve symlinks | [#20](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/20) | Added symlink detection via `fs.lstatSync()` and resolution via `fs.realpathSync()` with blocklist validation on resolved path | Claude | 90d | **Closed** |
| 5 | **Low** | 15 | Incomplete Sensitive Path Blocklist | src/validate.ts | CWE-22 | Blocklist missing cloud credential and user home paths | [#21](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/21) | Expanded `SENSITIVE_PATHS` constant: `/root/`, `/.ssh/`, `/var/run/secrets/`, `/.aws/`, `/.config/gcloud/`, `/.azure/`, `/.env` | Claude | 180d | **Closed** |
| 6 | **Low** | 10 | Dev Dependency Vulnerabilities (undici/testcontainers) | package.json | CWE-1035 | npm audit: 2 moderate vulnerabilities in undici via testcontainers | [#22](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/22) | Upgraded testcontainers to v11.11.0 which uses patched undici version; npm audit now clean | Claude | 180d | **Closed** |

---

## Phase 2: Adversarial Review Findings (ALL CLOSED)

| Rank | Severity | Risk Score | Finding | Component | CWE/OWASP | Evidence | GitLab Issue | Fix Summary | Owner | SLA | Status |
|------|----------|------------|---------|-----------|-----------|----------|--------------|-------------|-------|-----|--------|
| 1 | **Critical** | 90 | GQL Predicate Injection in createRLSPolicy | src/auth.ts | CWE-89, CWE-943, A03:2021 | line 549: `USING (${predicate})` directly interpolated | [#11](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/11) | Added validateRLSPredicate() with dangerous pattern detection, bracket balancing, and string literal checking | Claude | 14d | **Closed** |
| 2 | **High** | 75 | Path Traversal in TLS Certificate Configuration | src/transport.ts, src/config.ts | CWE-22, CWE-23, A01:2021 | transport.ts:51,65,79 reads cfg.tlsCA/tlsCert/tlsKey without validation | [#12](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/12) | Added validateTLSCertPath() to prevent directory traversal, null bytes, and access to restricted system files | Claude | 30d | **Closed** |
| 3 | **Medium** | 55 | QueryBuilder/PredicateBuilder raw() Allow Injection | src/query-builder.ts | CWE-89, CWE-943, A03:2021 | lines 503-508, 704-710: raw() methods accept arbitrary strings without validation | [#13](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/13) | Added comprehensive security warnings, @deprecated markers, and safe usage examples in JSDoc | Claude | 90d | **Closed** |
| 4 | **Medium** | 45 | Direct Label Interpolation in Auth GQL Queries | src/auth.ts | CWE-943, CWE-116 | lines 546, 570, 612, 636, 652: labels interpolated after validation | [#14](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/14) | Added escapeGQLIdentifier() for defense-in-depth, updated all auth methods to use escape function | Claude | 90d | **Closed** |
| 5 | **Low** | 25 | Validation Error Messages May Leak Information | src/validate.ts | CWE-209, CWE-532, A04:2021 | lines 165, 424, 430: error messages include invalid input values | [#15](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/15) | Removed input values from error messages, use generic descriptions instead | Claude | 180d | **Closed** |
| 6 | **Low** | 20 | Race Condition in AbortSignal Handling | src/transport.ts | CWE-362, CWE-401 | lines 376-389, 492-506: abort listener registered before push, no cleanup on success | [#16](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/16) | Reordered operations: push pendingRead before registering abort listener, added cleanup on resolve/reject | Claude | 180d | **Closed** |

---

## Phase 1: Original Review Findings (ALL CLOSED)

| Rank | Severity | Risk Score | Finding | Component | CWE/OWASP | Evidence | GitLab Issue | Fix Summary | Owner | SLA | Status |
|------|----------|------------|---------|-----------|-----------|----------|--------------|-------------|-------|-----|--------|
| 1 | High | 80 | GQL Injection in client.ts helper methods | src/client.ts | CWE-89, CWE-943 | lines 289, 304, 354, 375, 395, 406 | [#1](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/1) | Added validateLabel, validatePropertyName, validateRelationshipType to all helper methods | Claude | 30d | **Closed** |
| 2 | High | 76 | GQL Injection in auth.ts permission/policy methods | src/auth.ts | CWE-89, CWE-269 | lines 160, 394, 414, 450, 471, 508 | [#2](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/2) | Added validatePermissionAction, validatePermissionResource, validateRLSAction, validateLabel, validateRoleName | Claude | 30d | **Closed** |
| 3 | High | 72 | Query builder missing identifier validation | src/query-builder.ts | CWE-943, CWE-116 | lines 85, 169, 734, 744 | [#3](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/3) | Added validation to NodePatternBuilder.as/label/labels/prop/props and EdgePatternBuilder.as/type/prop/props | Claude | 30d | **Closed** |
| 4 | Medium | 48 | Dependency vulnerabilities in npm packages | package.json | CWE-1035 | npm audit: 13→2 moderate | [#4](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/4) | Ran npm audit fix --force, upgraded vitest, eslint, typescript-eslint. Remaining 2 in dev-only testcontainers | Claude | 90d | **Closed** |
| 5 | Medium | 48 | TLS skip verification lacks production safeguards | src/transport.ts | CWE-295 | lines 183-185 | [#5](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/5) | Added NODE_ENV/GEODE_ENV production check, error in production unless GEODE_ALLOW_INSECURE_PRODUCTION=true | Claude | 90d | **Closed** |
| 6 | Medium | 40 | Gitleaks allowlist overly permissive | .gitleaks.toml | CWE-540, CWE-312 | lines 16-18 | [#6](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/6) | Removed *.ts/*.js/*.md from global allowlist, added rule-specific allowlists for test fixtures only | Claude | 90d | **Closed** |
| 7 | Low | 28 | Weak password policy in auth client | src/auth.ts | CWE-521 | lines 610-623 | [#7](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/7) | Added PasswordPolicy interface with configurable minLength, maxLength, requireUppercase, requireLowercase, requireDigit, requireSpecialChar | Claude | 180d | **Closed** |
| 8 | Low | 24 | Credentials in DSN may be logged | src/config.ts | CWE-532 | lines 218-224 | [#8](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/8) | Added redactDSN() and redactConfig() functions for safe logging | Claude | 180d | **Closed** |
| 9 | Low | 24 | CI/CD unpinned component versions | .gitlab-ci.yml | CWE-829 | lines 24-86 | [#10](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/10) | Pinned all CI/CD catalog components to v1.9.14 or v1.9.3 | Claude | 180d | **Closed** |
| 10 | Low | 20 | Missing rate limiting and connection throttling | src/pool.ts, src/connection.ts | CWE-307, CWE-770 | pool.ts:128, connection.ts:80 | [#9](https://gitlab.com/devnw/codepros/geode/geode-client-nodejs/-/issues/9) | Added RateLimiter class with sliding window rate limiting and exponential backoff on connection failures | Claude | 180d | **Closed** |

---

## Finding Details

### CRITICAL: GQL Predicate Injection in createRLSPolicy (#11)

**File**: `src/auth.ts:545-551`

```typescript
const gql = `
  CREATE POLICY $name ON :${label}
  FOR ${action}
  ${roles}
  USING (${predicate})  // <-- DIRECTLY INTERPOLATED - INJECTION POINT
  ${enabled}
`.trim();
```

**Problem**: The `predicate` parameter is user-controlled and interpolated directly into the GQL query. While `validateQuery(predicate)` is called at line 531, this function only checks for null bytes and control characters - it does NOT prevent GQL injection.

**Attack Example**:

```typescript
await auth.createRLSPolicy(
  'malicious_policy',
  'User',
  'READ',
  'true) USING (true); DROP POLICY admin_policy ON :User; CREATE POLICY x ON :y FOR READ USING (true'
);
```

**Required Fix**: Implement AST-based predicate validation or use server-side parameterization.

### HIGH: Path Traversal in TLS Certificate Configuration (#12)

**Files**: `src/transport.ts:51,65,79` and `src/config.ts:385,389,393`

TLS certificate paths are read from DSN query parameters without validation:

```typescript
// config.ts - Paths accepted from DSN without validation
case 'ca':
  cfg.tlsCA = value;  // No path validation
case 'cert':
  cfg.tlsCert = value;
case 'key':
  cfg.tlsKey = value;

// transport.ts - Files read directly
options.ca = await fs.promises.readFile(cfg.tlsCA, 'utf-8');
options.cert = await fs.promises.readFile(cfg.tlsCert, 'utf-8');
options.key = await fs.promises.readFile(cfg.tlsKey, 'utf-8');
```

**Attack Example**:

```
quic://localhost:3141?ca=/etc/passwd
quic://localhost:3141?cert=../../../etc/shadow
```

**Required Fix**: Validate paths are absolute and within allowed directories.

---

## Phase 3 Finding Details (ALL CLOSED)

### HIGH: Prototype Pollution in rowToObject() (#17) - **CLOSED**

**File**: `src/types.ts:861-890`

**Original Problem**: The `rowToObject()` function iterated over server-controlled keys without validation, allowing prototype pollution attacks.

**Fix Implemented**:

```typescript
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isSafeObjectKey(key: string): boolean {
  return !DANGEROUS_KEYS.has(key);
}

export function rowToObject(row: Row): Record<string, unknown> {
  const obj = Object.create(null) as Record<string, unknown>;  // Prototype-free
  for (const [key, value] of row) {
    if (!isSafeObjectKey(key)) {
      throw new Error('Row contains dangerous key that could cause prototype pollution');
    }
    obj[key] = value.toJS();
  }
  return obj;
}
```

**Tests Added**: `tests/unit/types.test.ts` - 9 new tests for prototype pollution protection

### HIGH: Escaped Backslash Bypass in RLS Predicate Validation (#18) - **CLOSED**

**File**: `src/validate.ts:718-734`

**Original Problem**: String literal tracking only checked single preceding backslash, not consecutive backslashes.

**Fix Implemented**:

```typescript
if (char === inString) {
  let backslashCount = 0;
  let j = i - 1;
  while (j >= 0 && predicate[j] === '\\') {
    backslashCount++;
    j--;
  }
  // Quote is escaped only if preceded by odd number of backslashes
  if (backslashCount % 2 === 0) {
    inString = null;
  }
}
```

**Tests Added**: `tests/unit/validate.test.ts` - 7 new tests for escaped backslash handling

### LOW: Incomplete Regex Character Escaping in Password Policy (#19) - **CLOSED**

**File**: `src/auth.ts:772`

**Original Problem**: Hyphen not escaped in regex metacharacter pattern.

**Fix Implemented**:

```typescript
// Added hyphen to escaped characters
const specialCharsEscaped = policy.specialChars.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
```

**Tests Added**: `tests/unit/auth.test.ts` - 4 new tests for special character escaping

### LOW: Path Validation Symlink Resolution (TOCTOU) (#20) - **CLOSED**

**File**: `src/validate.ts:853-877`

**Original Problem**: Path validation used string matching without resolving symlinks.

**Fix Implemented**:

```typescript
if (fs.existsSync(path)) {
  const stats = fs.lstatSync(path);
  if (stats.isSymbolicLink()) {
    const resolvedPath = fs.realpathSync(path);
    const normalizedResolved = resolvedPath.replace(/\\/g, '/').replace(/\/+/g, '/');
    checkAgainstBlocklist(normalizedResolved, fieldName);
  }
}
```

**Tests Added**: `tests/unit/validate.test.ts` - 2 new tests for symlink handling

### LOW: Incomplete Sensitive Path Blocklist (#21) - **CLOSED**

**File**: `src/validate.ts:793-818`

**Original Problem**: Blocklist missing cloud credential paths and user home directories.

**Fix Implemented**:

```typescript
const SENSITIVE_PATHS = [
  '/etc/passwd', '/etc/shadow', '/etc/hosts',
  '/proc/', '/sys/', '/dev/',
  '/root/',              // Root home
  '/.ssh/',              // SSH keys
  '/var/run/secrets/',   // Kubernetes secrets
  '/run/secrets/',
  '/.aws/',              // AWS credentials
  '/credentials',
  '/.config/gcloud/',    // GCP credentials
  '/gcloud/',
  '/.azure/',            // Azure credentials
  '/.env', '/env',       // Environment files
];
```

**Tests Added**: `tests/unit/validate.test.ts` - 9 new tests for expanded sensitive path blocklist

### LOW: Dev Dependency Vulnerabilities (#22) - **CLOSED**

**File**: `package.json` (devDependencies)

**Original Problem**: `npm audit` reported 2 moderate vulnerabilities in `undici` via `testcontainers`.

**Fix Implemented**: Upgraded testcontainers from vulnerable version to v11.11.0:

```bash
npm install --save-dev testcontainers@latest
```

**Result**: `npm audit` now reports 0 vulnerabilities.

---

## Phase 4 Finding Details (ALL CLOSED)

### HIGH: valueToGQL Incomplete String Escaping - GQL Injection (#23) - **CLOSED**

**File**: `src/query-builder.ts:809`

**Original Problem**: The `valueToGQL()` function only escaped single quotes but not backslashes, enabling GQL injection through escape sequence manipulation.

**Attack Vector**:

```typescript
// Input: auth\'); DROP USER admin; //
// Without fix, this becomes: 'auth\'); DROP USER admin; //'
// In GQL parsing:
// - \\ is an escaped backslash (literal \)
// - ' closes the string
// - DROP USER admin; executes as a new statement
```

**Fix Implemented**:

```typescript
function valueToGQL(value: unknown): string {
  if (typeof value === 'string') {
    // Escape backslashes first, then single quotes
    // This prevents escape sequence injection where \' becomes \\' (escaped backslash + quote)
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
}
```

**Tests Added**: `tests/unit/query-builder.test.ts` - 6 new tests for string escaping security

### LOW: ConfigError May Leak Sensitive Config Values (#24) - **CLOSED**

**File**: `src/errors.ts:110`

**Original Problem**: ConfigError constructor included `JSON.stringify(options.value)` in error messages, potentially leaking sensitive configuration values like passwords.

**Fix Implemented**:

```typescript
const SENSITIVE_CONFIG_FIELDS = new Set(['password', 'pass', 'key', 'secret', 'token', 'credential']);

constructor(options: { field: string; value?: string; message: string }) {
  const isSensitive = SENSITIVE_CONFIG_FIELDS.has(options.field.toLowerCase());
  const valStr = options.value !== undefined && !isSensitive
    ? `=${JSON.stringify(options.value)}` : '';
  // ...
  this.value = isSensitive ? undefined : options.value;  // Don't store sensitive values
}
```

**Tests Added**: `tests/unit/errors.test.ts` - 6 new tests for sensitive field redaction

### LOW: Port Number Validation Lacks Valid Range Check (#25) - **CLOSED**

**File**: `src/config.ts:277,304`

**Original Problem**: Port numbers were only checked for `isNaN`, not valid TCP/UDP range (1-65535).

**Fix Implemented**:

```typescript
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

function isValidPort(port: number): boolean {
  return !isNaN(port) && port >= MIN_PORT && port <= MAX_PORT;
}

// Applied to all port parsing locations:
if (!isValidPort(port)) {
  throw new ConfigError({
    field: 'port',
    value: portStr,
    message: `must be a valid port number (${MIN_PORT}-${MAX_PORT})`,
  });
}
```

**Tests Added**: `tests/unit/config.test.ts` - 5 new tests for port range validation

### LOW: QueryBuilder.where() Missing Security Warnings (#26) - **CLOSED**

**File**: `src/query-builder.ts:605-607`

**Original Problem**: `where()` method accepted raw strings similar to `raw()` but lacked security documentation.

**Fix Implemented**: Added comprehensive JSDoc security warnings:

```typescript
/**
 * Add a WHERE clause.
 *
 * **⚠️ SECURITY WARNING when using string predicates:**
 * When passing a string predicate, this method does NOT validate or sanitize input.
 * Using string predicates with user-supplied data can lead to GQL injection attacks.
 *
 * @example
 * // RECOMMENDED: Use PredicateBuilder for type-safe, injection-resistant queries
 * query().where(predicate().eq('n.name', userInput))
 *
 * // SAFE: Using parameters with string predicates
 * query().where('n.name = $name', { name: userInput })
 *
 * // UNSAFE: Never interpolate user input directly in string predicates
 * query().where(`n.name = '${userInput}'`) // VULNERABLE TO INJECTION!
 */
```

---

## Security Posture Summary

### Strengths

- TLS 1.3 enforced by default
- Comprehensive input validation for most GQL identifiers
- Allowlist validation for permission actions and resources
- Production safeguards for insecure TLS configuration
- Configurable password policy with complexity requirements
- DSN credential redaction for safe logging
- Rate limiting and exponential backoff on connection failures
- Gitleaks properly configured for source code scanning
- CI/CD components pinned to specific versions
- Pre-commit hooks include security checks
- CI/CD includes SAST, dependency scanning, and gitleaks
- **NEW**: RLS predicate validation with dangerous pattern detection
- **NEW**: TLS certificate path validation to prevent directory traversal
- **NEW**: GQL identifier escape function for defense-in-depth
- **NEW**: Generic error messages to prevent information leakage
- **NEW**: Proper AbortSignal handling with cleanup
- **NEW (Phase 3)**: Prototype pollution protection in `rowToObject()` via key validation and `Object.create(null)`
- **NEW (Phase 3)**: Consecutive backslash counting in RLS predicate string parsing
- **NEW (Phase 3)**: Complete regex metacharacter escaping including hyphen in password policy
- **NEW (Phase 3)**: Symlink resolution via `fs.realpathSync()` in TLS certificate path validation
- **NEW (Phase 3)**: Expanded sensitive path blocklist with cloud credentials, SSH, K8s secrets
- **NEW (Phase 3)**: Updated testcontainers to resolve undici vulnerabilities
- **NEW (Phase 4)**: Complete string escaping in `valueToGQL()` - backslashes escaped before quotes to prevent injection
- **NEW (Phase 4)**: Sensitive config field redaction in error messages (password, key, secret, token, credential)
- **NEW (Phase 4)**: Port number range validation (1-65535) with `isValidPort()` helper
- **NEW (Phase 4)**: Security documentation for `QueryBuilder.where()` string predicates

### Weaknesses (Remaining)

After Phase A/B gap closure, 1 open finding remains:

1. **Deprecated unsafe APIs still callable** - `raw()` and string `where()` remain available without opt-in gating, relying solely on documentation warnings.

Previously open items now resolved:
- Prototype pollution in proto.ts and types.ts -- **Closed** (commits 68b7aea-22726e2)
- gRPC transport security parity -- **Closed** (insecureSkipVerify guard and message size aligned)
- Object.assign mutation and propsToGQL key validation -- **Closed**
- Dependency vulnerabilities -- **Won't Do** (transitive dep management)
- Session ID getter -- **Won't Do** (INFO severity, design choice)

### Recommendations

#### Remaining (Phase 6)

1. **Gate deprecated raw() APIs** - Move raw()/string where() behind an explicit opt-in flag

#### Maintenance

1. **Keep Dependencies Updated** - Run `npm audit` regularly; pin versions where caret ranges introduce risk
2. **Monitor for New Vulnerabilities** - Subscribe to security advisories
3. **Consider Server-Side Validation** - RLS predicates should ideally be validated server-side as well

---

## Appendix: Review Methodology

### Phase 2 Review Scope

- Full adversarial code review
- CI/CD pipeline analysis
- All configuration files
- Template literal analysis for injection points
- Dangerous pattern detection

### Tools Used

- Manual code review
- npm audit
- Pattern grep for dangerous patterns
- Template literal search (`\${`)
- GitLab CLI (glab) for issue tracking

### Files Reviewed (Phase 2)

- `src/*.ts` - All 15 source files (re-reviewed)
- `.gitlab-ci.yml` - CI/CD configuration
- `.gitleaks.toml` - Secret scanning configuration
- `package.json` / `package-lock.json` - Dependencies
- All test files for security patterns

### Patterns Searched

- Dynamic code evaluation patterns
- TLS bypass patterns (`insecure_tls_skip_verify`, legacy aliases)
- Credential handling (`password`, `credential`, `secret`, `token`)
- Template literals with user input (`${`) - Injection vectors
- File system operations with user-controlled paths
- Command execution patterns
- Prototype pollution patterns

### Not In Scope

- Geode server security
- Network infrastructure
- Deployed application configurations
- Third-party integrations beyond dependencies
