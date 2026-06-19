# Geode Node.js Driver Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the geode-client-nodejs driver to feature parity with the reference geode-client-go driver by porting nine remaining contract features.

**Architecture:** Each feature is a focused TypeScript module (or addition to an existing module) under `src/`, with unit tests under `tests/unit/`, property tests under `tests/property/`, and benchmarks under `tests/bench/`. Semantics are ported faithfully from the cited Go source files. All new public symbols are re-exported from `src/index.ts`.

**Tech Stack:** TypeScript (Node 20+, ESM, `.js` import specifiers), Vitest (unit + bench), fast-check (property tests), `node:crypto` (FLE), protobufjs (proto wire), ESLint + Prettier, tsup.

## Global Constraints

- ESM only: every relative import MUST use a `.js` extension (e.g. `import { x } from './errors.js'`).
- File-size discipline: keep every source file under ~800 lines (GAP-0011).
- Error classes follow the existing `src/errors.ts` pattern (extend `Error`, `Object.setPrototypeOf` in constructor, `name` set).
- Match existing naming: camelCase functions, PascalCase types/classes, `geode:` error-message prefix.
- Security hardening: reject ASCII control chars in string quoting; validate identifiers against a strict charset; never log secrets.
- All new public symbols MUST be re-exported from `src/index.ts`.
- Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run format:check` clean before completing.
- Commit after each task with a conventional-commit message.

---

### Task 1: HELLO tenant_id + role

**Files:**

- Modify: `proto/geode.proto` (add `optional string role = 8;` to `HelloRequest`)
- Modify: `src/proto.ts` (`HelloRequest` interface + `buildHelloRequest` signature)
- Modify: `src/config.ts` (`GeodeConfig` add `tenant?`, `role?`; `applyQueryParams` parse `tenant`/`tenant_id`/`role`)
- Modify: `src/connection.ts:182` (pass tenant + role to `buildHelloRequest`)
- Test: `tests/unit/proto.test.ts`, `tests/unit/config.test.ts`

**Interfaces:**

- Produces: `buildHelloRequest(username, password, clientName, clientVersion, conformance, tenantId?, graph?, role?): QuicClientMessage` and `HelloRequest { ...; tenantId?: string; role?: string }`. `GeodeConfig` gains `tenant?: string` and `role?: string`.

- [ ] **Step 1: Write the failing test (config parse)**

Add to `tests/unit/config.test.ts` inside the top-level `describe('config', ...)`:

```typescript
describe('tenant and role DSN params', () => {
  it('parses ?tenant= into cfg.tenant', () => {
    const cfg = parseDSN('quic://localhost:3141?tenant=acme');
    expect(cfg.tenant).toBe('acme');
  });

  it('parses ?tenant_id= alias into cfg.tenant', () => {
    const cfg = parseDSN('quic://localhost:3141?tenant_id=acme');
    expect(cfg.tenant).toBe('acme');
  });

  it('parses ?role= into cfg.role', () => {
    const cfg = parseDSN('quic://localhost:3141?role=analyst');
    expect(cfg.role).toBe('analyst');
  });

  it('leaves tenant and role undefined when not specified', () => {
    const cfg = parseDSN('quic://localhost:3141');
    expect(cfg.tenant).toBeUndefined();
    expect(cfg.role).toBeUndefined();
  });
});
```

Add to `tests/unit/proto.test.ts` (import `buildHelloRequest` if not already):

```typescript
describe('buildHelloRequest tenant + role', () => {
  it('encodes tenantId and role into the hello message', () => {
    const msg = buildHelloRequest('u', 'p', 'cn', 'cv', 'min', 'acme', 'g', 'analyst');
    expect(msg.hello?.tenantId).toBe('acme');
    expect(msg.hello?.role).toBe('analyst');
    expect(msg.hello?.graph).toBe('g');
  });

  it('omits tenantId and role when not provided', () => {
    const msg = buildHelloRequest('u', 'p', 'cn', 'cv', 'min');
    expect(msg.hello?.tenantId).toBeUndefined();
    expect(msg.hello?.role).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- config proto`
Expected: FAIL — `cfg.tenant` undefined / `buildHelloRequest` rejects 8th arg.

- [ ] **Step 3: Implement**

In `proto/geode.proto`, change `HelloRequest` to add after `optional string graph = 7;`:

```proto
  optional string role = 8;       // FLE role for field-level access control
```

In `src/proto.ts`, update the `HelloRequest` interface:

```typescript
export interface HelloRequest {
  username: string;
  password: string;
  tenantId?: string;
  clientName: string;
  clientVersion: string;
  wantedConformance: string;
  graph?: string;
  role?: string;
}
```

And `buildHelloRequest`:

```typescript
export function buildHelloRequest(
  username: string,
  password: string,
  clientName: string,
  clientVersion: string,
  conformance: string,
  tenantId?: string,
  graph?: string,
  role?: string
): QuicClientMessage {
  const helloReq: HelloRequest = {
    username,
    password,
    clientName,
    clientVersion,
    wantedConformance: conformance,
    ...(tenantId ? { tenantId } : {}),
    ...(graph ? { graph } : {}),
    ...(role ? { role } : {}),
  };
  return { hello: helloReq };
}
```

In `src/config.ts`, add to the `GeodeConfig` interface (after `graph?`):

```typescript
  /** Tenant identifier sent in HELLO (tenant_id). Bound for multi-tenant isolation. */
  tenant?: string;

  /** FLE role sent in HELLO for field-level access control. */
  role?: string;
```

In `applyQueryParams`, add cases before the closing comment:

```typescript
      case 'tenant':
      case 'tenant_id':
        cfg.tenant = value;
        break;

      case 'role':
        cfg.role = value;
        break;
```

In `src/connection.ts`, update the `buildHelloRequest` call at the `hello()` method:

```typescript
    const msg = buildHelloRequest(
      this._config.username ?? '',
      this._config.password ?? '',
      this._config.helloName,
      this._config.helloVersion,
      this._config.conformance,
      this._config.tenant,
      this._config.graph,
      this._config.role
    );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- config proto`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add proto/geode.proto src/proto.ts src/config.ts src/connection.ts tests/unit/config.test.ts tests/unit/proto.test.ts
git commit -m "feat: send tenant_id and role in HELLO handshake (GAP-0841)"
```

---

### Task 2: Quoting helpers (quoteIdent, quoteString, sanitizeGraphName)

**Files:**

- Create: `src/quote.ts`
- Modify: `src/errors.ts` (add `ErrInvalidIdent`, `ErrInvalidString` factories + messages)
- Modify: `src/index.ts` (re-export)
- Test: `tests/unit/quote.test.ts`

**Interfaces:**

- Produces: `quoteIdent(name: string): string` (throws on invalid), `quoteString(s: string): string` (throws on control chars), `sanitizeGraphName(name: string): string`. Errors: `ErrInvalidIdent(): Error`, `ErrInvalidString(): Error`, plus `ERR_INVALID_IDENT_MESSAGE`, `ERR_INVALID_STRING_MESSAGE` constants.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/quote.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { quoteIdent, quoteString, sanitizeGraphName } from '../../src/quote.js';
import { ERR_INVALID_IDENT_MESSAGE, ERR_INVALID_STRING_MESSAGE } from '../../src/errors.js';

describe('sanitizeGraphName', () => {
  const cases: [string, string][] = [
    ['myGraph', 'myGraph'],
    ['my-graph_01', 'my-graph_01'],
    ['bad name!', 'badname'],
    ['', ''],
    ['有害', ''],
    ['   ', ''],
  ];
  it.each(cases)('sanitizeGraphName(%j) === %j', (input, expected) => {
    expect(sanitizeGraphName(input)).toBe(expected);
  });
});

describe('quoteIdent', () => {
  const valid = ['abc', 'ABC', '_foo', 'foo_bar', 'foo-bar', 'foo9', '9starts', '005_add_index'];
  it.each(valid)('accepts %j unchanged', (name) => {
    expect(quoteIdent(name)).toBe(name);
  });

  const invalid = ['', '-starts', 'has space', 'has;semi', 'has\x00null'];
  it.each(invalid)('rejects %j', (name) => {
    expect(() => quoteIdent(name)).toThrow(ERR_INVALID_IDENT_MESSAGE);
  });
});

describe('quoteString', () => {
  const cases: [string, string][] = [
    ['hello', "'hello'"],
    ["it's", "'it''s'"],
    ['back\\slash', "'back\\\\slash'"],
    ['back\\\'quote', "'back\\\\''quote'"],
  ];
  it.each(cases)('quoteString(%j) === %j', (input, expected) => {
    expect(quoteString(input)).toBe(expected);
  });

  const controls = ['\n', '\r', '\t', '\x00', '\x1f', '\x7f'];
  it.each(controls)('rejects control char %j', (s) => {
    expect(() => quoteString(s)).toThrow(ERR_INVALID_STRING_MESSAGE);
  });

  it('escapes backslash before single quote (order matters)', () => {
    // input: \'  ->  backslash becomes \\, then ' becomes ''  -> '\\'''
    expect(quoteString("\\'")).toBe("'\\\\'''");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- quote`
Expected: FAIL — module `src/quote.js` not found.

- [ ] **Step 3: Implement errors + quote module**

In `src/errors.ts`, add after the existing sentinel message constants:

```typescript
export const ERR_INVALID_IDENT_MESSAGE = 'geode: identifier contains forbidden characters';
export const ERR_INVALID_STRING_MESSAGE = 'geode: string literal contains forbidden characters';
```

and after the sentinel factory functions:

```typescript
export function ErrInvalidIdent(): Error {
  return new Error(ERR_INVALID_IDENT_MESSAGE);
}
export function ErrInvalidString(): Error {
  return new Error(ERR_INVALID_STRING_MESSAGE);
}
```

Create `src/quote.ts`:

```typescript
/**
 * GQL Quoting Helpers
 *
 * Ports geode-client-go quote.go: safe inlining of identifiers, string
 * literals, and graph names into GQL admin statements.
 */

import { ErrInvalidIdent, ErrInvalidString } from './errors.js';

/**
 * Return `name` stripped of any character that is not alphanumeric, underscore,
 * or hyphen, so it can be inlined safely into a USE GRAPH statement.
 */
export function sanitizeGraphName(name: string): string {
  let out = '';
  for (const ch of name) {
    if (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '-'
    ) {
      out += ch;
    }
  }
  return out;
}

/**
 * Validate and return `name` in a form safe to inline into a GQL admin
 * statement that takes an identifier. Valid identifiers consist of letters,
 * digits, underscore, and hyphen, and must not start with a hyphen. Digits are
 * permitted at any position. Throws ErrInvalidIdent for empty or invalid input.
 */
export function quoteIdent(name: string): string {
  if (name === '') {
    throw ErrInvalidIdent();
  }
  let first = true;
  for (const ch of name) {
    if (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      ch === '_' ||
      (ch >= '0' && ch <= '9')
    ) {
      // always allowed (digits anywhere)
    } else if (ch === '-') {
      if (first) {
        throw ErrInvalidIdent();
      }
    } else {
      throw ErrInvalidIdent();
    }
    first = false;
  }
  return name;
}

/**
 * Return `s` wrapped in GQL single quotes with backslashes and single quotes
 * escaped. ASCII control characters (< 0x20 or 0x7F) are rejected with
 * ErrInvalidString. Escape order: backslash first (\ -> \\), then single
 * quotes (' -> '').
 */
export function quoteString(s: string): string {
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) {
      throw ErrInvalidString();
    }
  }
  const escaped = s.replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${escaped}'`;
}
```

In `src/index.ts`, add a new export block:

```typescript
// Quoting helpers
export { quoteIdent, quoteString, sanitizeGraphName } from './quote.js';
```

and add `ErrInvalidIdent`, `ErrInvalidString`, `ERR_INVALID_IDENT_MESSAGE`, `ERR_INVALID_STRING_MESSAGE` to the existing `from './errors.js'` export list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- quote`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/quote.ts src/errors.ts src/index.ts tests/unit/quote.test.ts
git commit -m "feat: add quoteIdent, quoteString, sanitizeGraphName quoting helpers"
```

---

### Task 3: RetryPolicy + retry helper

**Files:**

- Create: `src/retry.ts`
- Modify: `src/index.ts` (re-export)
- Test: `tests/unit/retry.test.ts`

**Interfaces:**

- Consumes: `isRetryableError` from `./errors.js`.
- Produces: `interface RetryPolicy { maxAttempts: number; initialBackoffMs: number; maxBackoffMs: number; multiplier: number }`; `defaultRetryPolicy(): RetryPolicy`; `backoffDelay(policy: RetryPolicy, attempt: number): number` (1-indexed, clamped to maxBackoffMs); `retry<T>(fn: () => Promise<T>, policy?: RetryPolicy, signal?: AbortSignal): Promise<T>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/retry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { defaultRetryPolicy, backoffDelay, retry } from '../../src/retry.js';
import { TransportError, ConfigError } from '../../src/errors.js';

describe('defaultRetryPolicy', () => {
  it('matches Go defaults (3 attempts, 1s->30s, 2x)', () => {
    const p = defaultRetryPolicy();
    expect(p.maxAttempts).toBe(3);
    expect(p.initialBackoffMs).toBe(1000);
    expect(p.maxBackoffMs).toBe(30000);
    expect(p.multiplier).toBe(2.0);
  });
});

describe('backoffDelay', () => {
  it('computes initial * multiplier^(attempt-1), clamped to max', () => {
    const p = defaultRetryPolicy();
    expect(backoffDelay(p, 1)).toBe(1000);
    expect(backoffDelay(p, 2)).toBe(2000);
    expect(backoffDelay(p, 3)).toBe(4000);
    expect(backoffDelay(p, 10)).toBe(30000); // clamped
  });

  it('treats attempts < 1 as 1', () => {
    const p = defaultRetryPolicy();
    expect(backoffDelay(p, 0)).toBe(1000);
  });
});

describe('retry', () => {
  const fast = { maxAttempts: 3, initialBackoffMs: 1, maxBackoffMs: 5, multiplier: 2.0 };

  it('returns immediately on success', async () => {
    let calls = 0;
    const out = await retry(async () => {
      calls++;
      return 'ok';
    }, fast);
    expect(out).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries retryable errors up to maxAttempts', async () => {
    let calls = 0;
    await expect(
      retry(async () => {
        calls++;
        throw new TransportError({ operation: 'read' });
      }, fast)
    ).rejects.toBeInstanceOf(TransportError);
    expect(calls).toBe(3);
  });

  it('succeeds after a transient failure', async () => {
    let calls = 0;
    const out = await retry(async () => {
      calls++;
      if (calls < 3) throw new TransportError({ operation: 'read' });
      return 'recovered';
    }, fast);
    expect(out).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      retry(async () => {
        calls++;
        throw new ConfigError({ field: 'host', message: 'bad' });
      }, fast)
    ).rejects.toBeInstanceOf(ConfigError);
    expect(calls).toBe(1);
  });

  it('does not retry non-Geode errors', async () => {
    let calls = 0;
    await expect(
      retry(async () => {
        calls++;
        throw new Error('plain');
      }, fast)
    ).rejects.toThrow('plain');
    expect(calls).toBe(1);
  });

  it('aborts before sleeping when signal is aborted', async () => {
    const ctrl = new AbortController();
    let calls = 0;
    const promise = retry(async () => {
      calls++;
      ctrl.abort();
      throw new TransportError({ operation: 'read' });
    }, fast, ctrl.signal);
    await expect(promise).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- retry`
Expected: FAIL — module `src/retry.js` not found.

- [ ] **Step 3: Implement**

Create `src/retry.ts`:

```typescript
/**
 * Retry Policy
 *
 * Ports geode-client-go retry.go: bounded exponential backoff that retries
 * only when isRetryableError returns true.
 */

import { isRetryableError } from './errors.js';

/** Retry behaviour configuration for transient errors. */
export interface RetryPolicy {
  /** Maximum number of attempts including the initial call. Values < 1 treated as 1. */
  maxAttempts: number;
  /** Delay before the first retry, in milliseconds. */
  initialBackoffMs: number;
  /** Maximum backoff in milliseconds; exponential backoff is clamped to this. */
  maxBackoffMs: number;
  /** Exponential backoff multiplier applied on each retry. */
  multiplier: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;
const DEFAULT_MULTIPLIER = 2.0;

/** Sensible defaults: 3 attempts, 1s initial, 30s max, 2.0 multiplier. */
export function defaultRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    initialBackoffMs: DEFAULT_INITIAL_BACKOFF_MS,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    multiplier: DEFAULT_MULTIPLIER,
  };
}

/** Backoff for the given 1-indexed attempt, clamped to maxBackoffMs. */
export function backoffDelay(policy: RetryPolicy, attempt: number): number {
  const a = attempt < 1 ? 1 : attempt;
  const d = policy.initialBackoffMs * Math.pow(policy.multiplier, a - 1);
  return d > policy.maxBackoffMs ? policy.maxBackoffMs : d;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    let onAbort: (() => void) | null = null;
    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Execute `fn` up to policy.maxAttempts times, retrying only when the thrown
 * error is retryable. Non-retryable and non-Geode errors propagate immediately.
 * The abort signal is checked before each backoff sleep.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy(),
  signal?: AbortSignal
): Promise<T> {
  const maxAttempts = policy.maxAttempts < 1 ? 1 : policy.maxAttempts;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err)) {
        throw err;
      }
      if (attempt === maxAttempts) {
        break;
      }
      if (signal?.aborted) {
        throw err;
      }
      await sleep(backoffDelay(policy, attempt), signal);
    }
  }
  throw lastErr;
}
```

In `src/index.ts`, add:

```typescript
// Retry policy
export { defaultRetryPolicy, backoffDelay, retry, type RetryPolicy } from './retry.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- retry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/retry.ts src/index.ts tests/unit/retry.test.ts
git commit -m "feat: add RetryPolicy and retry helper with exponential backoff"
```

---

### Task 4: isAuthError / isSyntaxError classifiers

**Files:**

- Modify: `src/errors.ts` (add `PASSWORD_RESET` class constant + two classifiers)
- Modify: `src/index.ts` (re-export)
- Test: `tests/unit/errors.test.ts`

**Interfaces:**

- Consumes: `DriverError`, `StatusClass` from `./errors.js`.
- Produces: `isAuthError(err: unknown): boolean` (true for status class `28000` or `08P01`); `isSyntaxError(err: unknown): boolean` (true for status class `42000`).

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/errors.test.ts` (import `isAuthError`, `isSyntaxError`, `DriverError`, `StatusClass`, `TransportError`):

```typescript
describe('isAuthError', () => {
  it('returns true for 28000 auth class', () => {
    const e = new DriverError({ statusClass: StatusClass.AUTH, subclass: '', code: 'AUTH', message: 'no' });
    expect(isAuthError(e)).toBe(true);
  });

  it('returns true for 08P01 password reset', () => {
    const e = new DriverError({ statusClass: '08P01' as never, subclass: '', code: 'PWRESET', message: '' });
    expect(isAuthError(e)).toBe(true);
  });

  it('returns false for non-auth driver error', () => {
    const e = new DriverError({ statusClass: StatusClass.SYNTAX, subclass: '', code: 'SYN', message: '' });
    expect(isAuthError(e)).toBe(false);
  });

  it('returns false for nil and non-driver errors', () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(new TransportError({ operation: 'read' }))).toBe(false);
  });
});

describe('isSyntaxError', () => {
  it('returns true for 42000 syntax class', () => {
    const e = new DriverError({ statusClass: StatusClass.SYNTAX, subclass: '', code: 'SYN', message: '' });
    expect(isSyntaxError(e)).toBe(true);
  });

  it('returns false for other classes and non-driver errors', () => {
    const e = new DriverError({ statusClass: StatusClass.AUTH, subclass: '', code: 'A', message: '' });
    expect(isSyntaxError(e)).toBe(false);
    expect(isSyntaxError(null)).toBe(false);
    expect(isSyntaxError(new Error('x'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- errors`
Expected: FAIL — `isAuthError` is not exported.

- [ ] **Step 3: Implement**

In `src/errors.ts`, after `isRetryableError`, add:

```typescript
/**
 * Reports whether `err` is a Geode authentication/authorization failure
 * (GQL status class 28000 or the Geode-specific 08P01 password-reset
 * extension). Returns false for null and for non-driver errors.
 */
export function isAuthError(err: unknown): boolean {
  if (!isDriverError(err)) {
    return false;
  }
  return err.statusClass === StatusClass.AUTH || err.statusClass === '08P01';
}

/**
 * Reports whether `err` is a GQL parse/syntax error (status class 42000).
 * Returns false for null and for non-driver errors.
 */
export function isSyntaxError(err: unknown): boolean {
  if (!isDriverError(err)) {
    return false;
  }
  return err.statusClass === StatusClass.SYNTAX;
}
```

In `src/index.ts`, add `isAuthError` and `isSyntaxError` to the `from './errors.js'` export list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- errors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/index.ts tests/unit/errors.test.ts
git commit -m "feat: add isAuthError and isSyntaxError classifiers"
```

---

### Task 5: ErrNoRows + queryRow path

**Files:**

- Modify: `src/errors.ts` (add `ERR_NO_ROWS_MESSAGE` + `ErrNoRows` factory)
- Modify: `src/connection.ts` (add `queryRow`)
- Modify: `src/pool.ts` (add `queryRow` delegating to connection)
- Modify: `src/index.ts` (re-export)
- Test: `tests/unit/connection.test.ts`

**Interfaces:**

- Consumes: `Connection.queryAll`, `ConnectionPool.withConnection`.
- Produces: `ErrNoRows(): Error`, `ERR_NO_ROWS_MESSAGE = 'geode: no rows in result set'`; `Connection.queryRow(query, options?): Promise<Record<string, unknown>>` throws `ErrNoRows` when empty; `ConnectionPool.queryRow(query, options?): Promise<Record<string, unknown>>`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/connection.test.ts`. First inspect the existing test file to reuse its mock-connection setup helper. Add a describe block that builds a Connection over a `MockTransport`, queues a HELLO success + one execute response with a single row, then asserts. If the existing tests already have a helper that returns a connected `Connection`, reuse it. Otherwise add:

```typescript
import { ERR_NO_ROWS_MESSAGE } from '../../src/errors.js';

describe('queryRow', () => {
  it('returns the first row when rows exist', async () => {
    // Use the same connected-connection helper the other tests use.
    const conn = await makeConnectedConnection(); // existing helper in this file
    vi.spyOn(conn, 'queryAll').mockResolvedValue([{ n: 1 }, { n: 2 }]);
    const row = await conn.queryRow('MATCH (n) RETURN n');
    expect(row).toEqual({ n: 1 });
  });

  it('throws ErrNoRows when no rows are returned', async () => {
    const conn = await makeConnectedConnection();
    vi.spyOn(conn, 'queryAll').mockResolvedValue([]);
    await expect(conn.queryRow('MATCH (n) RETURN n')).rejects.toThrow(ERR_NO_ROWS_MESSAGE);
  });
});
```

If no `makeConnectedConnection` helper exists, write `queryRow` tests against `ConnectionPool` style is harder; instead instantiate a `Connection` with a `MockTransport` and stub `queryAll` directly via `vi.spyOn` after construction (construction does not require a live connect for stubbing an instance method). If `Connection` construction needs a connected transport, follow the existing pattern already used by other tests in this file for building a usable `Connection`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- connection`
Expected: FAIL — `conn.queryRow` is not a function / `ERR_NO_ROWS_MESSAGE` not exported.

- [ ] **Step 3: Implement**

In `src/errors.ts`, add to the message constants:

```typescript
export const ERR_NO_ROWS_MESSAGE = 'geode: no rows in result set';
```

and a factory:

```typescript
export function ErrNoRows(): Error {
  return new Error(ERR_NO_ROWS_MESSAGE);
}
```

In `src/connection.ts`, add `ErrNoRows` to the import from `./errors.js`, then add after `queryAll`:

```typescript
  /**
   * Execute a query and return exactly the first row. Throws ErrNoRows when
   * the result set is empty, mirroring database/sql's ErrNoRows.
   */
  async queryRow(query: string, options?: QueryOptions): Promise<Record<string, unknown>> {
    const rows = await this.queryAll(query, options);
    const first = rows[0];
    if (first === undefined) {
      throw ErrNoRows();
    }
    return first;
  }
```

In `src/pool.ts`, add after `queryAll`:

```typescript
  /**
   * Execute a query using a pooled connection and return the first row.
   * Throws ErrNoRows when the result set is empty.
   */
  async queryRow(query: string, options?: QueryOptions): Promise<Record<string, unknown>> {
    return this.withConnection((conn) => conn.queryRow(query, options), options?.signal);
  }
```

In `src/index.ts`, add `ErrNoRows`, `ERR_NO_ROWS_MESSAGE` to the `from './errors.js'` export list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- connection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/connection.ts src/pool.ts src/index.ts tests/unit/connection.test.ts
git commit -m "feat: add ErrNoRows sentinel and queryRow path"
```

---

### Task 6: ParseSchemaFS

**Files:**

- Create: `src/schema.ts`
- Modify: `src/index.ts` (re-export)
- Test: `tests/unit/schema.test.ts`
- Create test fixtures: `tests/fixtures/schema/*.gql` (written inline by the test in a temp dir; no checked-in fixtures required)

**Interfaces:**

- Produces: `interface Statement { query: string; params?: Record<string, unknown> }`; `parseSchemaFS(dir: string): Promise<Statement[]>` reads direct-child `*.gql` files from `dir` using `node:fs/promises`, splits on `;`, drops blank/`//`/`--` lines and lines not starting (case-insensitively) with `CREATE`/`MERGE`/`MATCH`/`DELETE`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schema.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSchemaFS } from '../../src/schema.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'geode-schema-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseSchemaFS', () => {
  it('returns no statements for an empty directory', async () => {
    expect(await parseSchemaFS(dir)).toEqual([]);
  });

  it('rejects on a non-existent directory', async () => {
    await expect(parseSchemaFS(join(dir, 'nope'))).rejects.toThrow();
  });

  it('ignores non-.gql files', async () => {
    await writeFile(join(dir, 'schema.sql'), 'CREATE TABLE t (id INT)');
    await writeFile(join(dir, 'notes.txt'), 'CREATE notes');
    expect(await parseSchemaFS(dir)).toEqual([]);
  });

  it('parses one statement per line', async () => {
    await writeFile(
      join(dir, '01_nodes.gql'),
      'CREATE NODE TYPE Person (name STRING)\nCREATE NODE TYPE Company (name STRING)\n'
    );
    const stmts = await parseSchemaFS(dir);
    expect(stmts).toEqual([
      { query: 'CREATE NODE TYPE Person (name STRING)' },
      { query: 'CREATE NODE TYPE Company (name STRING)' },
    ]);
  });

  it('strips comments and non-GQL lines', async () => {
    await writeFile(
      join(dir, 'a.gql'),
      '// a comment\n-- sql comment\n\nSET x = 1\nMATCH (n) RETURN n\nMERGE (m)\nDELETE n\n'
    );
    const stmts = await parseSchemaFS(dir);
    expect(stmts.map((s) => s.query)).toEqual([
      'MATCH (n) RETURN n',
      'MERGE (m)',
      'DELETE n',
    ]);
  });

  it('splits multiple statements on a single line at semicolons', async () => {
    await writeFile(join(dir, 'b.gql'), 'CREATE (a); CREATE (b);\n');
    const stmts = await parseSchemaFS(dir);
    expect(stmts.map((s) => s.query)).toEqual(['CREATE (a)', 'CREATE (b)']);
  });

  it('only reads direct children, not subdirectories', async () => {
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'nested.gql'), 'CREATE (x)');
    await writeFile(join(dir, 'top.gql'), 'CREATE (y)');
    const stmts = await parseSchemaFS(dir);
    expect(stmts.map((s) => s.query)).toEqual(['CREATE (y)']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- schema`
Expected: FAIL — module `src/schema.js` not found.

- [ ] **Step 3: Implement**

Create `src/schema.ts`:

```typescript
/**
 * Schema Loading
 *
 * Ports geode-client-go schema.go: read .gql files from a directory and turn
 * them into Statements suitable for batchExec / pipelineExec.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A GQL query paired with optional bound parameters. */
export interface Statement {
  query: string;
  params?: Record<string, unknown>;
}

const KEYWORDS = ['CREATE', 'MERGE', 'MATCH', 'DELETE'];

/**
 * Read all direct-child `.gql` files from `dir` and return Statements.
 *
 * Subdirectories are not traversed. Lines are split into statements at
 * semicolons after stripping blank lines, line comments (`//` and `--`), and
 * lines that do not start with a recognised GQL keyword.
 */
export async function parseSchemaFS(dir: string): Promise<Statement[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const stmts: Statement[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() || !entry.name.endsWith('.gql')) {
      continue;
    }
    const content = await readFile(join(dir, entry.name), 'utf8');
    for (const rawLine of content.split('\n')) {
      const trimmed = rawLine.trim();
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('--')) {
        continue;
      }
      const upper = trimmed.toUpperCase();
      if (!KEYWORDS.some((kw) => upper.startsWith(kw))) {
        continue;
      }
      for (const part of trimmed.split(';')) {
        const p = part.trim();
        if (p !== '') {
          stmts.push({ query: p });
        }
      }
    }
  }

  return stmts;
}
```

In `src/index.ts`, add:

```typescript
// Schema loading
export { parseSchemaFS, type Statement } from './schema.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/index.ts tests/unit/schema.test.ts
git commit -m "feat: add parseSchemaFS to load .gql schema directories"
```

---

### Task 7: Chunked/worker pipelineExec + batchExec (GAP-0900)

**Files:**

- Create: `src/pipeline.ts`
- Modify: `src/index.ts` (re-export)
- Test: `tests/unit/pipeline.test.ts`

**Interfaces:**

- Consumes: `Statement` from `./schema.js`; `retry`, `defaultRetryPolicy` from `./retry.js`.
- Produces:
  - `interface PipelineExecutor { withTransaction<T>(fn: (tx: PipelineTx) => Promise<T>): Promise<T> }` — minimal structural type the executor needs from a pool (a pool's `withTransaction` matches).
  - `interface PipelineTx { exec(query: string, options?: { params?: Record<string, unknown> }): Promise<void> }` — minimal structural type of a transaction.
  - `DEFAULT_CHUNK_SIZE = 100`, `DEFAULT_MAX_WORKERS = 8`.
  - `batchExec(pool: PipelineExecutor, stmts: Statement[]): Promise<void>` — runs all statements in one transaction with retry; empty is a no-op.
  - `pipelineExec(pool: PipelineExecutor, stmts: Statement[], opts?: { chunkSize?: number; maxWorkers?: number; signal?: AbortSignal }): Promise<void>` — splits into chunks, runs up to maxWorkers concurrently via batchExec; returns the first error; stops launching new chunks after the first error but lets in-flight chunks finish.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pipeline.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  batchExec,
  pipelineExec,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_WORKERS,
  type PipelineExecutor,
  type PipelineTx,
} from '../../src/pipeline.js';
import type { Statement } from '../../src/schema.js';
import { TransportError } from '../../src/errors.js';

interface CallLog {
  txCount: number;
  maxConcurrent: number;
  current: number;
  execed: string[];
}

/**
 * Build a mock pool that records transaction usage. `failOn` causes the
 * matching query to throw a (retryable) TransportError on every attempt.
 */
function mockPool(
  log: CallLog,
  opts?: { failOn?: string; failTimes?: number }
): PipelineExecutor & { failCounts: Map<string, number> } {
  const failCounts = new Map<string, number>();
  return {
    failCounts,
    async withTransaction<T>(fn: (tx: PipelineTx) => Promise<T>): Promise<T> {
      log.txCount++;
      log.current++;
      log.maxConcurrent = Math.max(log.maxConcurrent, log.current);
      const tx: PipelineTx = {
        async exec(query: string): Promise<void> {
          log.execed.push(query);
          if (opts?.failOn && query === opts.failOn) {
            const seen = (failCounts.get(query) ?? 0) + 1;
            failCounts.set(query, seen);
            if (!opts.failTimes || seen <= opts.failTimes) {
              throw new TransportError({ operation: 'exec' });
            }
          }
        },
      };
      try {
        // Yield so concurrency overlaps observably.
        await new Promise((r) => setTimeout(r, 5));
        return await fn(tx);
      } finally {
        log.current--;
      }
    },
  };
}

const stmt = (q: string): Statement => ({ query: q });

describe('defaults', () => {
  it('matches Go (chunk 100, workers 8)', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(100);
    expect(DEFAULT_MAX_WORKERS).toBe(8);
  });
});

describe('batchExec', () => {
  it('is a no-op for empty statements', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    await batchExec(mockPool(log), []);
    expect(log.txCount).toBe(0);
  });

  it('runs all statements in a single transaction', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    await batchExec(mockPool(log), [stmt('A'), stmt('B'), stmt('C')]);
    expect(log.txCount).toBe(1);
    expect(log.execed).toEqual(['A', 'B', 'C']);
  });

  it('retries the whole batch on a retryable error', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    const pool = mockPool(log, { failOn: 'B', failTimes: 1 });
    await batchExec(pool, [stmt('A'), stmt('B')]);
    expect(log.txCount).toBe(2); // first attempt fails at B, retry succeeds
  });
});

describe('pipelineExec', () => {
  it('is a no-op for empty statements', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    await pipelineExec(mockPool(log), []);
    expect(log.txCount).toBe(0);
  });

  it('splits into chunks of chunkSize (one tx per chunk)', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    const stmts = Array.from({ length: 10 }, (_, i) => stmt(`Q${i}`));
    await pipelineExec(mockPool(log), stmts, { chunkSize: 3, maxWorkers: 8 });
    // 10 statements / 3 per chunk = 4 chunks
    expect(log.txCount).toBe(4);
    expect(log.execed).toHaveLength(10);
  });

  it('bounds concurrency to maxWorkers', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    const stmts = Array.from({ length: 20 }, (_, i) => stmt(`Q${i}`));
    await pipelineExec(mockPool(log), stmts, { chunkSize: 1, maxWorkers: 2 });
    expect(log.maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('returns the first error and stops launching new chunks', async () => {
    const log: CallLog = { txCount: 0, maxConcurrent: 0, current: 0, execed: [] };
    const stmts = Array.from({ length: 20 }, (_, i) => stmt(`Q${i}`));
    // Q0 always fails (non-recoverable across retries).
    const pool = mockPool(log, { failOn: 'Q0' });
    await expect(
      pipelineExec(pool, stmts, { chunkSize: 1, maxWorkers: 1 })
    ).rejects.toBeInstanceOf(TransportError);
    // With maxWorkers=1 and Q0 first, no further chunks should launch after the failure.
    expect(log.txCount).toBeLessThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- pipeline`
Expected: FAIL — module `src/pipeline.js` not found.

- [ ] **Step 3: Implement**

Create `src/pipeline.ts`:

```typescript
/**
 * Pipeline / Batch Execution (GAP-0900)
 *
 * Ports geode-client-go batch.go PipelineExec/BatchExec:
 *  - batchExec runs all statements inside one transaction, with retry.
 *  - pipelineExec splits into chunks and runs up to maxWorkers concurrently;
 *    the first error stops launching new chunks while in-flight chunks finish.
 */

import type { Statement } from './schema.js';
import { retry, defaultRetryPolicy } from './retry.js';

/** Default number of statements per chunk in pipelineExec. */
export const DEFAULT_CHUNK_SIZE = 100;

/** Default maximum number of concurrent chunk workers in pipelineExec. */
export const DEFAULT_MAX_WORKERS = 8;

/** Minimal transaction surface pipelineExec needs. */
export interface PipelineTx {
  exec(query: string, options?: { params?: Record<string, unknown> }): Promise<void>;
}

/** Minimal pool surface pipelineExec needs (ConnectionPool satisfies this). */
export interface PipelineExecutor {
  withTransaction<T>(fn: (tx: PipelineTx) => Promise<T>): Promise<T>;
}

/**
 * Execute `stmts` inside a single transaction with automatic retry on
 * retryable errors. An empty list is a no-op.
 */
export async function batchExec(pool: PipelineExecutor, stmts: Statement[]): Promise<void> {
  if (stmts.length === 0) {
    return;
  }
  await retry(
    () =>
      pool.withTransaction(async (tx) => {
        for (const s of stmts) {
          await tx.exec(s.query, s.params ? { params: s.params } : undefined);
        }
      }),
    defaultRetryPolicy()
  );
}

/**
 * Execute `stmts` in parallel chunks. Splits into chunks of `chunkSize` and
 * runs up to `maxWorkers` chunks concurrently; each chunk runs through
 * batchExec. Returns the first error encountered; once an error occurs no new
 * chunks are launched but in-flight chunks complete.
 */
export async function pipelineExec(
  pool: PipelineExecutor,
  stmts: Statement[],
  opts?: { chunkSize?: number; maxWorkers?: number; signal?: AbortSignal }
): Promise<void> {
  if (stmts.length === 0) {
    return;
  }
  const chunkSize = opts?.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : DEFAULT_CHUNK_SIZE;
  const maxWorkers = opts?.maxWorkers && opts.maxWorkers > 0 ? opts.maxWorkers : DEFAULT_MAX_WORKERS;
  const signal = opts?.signal;

  const chunks: Statement[][] = [];
  for (let i = 0; i < stmts.length; i += chunkSize) {
    chunks.push(stmts.slice(i, i + chunkSize));
  }

  let firstErr: unknown;
  let nextChunk = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (firstErr !== undefined || signal?.aborted) {
        return;
      }
      const idx = nextChunk++;
      if (idx >= chunks.length) {
        return;
      }
      try {
        await batchExec(pool, chunks[idx]!);
      } catch (err) {
        if (firstErr === undefined) {
          firstErr = err;
        }
        return;
      }
    }
  }

  const workerCount = Math.min(maxWorkers, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (firstErr !== undefined) {
    throw firstErr;
  }
  if (signal?.aborted) {
    throw new Error('geode: pipeline aborted');
  }
}
```

In `src/index.ts`, add:

```typescript
// Pipeline / batch execution
export {
  batchExec,
  pipelineExec,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_WORKERS,
  type PipelineExecutor,
  type PipelineTx,
} from './pipeline.js';
```

Note on Go-parity for "stops launching new chunks": the Go version launches a goroutine per chunk gated by a semaphore and breaks the launch loop when firstErr is set. The worker-pool form above is equivalent: each of `maxWorkers` workers pulls chunks until `firstErr` is set, then drains. In-flight `batchExec` calls finish (they are awaited inside the worker), matching "in-flight chunks complete".

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- pipeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts src/index.ts tests/unit/pipeline.test.ts
git commit -m "feat: add chunked pipelineExec and batchExec (GAP-0900)"
```

---

### Task 8: formatDSN

**Files:**

- Modify: `src/config.ts` (add `formatDSN`)
- Modify: `src/index.ts` (re-export)
- Test: `tests/unit/config.test.ts`, `tests/property/config.property.ts`

**Interfaces:**

- Consumes: `GeodeConfig`, `parseDSN`, `DEFAULT_*` constants from `./config.js`.
- Produces: `formatDSN(cfg: GeodeConfig): string` — inverse of `parseDSN`. Emits only non-default values as query params; credentials in the userinfo segment when both present, else as `user`/`pass` query params.

- [ ] **Step 1: Write the failing unit test**

Add to `tests/unit/config.test.ts`:

```typescript
describe('formatDSN', () => {
  it('round-trips a minimal config', () => {
    const cfg = parseDSN('quic://localhost:3141');
    const dsn = formatDSN(cfg);
    expect(parseDSN(dsn)).toEqual(cfg);
  });

  it('round-trips credentials, graph, tenant, role, and page_size', () => {
    const cfg = parseDSN(
      'quic://admin:secret@db.example.com:3141?page_size=500&tenant=acme&role=analyst&graph=g'
    );
    const dsn = formatDSN(cfg);
    expect(parseDSN(dsn)).toEqual(cfg);
  });

  it('emits scheme matching the transport', () => {
    const cfg = parseDSN('grpc://localhost:50051');
    expect(formatDSN(cfg).startsWith('grpc://')).toBe(true);
  });
});
```

Add `formatDSN` to the imports at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- config`
Expected: FAIL — `formatDSN` not exported.

- [ ] **Step 3: Implement**

In `src/config.ts`, add after `getAddress`:

```typescript
/**
 * Serialise a GeodeConfig back to a DSN string. Inverse of parseDSN: only
 * non-default values are emitted as query parameters to keep the DSN minimal.
 * Credentials go in the userinfo segment when both username and password are
 * present; a lone username uses userinfo, a lone password uses a `pass` param.
 */
export function formatDSN(cfg: GeodeConfig): string {
  const scheme = cfg.transport;
  const host = cfg.host.includes(':') ? `[${cfg.host}]` : cfg.host;
  const hostPort = `${host}:${cfg.port}`;

  const params = new URLSearchParams();
  if (cfg.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set('page_size', String(cfg.pageSize));
  }
  if (cfg.helloName && cfg.helloName !== DEFAULT_HELLO_NAME) {
    params.set('hello_name', cfg.helloName);
  }
  if (cfg.helloVersion && cfg.helloVersion !== DEFAULT_HELLO_VERSION) {
    params.set('hello_ver', cfg.helloVersion);
  }
  if (cfg.conformance && cfg.conformance !== DEFAULT_CONFORMANCE) {
    params.set('conformance', cfg.conformance);
  }
  if (cfg.tlsCA) {
    params.set('ca', cfg.tlsCA);
  }
  if (cfg.tlsCert) {
    params.set('cert', cfg.tlsCert);
  }
  if (cfg.tlsKey) {
    params.set('key', cfg.tlsKey);
  }
  if (cfg.insecureSkipVerify) {
    params.set('insecure_tls_skip_verify', 'true');
  }
  if (cfg.serverName) {
    params.set('server_name', cfg.serverName);
  }
  if (cfg.tls === false) {
    params.set('tls', '0');
  }
  if (cfg.graph) {
    params.set('graph', cfg.graph);
  }
  if (cfg.tenant) {
    params.set('tenant', cfg.tenant);
  }
  if (cfg.role) {
    params.set('role', cfg.role);
  }

  let userinfo = '';
  if (cfg.username && cfg.password) {
    userinfo = `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`;
  } else if (cfg.username) {
    userinfo = `${encodeURIComponent(cfg.username)}@`;
  } else if (cfg.password) {
    params.set('pass', cfg.password);
  }

  const query = params.toString();
  return `${scheme}://${userinfo}${hostPort}${query ? `?${query}` : ''}`;
}
```

In `src/index.ts`, add `formatDSN` to the `from './config.js'` export list.

Note: `parseDSN` defaults `tls` to `true` and applies env-var defaults. To keep the round-trip total, the property test (next step) clears the relevant env vars and compares against a config produced by `parseDSN` (so both sides share the same default baseline). `formatDSN` does not emit `connectTimeout`/`requestTimeout`/`keepAliveInterval`/`maxIdleTime`/`inlineTimeout` because `parseDSN` sets those from defaults, not from the DSN, and they are not part of the DSN contract; the round-trip test therefore starts from a `parseDSN` result so those fields already hold their default values on both sides.

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npm run test -- config`
Expected: PASS.

- [ ] **Step 5: Write the property test**

Add to `tests/property/config.property.ts` (add `formatDSN` to the import from `../../src/config.js`):

```typescript
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
```

Ensure the env-var clearing in `config.property.ts` (or add a `beforeEach`) deletes `GEODE_HOST`, `GEODE_PORT`, `GEODE_TLS_CA`, `GEODE_USERNAME`, `GEODE_PASSWORD`, `GEODE_TRANSPORT` so defaults are deterministic. If the file lacks such a hook, add:

```typescript
beforeEach(() => {
  for (const k of ['GEODE_HOST','GEODE_PORT','GEODE_TLS_CA','GEODE_USERNAME','GEODE_PASSWORD','GEODE_TRANSPORT']) {
    delete process.env[k];
  }
});
```

and import `beforeEach` from `vitest`.

- [ ] **Step 6: Run property test to verify it passes**

Run: `npm run test -- config.property`
Note: property tests live under `tests/property/`. If `npm run test` (configured to `tests/unit/**`) does not pick them up, run them explicitly: `npx vitest run tests/property/config.property.ts`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/index.ts tests/unit/config.test.ts tests/property/config.property.ts
git commit -m "feat: add formatDSN as inverse of parseDSN with property round-trip test"
```

---

### Task 9: Crypto FLE module

**Files:**

- Create: `src/crypto.ts`
- Modify: `src/index.ts` (re-export)
- Test: `tests/unit/crypto.test.ts`
- Bench: `tests/bench/crypto.bench.ts`

**Interfaces:**

- Produces: `class GeodeCipher` constructed via `createCipher(masterKey: Uint8Array | Buffer): GeodeCipher` (throws if key < 32 bytes), with:
  - `encrypt(plaintext: Uint8Array): Buffer` (nonce prepended)
  - `decrypt(ciphertext: Uint8Array): Buffer` (throws on short input or auth failure)
  - `encryptString(plaintext: string): string` (base64)
  - `decryptString(encoded: string): string`
  - `hmacHex(data: string): string` (64-char lowercase hex, deterministic)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createCipher } from '../../src/crypto.js';

const testKey = Buffer.alloc(32, 'k');

describe('createCipher', () => {
  it('creates a cipher from a 32-byte key', () => {
    expect(createCipher(testKey)).toBeDefined();
  });

  it('throws for a short key', () => {
    expect(() => createCipher(Buffer.from('short'))).toThrow();
  });

  it('throws for an empty key', () => {
    expect(() => createCipher(Buffer.alloc(0))).toThrow();
  });
});

describe('encrypt/decrypt', () => {
  it('round-trips binary data', () => {
    const c = createCipher(testKey);
    const pt = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f]);
    const ct = c.encrypt(pt);
    expect(c.decrypt(ct).equals(pt)).toBe(true);
  });

  it('prepends a 12-byte nonce (ciphertext longer than plaintext)', () => {
    const c = createCipher(testKey);
    const pt = Buffer.from('hello');
    const ct = c.encrypt(pt);
    // nonce(12) + plaintext(5) + GCM tag(16) = 33
    expect(ct.length).toBe(12 + pt.length + 16);
  });

  it('produces different ciphertext each call (random nonce)', () => {
    const c = createCipher(testKey);
    const pt = Buffer.from('hello');
    expect(c.encrypt(pt).equals(c.encrypt(pt))).toBe(false);
  });

  it('throws when ciphertext is too short', () => {
    const c = createCipher(testKey);
    expect(() => c.decrypt(Buffer.alloc(5))).toThrow();
  });

  it('throws when authentication fails (tampered ciphertext)', () => {
    const c = createCipher(testKey);
    const ct = c.encrypt(Buffer.from('hello'));
    ct[ct.length - 1] ^= 0xff;
    expect(() => c.decrypt(ct)).toThrow();
  });
});

describe('encryptString/decryptString', () => {
  it('round-trips a string via base64', () => {
    const c = createCipher(testKey);
    const encoded = c.encryptString('hello, geode!');
    expect(c.decryptString(encoded)).toBe('hello, geode!');
  });

  it('throws on invalid base64 / corrupt input', () => {
    const c = createCipher(testKey);
    expect(() => c.decryptString('!!!not-valid!!!')).toThrow();
  });
});

describe('hmacHex', () => {
  it('returns a 64-char lowercase hex digest', () => {
    const c = createCipher(testKey);
    const h = c.hmacHex('user@example.com');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input and key', () => {
    const c = createCipher(testKey);
    expect(c.hmacHex('x')).toBe(c.hmacHex('x'));
  });

  it('differs for different inputs', () => {
    const c = createCipher(testKey);
    expect(c.hmacHex('a')).not.toBe(c.hmacHex('b'));
  });

  it('differs for different keys', () => {
    const c1 = createCipher(Buffer.alloc(32, 'k'));
    const c2 = createCipher(Buffer.alloc(32, 'j'));
    expect(c1.hmacHex('x')).not.toBe(c2.hmacHex('x'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- crypto`
Expected: FAIL — module `src/crypto.js` not found.

- [ ] **Step 3: Implement**

Create `src/crypto.ts`:

```typescript
/**
 * Field-Level Encryption (FLE)
 *
 * Ports geode-client-go crypto/cipher.go using node:crypto:
 *  - AES-256-GCM authenticated encryption (random 12-byte nonce, prepended).
 *  - HKDF-SHA256 derives separate encryption and HMAC keys from a >= 32-byte
 *    master key.
 *  - HMAC-SHA256 hex digest for deterministic searchable encryption.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const KEY_SIZE = 32; // AES-256
const NONCE_SIZE = 12; // GCM nonce
const TAG_SIZE = 16; // GCM auth tag

/** Holds derived encryption and HMAC keys for field-level encryption. */
export class GeodeCipher {
  private readonly encKey: Buffer;
  private readonly hmacKey: Buffer;

  /** @internal Use createCipher(). */
  constructor(masterKey: Uint8Array) {
    if (masterKey.length < KEY_SIZE) {
      throw new Error(
        `geode: crypto: master key must be at least ${KEY_SIZE} bytes, got ${masterKey.length}`
      );
    }
    this.encKey = deriveKey(masterKey, 'geode-encrypt');
    this.hmacKey = deriveKey(masterKey, 'geode-hmac');
  }

  /** Encrypt with AES-256-GCM, prepending a random nonce. */
  encrypt(plaintext: Uint8Array): Buffer {
    const nonce = randomBytes(NONCE_SIZE);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, nonce);
    const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    // nonce || ciphertext || tag  (matches Go's Seal(nonce, ...) layout)
    return Buffer.concat([nonce, enc, tag]);
  }

  /** Decrypt a ciphertext produced by encrypt(). Throws on short input or auth failure. */
  decrypt(ciphertext: Uint8Array): Buffer {
    if (ciphertext.length < NONCE_SIZE + TAG_SIZE) {
      throw new Error('geode: crypto: ciphertext too short');
    }
    const buf = Buffer.from(ciphertext);
    const nonce = buf.subarray(0, NONCE_SIZE);
    const tag = buf.subarray(buf.length - TAG_SIZE);
    const data = buf.subarray(NONCE_SIZE, buf.length - TAG_SIZE);
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, nonce);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch (err) {
      throw new Error(`geode: crypto: decrypt: ${(err as Error).message}`);
    }
  }

  /** Encrypt a string, returning a base64-encoded result. */
  encryptString(plaintext: string): string {
    return this.encrypt(Buffer.from(plaintext, 'utf8')).toString('base64');
  }

  /** Base64-decode and decrypt, returning the original string. */
  decryptString(encoded: string): string {
    const ct = Buffer.from(encoded, 'base64');
    return this.decrypt(ct).toString('utf8');
  }

  /**
   * Compute HMAC-SHA256 of `data` using the derived HMAC key, returning a
   * 64-char lowercase hex digest. Deterministic; use for equality lookups on
   * encrypted fields.
   */
  hmacHex(data: string): string {
    return createHmac('sha256', this.hmacKey).update(data, 'utf8').digest('hex');
  }
}

/** Derive a KEY_SIZE-byte key from masterKey via HKDF-SHA256 (no salt, info label). */
function deriveKey(masterKey: Uint8Array, info: string): Buffer {
  // hkdfSync(digest, ikm, salt, info, keylen) -> ArrayBuffer
  const out = hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from(info, 'utf8'), KEY_SIZE);
  return Buffer.from(out);
}

/** Create a GeodeCipher from a master key (>= 32 bytes). */
export function createCipher(masterKey: Uint8Array): GeodeCipher {
  return new GeodeCipher(masterKey);
}
```

Note on layout parity: Go's `aead.Seal(nonce, nonce, plaintext, nil)` returns `nonce || ciphertext || tag` (Go appends the GCM tag after the ciphertext). The Node implementation above reproduces that exact byte layout (`nonce || enc || tag`), so ciphertext is wire-compatible with the Go cipher for the same derived key. HKDF with empty salt + the same info strings (`geode-encrypt`, `geode-hmac`) matches Go's `hkdf.New(sha256.New, masterKey, nil, []byte(info))`.

In `src/index.ts`, add:

```typescript
// Field-level encryption (FLE)
export { createCipher, GeodeCipher } from './crypto.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- crypto`
Expected: PASS.

- [ ] **Step 5: Write the benchmark**

Create `tests/bench/crypto.bench.ts`:

```typescript
import { describe, bench } from 'vitest';
import { createCipher } from '../../src/crypto.js';

const cipher = createCipher(Buffer.alloc(32, 'k'));
const small = Buffer.from('user@example.com');
const large = Buffer.alloc(4096, 0x61);
const encodedSmall = cipher.encryptString('user@example.com');

describe('Crypto FLE Benchmarks', () => {
  bench('encrypt 16B', () => {
    cipher.encrypt(small);
  });

  bench('encrypt 4KB', () => {
    cipher.encrypt(large);
  });

  bench('encryptString', () => {
    cipher.encryptString('user@example.com');
  });

  bench('decryptString', () => {
    cipher.decryptString(encodedSmall);
  });

  bench('hmacHex', () => {
    cipher.hmacHex('user@example.com');
  });
});
```

- [ ] **Step 6: Run the benchmark to verify it runs**

Run: `npx vitest bench tests/bench/crypto.bench.ts --run`
Expected: bench completes with reported hz for each case.

- [ ] **Step 7: Commit**

```bash
git add src/crypto.ts src/index.ts tests/unit/crypto.test.ts tests/bench/crypto.bench.ts
git commit -m "feat: add AES-256-GCM field-level encryption module with HKDF + HMAC"
```

---

### Task 10: Integration tests for parity features

**Files:**

- Create: `tests/integration/parity.test.ts`

**Interfaces:**

- Consumes: `createClient`, `parseSchemaFS`, `pipelineExec`, `batchExec`, `quoteIdent`, `quoteString`, `sanitizeGraphName`, `createCipher`, `formatDSN`, `parseDSN` from `../../src/index.js`.

Integration tests follow the existing testcontainers/skip-if-unavailable pattern in `tests/integration/geode.test.ts`: they connect with retry and `describe.skip`/early-return when no server is reachable, but MUST compile and be wired into `test:integration` (the existing `vitest.integration.config.ts` already globs `tests/integration/**/*.test.ts`).

- [ ] **Step 1: Write the integration test**

Create `tests/integration/parity.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, GeodeClient } from '../../src/index.js';
import { parseSchemaFS } from '../../src/schema.js';
import { pipelineExec, batchExec } from '../../src/pipeline.js';
import { quoteIdent, quoteString, sanitizeGraphName } from '../../src/quote.js';
import { createCipher } from '../../src/crypto.js';
import { formatDSN, parseDSN } from '../../src/config.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = process.env['GEODE_HOST'] ?? '127.0.0.1';
const PORT = process.env['GEODE_PORT'] ?? '3141';
const DSN = `quic://${HOST}:${PORT}?insecure=true`;

let client: GeodeClient | null = null;
let available = false;

beforeAll(async () => {
  try {
    client = await createClient(DSN, { pooling: true, connectTimeout: 3000 });
    available = true;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (client) await client.close();
});

describe('Parity integration', () => {
  it('quoting + crypto + DSN helpers work without a server', () => {
    // Pure-function parity checks always run.
    expect(quoteIdent('Person')).toBe('Person');
    expect(quoteString("it's")).toBe("'it''s'");
    expect(sanitizeGraphName('bad name!')).toBe('badname');
    const cfg = parseDSN(DSN);
    expect(parseDSN(formatDSN(cfg))).toEqual(cfg);
    const cipher = createCipher(Buffer.alloc(32, 'k'));
    expect(cipher.decryptString(cipher.encryptString('x'))).toBe('x');
  });

  it('parseSchemaFS + pipelineExec apply a schema (server required)', async () => {
    if (!available || !client) {
      console.log('Skipping: no Geode server reachable');
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'geode-parity-'));
    try {
      await writeFile(
        join(dir, 'schema.gql'),
        'CREATE (a:ParityTest {n: 1})\nCREATE (b:ParityTest {n: 2})\n'
      );
      const stmts = await parseSchemaFS(dir);
      expect(stmts.length).toBe(2);
      const pool = client.pool;
      if (pool) {
        await batchExec(pool, stmts.slice(0, 1));
        await pipelineExec(pool, stmts, { chunkSize: 1, maxWorkers: 2 });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

If `GeodeClient` does not expose a `pool` getter compatible with `PipelineExecutor`, adapt this test to call `client`'s transaction API directly, or construct a `ConnectionPool` via `ConnectionPool.create(...)` and pass that to `pipelineExec`/`batchExec`. The pure-function assertion block must remain server-independent.

- [ ] **Step 2: Verify it compiles and is wired in**

Run: `npm run typecheck`
Expected: PASS (no type errors).

Run: `npm run test:integration`
Expected: the suite loads; the pure-function test passes; the server-dependent test passes or no-op-returns when no server is reachable. It must not error on a missing server.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/parity.test.ts
git commit -m "test: add integration tests for driver parity features"
```

---

### Task 11: Final verification + benchmarks

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: 0 errors. Fix any issues, re-run.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Format check**

Run: `npm run format:check`
Expected: all files formatted. If it fails, run `npm run format`, review, and amend the relevant commit or add a `style:` commit.

- [ ] **Step 4: Unit tests**

Run: `npm run test`
Expected: all tests pass (baseline 780 + new tests).

- [ ] **Step 5: Property tests**

Run: `npx vitest run tests/property/`
Expected: all property tests pass.

- [ ] **Step 6: Benchmarks**

Run: `npm run bench`
Expected: all bench suites (including the new crypto bench) complete and report results.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "chore: lint, format, and verification fixes for driver parity" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**

1. HELLO tenant_id + role -> Task 1 (config parse, proto field+role=8, buildHelloRequest, connection wiring). ✓
2. ParseSchemaFS -> Task 6. ✓
3. Quoting helpers (quoteIdent/quoteString/sanitizeGraphName + ErrInvalidIdent/ErrInvalidString) -> Task 2. ✓
4. ErrNoRows + queryRow -> Task 5. ✓
5. Crypto FLE -> Task 9 (+ bench). ✓
6. Chunked pipelineExec + batchExec (GAP-0900) -> Task 7. ✓
7. RetryPolicy + retry -> Task 3. ✓
8. formatDSN (+ property round-trip) -> Task 8. ✓
9. isAuthError / isSyntaxError -> Task 4. ✓
Integration tests -> Task 10. Verification/bench -> Task 11. ✓

**Placeholder scan:** All code steps contain complete implementations; no TBD/TODO. Test bodies are concrete.

**Type consistency:** `Statement { query; params? }` defined in Task 6 and consumed in Task 7. `PipelineExecutor`/`PipelineTx` defined and used consistently in Task 7. `RetryPolicy`/`retry`/`backoffDelay` defined in Task 3 and consumed in Task 7. `buildHelloRequest` 8-arg signature consistent between Task 1 implementation and connection call site. `createCipher`/`GeodeCipher` consistent in Task 9 + bench + integration. `formatDSN` consistent in Task 8 + integration.
