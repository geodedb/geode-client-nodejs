# Quality Gap Analysis -- Geode Node.js Client

Last updated: 2026-03-24

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 4     |
| High     | 2     |
| Medium   | 8     |
| Low      | 10    |
| **Total**| **24**|

### Top 5 Risks

1. **A1** -- `batchParallel` is fundamentally broken for concurrency > 1 on a single connection (PriorityScore 90)
2. **A2** -- `prepare()` releases pool connection before `PreparedStatement` is used (PriorityScore 85)
3. **A3** -- `auth()` acquires a pool connection and never releases it (PriorityScore 85)
4. **T7** -- Connection method `exec` does not drain multi-page results, corrupting subsequent queries (PriorityScore 80)
5. **T1/T2** -- 0-28% test coverage on critical modules (PriorityScore 70)

---

## Stack-Ranked Findings

| Rank | ID | Severity | PriorityScore | Category | Finding | Component | Evidence | Issue URL | Fix Summary | Owner | ETA/SLA | Status |
|------|----|----------|---------------|----------|---------|-----------|----------|-----------|-------------|-------|---------|--------|
| 1 | A1 | Critical | 90 | architecture | `batchParallel` broken for concurrency > 1 on single connection | batch.ts, connection.ts | batch.ts:309-326 calls `conn.query()` concurrently; connection.ts:764-776 `checkState()` throws `ErrQueryInProgress` if state is `fetching` or `activeResult` set | -- | Accept a pool (or connection-factory) instead of a single `Connection`; acquire one connection per in-flight query | TBD | Before next release | triage |
| 2 | A2 | Critical | 85 | architecture | `prepare()` releases connection before `PreparedStatement` consumed | client.ts | client.ts:500-507 -- `finally { await this.releaseConnection(conn) }` runs immediately after `conn.prepare()` returns, while the `PreparedStatement` still references the now-released connection | -- | Defer release until `PreparedStatement.close()` or wrap in a checkout guard | TBD | Before next release | triage |
| 3 | A3 | Critical | 85 | architecture | `auth()` acquires connection but never releases it | client.ts | client.ts:590-594 -- `const conn = await this.getConnection(); return new AuthClient(conn);` with no matching `releaseConnection()` call anywhere in the `AuthClient` lifecycle | -- | Add `close()`/`dispose()` on `AuthClient` that releases the connection; or use a per-call acquire/release pattern | TBD | Before next release | triage |
| 4 | T7 | Critical | 80 | architecture | Connection method does not drain multi-page results | connection.ts | connection.ts:438-448 -- only a single `_tryReceiveInline` is called after a SCHEMA response; if the server sends multiple BINDINGS pages the remaining pages are left in the transport buffer, corrupting the next query on that connection | -- | Loop `_tryReceiveInline` until `final=true` or add a DISCARD/RESET before returning to idle | TBD | Before next release | triage |
| 5 | T1/T2 | High | 70 | tests | 0% and ~28% coverage on client.ts, pool.ts, transaction.ts, grpc-transport.ts | client.ts, pool.ts, transaction.ts, grpc-transport.ts | No test files exist for client.ts or transaction.ts; pool.test.ts is new/untracked; grpc-transport has no tests | -- | Write unit tests targeting 80%+ coverage per module; mock transport layer for client.ts and pool.ts tests | TBD | 2 weeks | triage |
| 6 | A4 | High | 50 | maintainability | Sentinel errors are shared mutable singleton `Error` instances | errors.ts | errors.ts:195-201 -- `export const ErrClosed = new Error(...)` etc. All thrown references share a single `.stack` that reflects the module-load site, not the throw site | -- | Replace with factory functions (e.g. `function errClosed() { return new Error(...) }`) | TBD | 1 day | triage |
| 7 | A5 | Medium | 45 | api-contract | gRPC transport silently ignores savepoint/rollbackTo | grpc-transport.ts | grpc-transport.ts:217-228 -- methods are stubs or throw generic errors; no documentation warns callers | -- | Throw a clear `UnsupportedOperationError` with transport name; add note to public API docs | TBD | 1 day | triage |
| 8 | R1 | Medium | 40 | maintainability | Config mutation via `Object.assign` in `GeodeClient.connect()` | client.ts | client.ts:54 -- `Object.assign(config, options)` mutates the parsed config object in-place | -- | Use spread: `const merged = { ...config, ...options }` | TBD | < 1 hour | triage |
| 9 | T5 | Medium | 40 | architecture | Pool maintenance can exceed `maxConnections` | pool.ts | pool.ts:488-494 -- `addConnection()` called in a loop to fill `minConnections` without checking current total against `maxConnections` | -- | Guard `addConnection()` calls with `this._connections.length < this._maxConnections` check | TBD | < 1 hour | triage |
| 10 | R2 | Medium | 35 | maintainability | Duplicated abort-signal wiring pattern (6 occurrences across 4 files) | connection.ts, client.ts, batch.ts, transport.ts | Manual `AbortController` + `setTimeout` + `clearTimeout` pattern repeated identically | -- | Extract `withTimeout(ms, signal?)` utility returning `{ signal, cleanup }` | TBD | 1 day | triage |
| 11 | R3 | Medium | 35 | maintainability | Duplicated TLS cert-loading logic | transport.ts, grpc-transport.ts | Both files independently read cert/key/CA files with `fs.readFileSync` and similar validation | -- | Extract shared `loadTLSCredentials(config)` into a `tls-utils.ts` module | TBD | 1 day | triage |
| 12 | A6 | Medium | 35 | api-contract | `fromJSON` type inference produces surprising results | types.ts | types.ts:669-681 -- strings matching UUID regex become `GQLValue.uuid()`; ISO-date-like strings become `GQLValue.timestamp()`, silently changing the GQL type sent to the server | -- | Remove implicit type coercion; require explicit `GQLValue.uuid()` / `GQLValue.timestamp()` from callers; or add an opt-in `strict` flag | TBD | 1 day | triage |
| 13 | R6 | Medium | 30 | maintainability | auth.ts private validators duplicate validate.ts | auth.ts, validate.ts | auth.ts contains inline regex checks for usernames/roles that overlap with `validate.ts` exports | -- | Import and reuse validators from `validate.ts` | TBD | < 1 hour | triage |
| 14 | D3 | Medium | 30 | docs | No transport selection (QUIC vs gRPC) documentation | -- | No docs explain when to use which transport, configuration differences, or feature parity gaps | -- | Add a "Transport Selection" section to README or a dedicated `docs/TRANSPORT.md` | TBD | 1 day | triage |
| 15 | T8 | Low | 25 | ci-cd | ESLint ignores all test files + dual config present | eslint.config.js, .eslintrc | New `eslint.config.js` (untracked) coexists with legacy config; tests excluded from linting | -- | Consolidate to single flat config; lint tests with relaxed rule set | TBD | 1 day | triage |
| 16 | T4 | Low | 20 | perf | Hardcoded 5 s inline timeout in `_tryReceiveInline` | connection.ts | connection.ts:503 -- `setTimeout(() => controller.abort(), 5000)` with no config override | -- | Source from `this._config.requestTimeout` or a dedicated `inlineTimeout` config field | TBD | < 1 hour | triage |
| 17 | D2 | Low | 20 | docs | `batchParallel` JSDoc is misleading | batch.ts | batch.ts:300-308 -- JSDoc says "parallel" but uses a single connection, which serializes | -- | Update JSDoc to document single-connection limitation and recommend pool-based usage | TBD | < 1 hour | triage |
| 18 | R4/R5 | Low | 15 | cleanup | Dead code -- legacy aliases and legacy JSON methods | types.ts, query-builder.ts | Legacy re-exports and deprecated JSON serialization methods that are no longer referenced | -- | Remove dead exports; if public API, deprecate formally for one release cycle first | TBD | 1 day | triage |
| 19 | R7 | Low | 10 | maintainability | Builder mutation via `Object.assign` in query-builder | query-builder.ts | Builder methods mutate internal state objects with `Object.assign` instead of producing new copies | -- | Use spread operator to produce immutable builder steps | TBD | 1 day | triage |
| 20 | R8 | Low | 10 | maintainability | 5 source files exceed 800-line threshold | query-builder.ts (943), validate.ts (915), types.ts (913), connection.ts (842), auth.ts (834) | `wc -l` output | -- | Extract logical sub-modules (e.g. `query-builder-patterns.ts`, `type-conversions.ts`) | TBD | 2-3 days | triage |
| 21 | T6 | Low | 10 | perf | Pool idle eviction over-retains connections | pool.ts | Idle eviction only removes closed connections, never proactively shrinks below `minConnections` even when load is zero | -- | Add configurable idle-timeout eviction that shrinks toward `minConnections` | TBD | 1 day | triage |
| 22 | D1 | Low | 10 | docs | Missing JSDoc on internal public methods | connection.ts, pool.ts, transport.ts | Multiple exported methods lack `@param` / `@returns` / `@throws` documentation | -- | Add JSDoc to all public/exported symbols | TBD | 2 days | triage |
| 23 | D4 | Low | 10 | docs | CLAUDE.md connection state machine is stale | CLAUDE.md | State diagram omits the `error` state defined in errors.ts:186-192 | -- | Update state machine diagram in CLAUDE.md | TBD | < 1 hour | triage |
| 24 | D5 | Low | 10 | docs | No contributor onboarding guide | -- | No CONTRIBUTING.md or developer setup guide exists | -- | Create CONTRIBUTING.md covering setup, test, lint, and PR workflow | TBD | 1 day | triage |

---

## Findings by Category

### Architecture (5 findings)

| ID | Severity | PriorityScore | Finding |
|----|----------|---------------|---------|
| A1 | Critical | 90 | `batchParallel` broken for concurrency > 1 |
| A2 | Critical | 85 | `prepare()` connection lifecycle bug |
| A3 | Critical | 85 | `auth()` connection leak |
| T7 | Critical | 80 | Result drain missing in connection |
| T5 | Medium   | 40 | Pool maintenance exceeds maxConnections |

### Tests (1 finding)

| ID | Severity | PriorityScore | Finding |
|----|----------|---------------|---------|
| T1/T2 | High | 70 | 0-28% coverage on critical modules |

### Maintainability (6 findings)

| ID | Severity | PriorityScore | Finding |
|----|----------|---------------|---------|
| A4 | High   | 50 | Sentinel errors are shared mutable singletons |
| R1 | Medium | 40 | Config mutation via Object.assign |
| R2 | Medium | 35 | Duplicated abort-signal wiring |
| R3 | Medium | 35 | Duplicated TLS cert loading |
| R6 | Medium | 30 | Duplicated validators in auth.ts |
| R7 | Low    | 10 | Builder mutation via Object.assign |

### API Contract (2 findings)

| ID | Severity | PriorityScore | Finding |
|----|----------|---------------|---------|
| A5 | Medium | 45 | gRPC transport missing savepoint support |
| A6 | Medium | 35 | `fromJSON` implicit type coercion surprises |

### Performance (2 findings)

| ID | Severity | PriorityScore | Finding |
|----|----------|---------------|---------|
| T4 | Low | 20 | Hardcoded 5s inline timeout |
| T6 | Low | 10 | Pool idle eviction over-retains |

### CI/CD (1 finding)

| ID | Severity | PriorityScore | Finding |
|----|----------|---------------|---------|
| T8 | Low | 25 | ESLint ignores tests + dual config |

### Documentation (5 findings)

| ID | Severity | PriorityScore | Finding |
|----|----------|---------------|---------|
| D3 | Medium | 30 | No transport selection docs |
| D2 | Low    | 20 | Misleading batchParallel JSDoc |
| D1 | Low    | 10 | Missing JSDoc on public methods |
| D4 | Low    | 10 | Stale CLAUDE.md state machine |
| D5 | Low    | 10 | No contributor onboarding guide |

### Cleanup (1 finding)

| ID | Severity | PriorityScore | Finding |
|----|----------|---------------|---------|
| R4/R5 | Low | 15 | Dead code -- legacy aliases and JSON methods |

---

## Detailed Evidence

### A1: `batchParallel` broken for concurrency > 1 (Critical, PriorityScore 90)

**Confidence:** confirmed

**Summary:** `batchParallel` accepts a single `Connection` and launches concurrent `conn.query()` calls, but `Connection.checkState()` throws `ErrQueryInProgress` whenever the connection is not idle.

**Evidence:**

`src/batch.ts:309-326` -- takes a single `conn: Connection` parameter and calls `conn.query()` in a concurrent loop:
```typescript
export async function batchParallel(
  conn: Connection,
  queries: BatchQuery[],
  options?: BatchOptions & { concurrency: number }
): Promise<BatchSummary> {
  // ...
  async function executeQuery(index: number): Promise<void> {
    const queryResult = await conn.query(q.query, { ... });
```

`src/connection.ts:764-776` -- guard that prevents concurrent use:
```typescript
private checkState(operation: string): void {
  if (this._state === 'fetching' || this._activeResult) {
    throw ErrQueryInProgress;
  }
}
```

**Root cause:** API design assumes multiplexed connection, but the QUIC transport is single-stream-at-a-time per `Connection`.

**Recommended change:** Accept a `Pool` or connection-factory callback instead of a single `Connection`. Acquire one connection per in-flight query slot.

**Acceptance criteria:** `batchParallel` with `concurrency: 4` and 10 queries completes without `ErrQueryInProgress`.

**Verification:** `npm test -- --grep batchParallel` passes; add integration test with concurrency > 1.

**Effort:** M

---

### A2: `prepare()` releases connection before `PreparedStatement` used (Critical, PriorityScore 85)

**Confidence:** confirmed

**Summary:** `GeodeClient.prepare()` calls `this.releaseConnection(conn)` in a `finally` block immediately after `conn.prepare()` returns. The returned `PreparedStatement` still holds a reference to the now-released (and potentially reassigned) connection.

**Evidence:**

`src/client.ts:500-507`:
```typescript
async prepare(query: string): Promise<PreparedStatement> {
  const conn = await this.getConnection();
  try {
    return conn.prepare(query);
  } finally {
    await this.releaseConnection(conn);
  }
}
```

**Root cause:** Standard acquire/release pattern applied to a resource that outlives the method scope.

**Recommended change:** Do not release the connection in `prepare()`. Instead, have `PreparedStatement.close()` release the connection, or wrap the statement in a checkout guard that auto-releases on disposal.

**Acceptance criteria:** A `PreparedStatement` obtained via `client.prepare()` can run multiple queries without connection errors; the pool connection is released when the statement is closed.

**Verification:** Unit test: `prepare()` -> `stmt.query()` -> `stmt.query()` -> `stmt.close()` succeeds.

**Effort:** S

---

### A3: `auth()` acquires connection but never releases it (Critical, PriorityScore 85)

**Confidence:** confirmed

**Summary:** `GeodeClient.auth()` acquires a connection from the pool and passes it to a new `AuthClient`, but there is no code path that ever returns the connection to the pool.

**Evidence:**

`src/client.ts:590-594`:
```typescript
async auth(): Promise<AuthClient> {
  const { AuthClient } = await import('./auth.js');
  const conn = await this.getConnection();
  return new AuthClient(conn);
}
```

No `close()` or `releaseConnection()` exists on `AuthClient`.

**Root cause:** Missing lifecycle management on `AuthClient`.

**Recommended change:** Add `AuthClient.close()` that calls `releaseConnection()`; or switch to per-call connection acquisition inside `AuthClient` methods.

**Acceptance criteria:** Calling `auth()` N times and closing each `AuthClient` returns N connections to the pool; pool does not report leaked connections.

**Verification:** Unit test that asserts pool available count after auth client lifecycle.

**Effort:** S

---

### T7: Connection does not drain multi-page results (Critical, PriorityScore 80)

**Confidence:** confirmed

**Summary:** When the connection method receives a SCHEMA response (indicating result data), it calls `_tryReceiveInline` only once. If the server produces multiple BINDINGS pages, the remaining pages are left in the transport buffer, causing the next query on that connection to read stale data.

**Evidence:**

`src/connection.ts:438-448`:
```typescript
if (isSchemaResponse(execResp)) {
  this._columns = execResp.schema!.columns;
  const inlineResponse = await this._tryReceiveInline(signal);
  // Only one page drained
}
```

**Root cause:** The method was designed for DDL/DML that returns no rows, but the server may still send row data for some operations.

**Recommended change:** Loop `_tryReceiveInline` until either a response with `final: true` is received or the timeout fires. Alternatively, send a DISCARD/RESET message before returning the connection to idle.

**Acceptance criteria:** Running a statement on a dataset with > 1 page of results does not corrupt the next query on the same connection.

**Verification:** Integration test: run a statement returning a large result set, then query on same connection and verify success.

**Effort:** S

---

### T1/T2: 0-28% test coverage on critical modules (High, PriorityScore 70)

**Confidence:** confirmed

**Summary:** `client.ts`, `transaction.ts`, and `grpc-transport.ts` have 0% unit test coverage. `pool.ts` has approximately 28% coverage. These are core modules that handle connection lifecycle, transactions, and transport.

**Evidence:** No test files exist for `client.ts` or `transaction.ts`. `pool.test.ts` exists but is untracked (new). `grpc-transport.ts` has no corresponding test file.

**Root cause:** Rapid iteration without test-first development.

**Recommended change:** Write unit tests mocking the transport layer; target 80%+ line coverage per module.

**Acceptance criteria:** `npm run test:coverage` reports >= 80% line coverage for client.ts, pool.ts, transaction.ts, and grpc-transport.ts.

**Verification:** `npm run test:coverage`

**Effort:** L

---

### A4: Sentinel errors are shared mutable singletons (High, PriorityScore 50)

**Confidence:** confirmed

**Summary:** Sentinel errors (`ErrClosed`, `ErrQueryInProgress`, etc.) are module-level `const` Error instances. Their `.stack` property reflects the module-load call site, not the throw site.

**Evidence:**

`src/errors.ts:195-201`:
```typescript
export const ErrClosed = new Error('geode: connection closed');
export const ErrQueryInProgress = new Error('geode: query already in progress');
export const ErrTxInProgress = new Error('geode: transaction already in progress');
export const ErrNoTx = new Error('geode: no transaction in progress');
export const ErrTxDone = new Error('geode: transaction already committed or rolled back');
export const ErrRowsClosed = new Error('geode: rows closed');
export const ErrBadConn = new Error('geode: bad connection');
```

**Root cause:** Pattern borrowed from Go sentinel errors, which do not carry stack traces.

**Recommended change:** Replace with factory functions: `export function errClosed() { return new Error('geode: connection closed'); }`. Update call sites from `throw ErrClosed` to `throw errClosed()`. Retain the sentinel `message` strings as constants for identity checks.

**Acceptance criteria:** Each thrown error has a stack trace pointing to the throw site.

**Verification:** Unit test: catch `errClosed()`, verify `.stack` contains the test file name.

**Effort:** S

---

### A5: gRPC transport silently ignores savepoint/rollbackTo (Medium, PriorityScore 45)

**Confidence:** suspected -- needs confirmation by running `savepoint()` through gRPC transport and observing behavior.

**Summary:** The gRPC transport implementation either stubs out or throws generic errors for `savepoint()` and `rollbackTo()` operations without clear documentation of this limitation.

**Evidence:** `src/grpc-transport.ts:217-228` (reported; file not read in full during this analysis).

**Recommended change:** Throw a descriptive `UnsupportedOperationError('savepoint is not supported by the gRPC transport')`. Document the limitation in transport selection docs.

**Acceptance criteria:** Calling `savepoint()` on a gRPC connection throws `UnsupportedOperationError` with a clear message.

**Verification:** Unit test for gRPC transport `savepoint()` and `rollbackTo()`.

**Effort:** S

---

### R1: Config mutation via Object.assign (Medium, PriorityScore 40)

**Confidence:** confirmed

**Evidence:** `src/client.ts:54` -- `Object.assign(config, options)` mutates the parsed config in-place.

**Recommended change:** `const merged = { ...config, ...options };`

**Effort:** S (< 1 hour)

---

### T5: Pool maintenance can exceed maxConnections (Medium, PriorityScore 40)

**Confidence:** confirmed

**Evidence:** `src/pool.ts:488-494` -- the `addConnection()` loop targets `minConnections` without checking `this._connections.length < this._maxConnections`.

**Recommended change:** Add guard: `if (this._connections.length >= this._maxConnections) break;`

**Effort:** S (< 1 hour)

---

### R2: Duplicated abort-signal wiring pattern (Medium, PriorityScore 35)

**Confidence:** confirmed

**Summary:** The manual `AbortController` + `setTimeout` + `clearTimeout` pattern appears 6 times across connection.ts, client.ts, batch.ts, and transport.ts.

**Recommended change:** Extract a shared `withTimeout(ms: number, parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void }` utility.

**Effort:** S

---

### R3: Duplicated TLS cert loading (Medium, PriorityScore 35)

**Confidence:** confirmed

**Summary:** Both `transport.ts` and `grpc-transport.ts` independently load TLS certificates from disk with `fs.readFileSync` and perform similar validation.

**Recommended change:** Extract into `src/tls-utils.ts` with a `loadTLSCredentials(config: GeodeConfig)` function.

**Effort:** S

---

### A6: `fromJSON` type inference surprises (Medium, PriorityScore 35)

**Confidence:** confirmed

**Evidence:** `src/types.ts:669-681`:
```typescript
if (typeof value === 'string') {
  if (/^[0-9a-f]{8}-...$/i.test(value)) {
    return GQLValue.uuid(value);
  }
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value)) {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return GQLValue.timestamp(date);
    }
  }
  return GQLValue.string(value);
}
```

A string like `"2024-01-15"` silently becomes a `TIMESTAMP` instead of a `STRING`, changing the GQL type sent to the server.

**Recommended change:** Remove implicit coercion; require callers to use explicit `GQLValue.uuid()` / `GQLValue.timestamp()`. Or add an opt-in `{ strict: true }` flag that disables heuristic coercion.

**Effort:** S

---

### R6: auth.ts private validators duplicate validate.ts (Medium, PriorityScore 30)

**Confidence:** suspected -- exact duplication extent unverified.

**Recommended change:** Import and reuse validators from `validate.ts`.

**Effort:** S (< 1 hour)

---

### D3: No transport selection documentation (Medium, PriorityScore 30)

**Confidence:** confirmed

**Recommended change:** Add `docs/TRANSPORT.md` or a README section covering QUIC vs gRPC: when to use each, feature parity matrix, configuration examples.

**Effort:** S

---

### T8: ESLint ignores all tests + dual config (Low, PriorityScore 25)

**Confidence:** confirmed

**Evidence:** Untracked `eslint.config.js` coexists with legacy config. Test files are excluded from linting entirely.

**Recommended change:** Consolidate to a single flat ESLint config. Add a test override block with relaxed rules (allow `any` in mocks, etc.).

**Effort:** S

---

### T4: Hardcoded 5s inline timeout (Low, PriorityScore 20)

**Confidence:** confirmed

**Evidence:** `src/connection.ts:503` -- `setTimeout(() => controller.abort(), 5000)`.

**Recommended change:** Read from `this._config.requestTimeout` or a dedicated `inlineTimeout` field.

**Effort:** S (< 1 hour)

---

### D2: batchParallel misleading JSDoc (Low, PriorityScore 20)

**Confidence:** confirmed

**Evidence:** `src/batch.ts:300-308` -- JSDoc says "parallel" but uses a single connection which serializes.

**Recommended change:** Update JSDoc to document single-connection limitation and recommend pool-based usage until A1 is resolved.

**Effort:** S (< 1 hour)

---

### R4/R5: Dead code -- legacy aliases and JSON methods (Low, PriorityScore 15)

**Confidence:** suspected -- full dead-code analysis not run; based on review findings.

**Recommended change:** Audit with `ts-prune` or similar tool; remove confirmed dead exports. If part of public API, formally deprecate for one release cycle first.

**Effort:** S

---

### R7: Builder mutation via Object.assign (Low, PriorityScore 10)

**Confidence:** confirmed

**Summary:** Query builder methods mutate internal state objects with `Object.assign` instead of producing new copies, violating immutability expectations.

**Recommended change:** Use spread operator to produce new state on each builder call.

**Effort:** S

---

### R8: 5 files exceed 800-line threshold (Low, PriorityScore 10)

**Confidence:** confirmed

**Evidence:**
- `query-builder.ts` -- 943 lines
- `validate.ts` -- 915 lines
- `types.ts` -- 913 lines
- `connection.ts` -- 842 lines
- `auth.ts` -- 834 lines

**Recommended change:** Extract logical sub-modules (e.g. `query-builder-patterns.ts`, `type-conversions.ts`, `validate-gql.ts`).

**Effort:** M

---

### T6: Pool idle eviction over-retains connections (Low, PriorityScore 10)

**Confidence:** suspected -- behavior inferred from maintenance code, not load-tested.

**Summary:** Idle eviction only removes closed connections; it never proactively shrinks below `minConnections` when load drops to zero.

**Recommended change:** Add configurable idle-timeout eviction that can shrink pool down to `minConnections`.

**Effort:** S

---

### D1: Missing JSDoc on internal public methods (Low, PriorityScore 10)

**Confidence:** confirmed

**Recommended change:** Add JSDoc with `@param`, `@returns`, `@throws` to all exported symbols.

**Effort:** M

---

### D4: CLAUDE.md connection state machine is stale (Low, PriorityScore 10)

**Confidence:** confirmed

**Evidence:** CLAUDE.md state diagram omits the `error` state defined in `errors.ts:186-192`.

**Recommended change:** Update state machine diagram in CLAUDE.md.

**Effort:** S (< 1 hour)

---

### D5: No contributor onboarding guide (Low, PriorityScore 10)

**Confidence:** confirmed

**Recommended change:** Create `CONTRIBUTING.md` with setup, test, lint, and PR workflow instructions.

**Effort:** S

---

## Roadmap

### Quick Wins (< 1 day)

| ID | Finding | Effort |
|----|---------|--------|
| R1 | Replace `Object.assign(config, options)` with spread | S |
| T5 | Add maxConnections guard in pool maintenance | S |
| T4 | Make inline timeout configurable | S |
| D2 | Fix misleading batchParallel JSDoc | S |
| D4 | Update CLAUDE.md state machine | S |
| R6 | Deduplicate auth.ts validators | S |
| A4 | Replace sentinel error singletons with factory functions | S |
| A5 | Throw clear UnsupportedOperationError for gRPC savepoint | S |

### Medium (1-5 days)

| ID | Finding | Effort |
|----|---------|--------|
| A2 | Fix prepare() connection lifecycle | S |
| A3 | Fix auth() connection leak | S |
| T7 | Drain multi-page results in connection | S |
| R2 | Extract shared abort-signal timeout utility | S |
| R3 | Extract shared TLS cert loading | S |
| A6 | Remove implicit type coercion in fromJSON | S |
| T8 | Consolidate ESLint config; lint tests | S |
| D3 | Write transport selection documentation | S |
| R7 | Fix builder mutation | S |
| R4/R5 | Remove dead code after audit | S |

### Strategic (> 5 days)

| ID | Finding | Effort |
|----|---------|--------|
| A1 | Redesign batchParallel to accept pool/factory | M |
| T1/T2 | Achieve 80%+ coverage on client, pool, transaction, grpc-transport | L |
| R8 | Break up 5 oversized files | M |
| D1 | Add JSDoc to all public symbols | M |
| D5 | Create CONTRIBUTING.md | S |
| T6 | Implement proper idle eviction | S |

---

## Unknowns and Confirmation Needed

| ID | What is suspected | What would confirm |
|----|-------------------|--------------------|
| A5 | gRPC savepoint stubs silently fail | Run `conn.savepoint('sp1')` through gRPC transport and inspect behavior |
| R6 | auth.ts validators are exact duplicates of validate.ts | Diff the regex patterns in both files |
| R4/R5 | Legacy aliases and JSON methods are dead code | Run `ts-prune` or `knip` against the codebase |
| T6 | Pool never shrinks below minConnections under zero load | Load test: create pool with min=5, drive traffic, then idle for 10 minutes; observe connection count |
