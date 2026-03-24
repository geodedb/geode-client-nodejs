# Quality Gap Analysis -- Geode Node.js Client

Last updated: 2026-03-24

---

## Summary

| Severity | Count | Closed | Won't Do | Open |
|----------|-------|--------|----------|------|
| Critical | 4     | 4      | 0        | 0    |
| High     | 2     | 2      | 0        | 0    |
| Medium   | 8     | 4      | 1        | 3    |
| Low      | 10    | 3      | 1        | 6    |
| **Total**| **24**| **13** | **2**    | **9**|

### Closed Items (Phase A/B)

1. **A1** -- `batchParallel` concurrency -- **Closed** (Phase B)
2. **A2** -- `prepare()` connection lifecycle -- **Closed** (Phase B)
3. **A3** -- `auth()` connection leak -- **Closed** (Phase B)
4. **T7** -- exec() multi-page drain -- **Closed** (Phase A)
5. **T4** -- Configurable inlineTimeout -- **Closed** (Phase A)
6. **A4** -- Sentinel errors factory -- **Closed** (Phase B)
7. **A5** -- gRPC savepoint DriverError -- **Closed** (Phase B)
8. **R1** -- Config immutability -- **Closed** (Phase B)
9. **T8** -- ESLint consolidated (tracked as GAP-0009) -- **Closed** (Phase B)

### Won't Do Items

1. **D5** -- CONTRIBUTING.md -- Won't Do (doc creation scope)
2. **D3** -- Transport selection docs -- Won't Do (doc creation scope)

### Remaining Open

1. **T1/T2** -- Coverage on critical modules (Open)
2. **T5** -- Pool maintenance exceeds maxConnections (Open)
3. **R2** -- Duplicated abort-signal wiring (Open)
4. **R3** -- Duplicated TLS cert loading (Open)
5. **A6** -- fromJSON type inference surprises (Open)
6. **R6** -- auth.ts duplicate validators (Open)
7. **D2** -- batchParallel JSDoc (Open)
8. **R4/R5** -- Dead code legacy aliases (Open)
9. **R7** -- Builder mutation via Object.assign (Open)
10. **R8** -- 5 files exceed 800-line threshold (Open)
11. **T6** -- Pool idle eviction (Open)
12. **D1** -- Missing JSDoc on public methods (Open)
13. **D4** -- CLAUDE.md state machine stale (Open)

---

## Stack-Ranked Findings

| Rank | ID | Severity | PriorityScore | Category | Finding | Component | Evidence | Issue URL | Fix Summary | Owner | ETA/SLA | Status |
|------|----|----------|---------------|----------|---------|-----------|----------|-----------|-------------|-------|---------|--------|
| 1 | A1 | Critical | 90 | architecture | `batchParallel` broken for concurrency > 1 on single connection | batch.ts, connection.ts | batch.ts:309-326 | -- | Accepts pool/factory; acquires separate connections per query | -- | -- | **Closed** (Phase B) |
| 2 | A2 | Critical | 85 | architecture | `prepare()` releases connection before `PreparedStatement` consumed | client.ts | client.ts:500-507 | -- | Deferred release until `PreparedStatement.close()` | -- | -- | **Closed** (Phase B) |
| 3 | A3 | Critical | 85 | architecture | `auth()` acquires connection but never releases it | client.ts | client.ts:590-594 | -- | Added `close()` on `AuthClient` that releases connection | -- | -- | **Closed** (Phase B) |
| 4 | T7 | Critical | 80 | architecture | Connection method does not drain multi-page results | connection.ts | connection.ts:438-448 | -- | Loop `_tryReceiveInline` until `final=true` | -- | -- | **Closed** (Phase A) |
| 5 | T1/T2 | High | 70 | tests | 0% and ~28% coverage on client.ts, pool.ts, transaction.ts, grpc-transport.ts | client.ts, pool.ts, transaction.ts, grpc-transport.ts | No test files exist for client.ts or transaction.ts; pool.test.ts is new/untracked; grpc-transport has no tests | -- | Write unit tests targeting 80%+ coverage per module; mock transport layer for client.ts and pool.ts tests | TBD | 2 weeks | **Open** |
| 6 | A4 | High | 50 | maintainability | Sentinel errors are shared mutable singleton `Error` instances | errors.ts | errors.ts:195-201 | -- | Replaced with factory functions | -- | -- | **Closed** (Phase B) |
| 7 | A5 | Medium | 45 | api-contract | gRPC transport silently ignores savepoint/rollbackTo | grpc-transport.ts | grpc-transport.ts:217-228 | -- | Throws `DriverError` with transport name | -- | -- | **Closed** (Phase B) |
| 8 | R1 | Medium | 40 | maintainability | Config mutation via `Object.assign` in `GeodeClient.connect()` | client.ts | client.ts:54 | -- | Replaced with spread: `{ ...config, ...options }` | -- | -- | **Closed** (Phase B) |
| 9 | T5 | Medium | 40 | architecture | Pool maintenance can exceed `maxConnections` | pool.ts | pool.ts:488-494 -- `addConnection()` called in a loop to fill `minConnections` without checking current total against `maxConnections` | -- | Guard `addConnection()` calls with `this._connections.length < this._maxConnections` check | TBD | < 1 hour | triage |
| 10 | R2 | Medium | 35 | maintainability | Duplicated abort-signal wiring pattern (6 occurrences across 4 files) | connection.ts, client.ts, batch.ts, transport.ts | Manual `AbortController` + `setTimeout` + `clearTimeout` pattern repeated identically | -- | Extract `withTimeout(ms, signal?)` utility returning `{ signal, cleanup }` | TBD | 1 day | triage |
| 11 | R3 | Medium | 35 | maintainability | Duplicated TLS cert-loading logic | transport.ts, grpc-transport.ts | Both files independently read cert/key/CA files with `fs.readFileSync` and similar validation | -- | Extract shared `loadTLSCredentials(config)` into a `tls-utils.ts` module | TBD | 1 day | triage |
| 12 | A6 | Medium | 35 | api-contract | `fromJSON` type inference produces surprising results | types.ts | types.ts:669-681 -- strings matching UUID regex become `GQLValue.uuid()`; ISO-date-like strings become `GQLValue.timestamp()`, silently changing the GQL type sent to the server | -- | Remove implicit type coercion; require explicit `GQLValue.uuid()` / `GQLValue.timestamp()` from callers; or add an opt-in `strict` flag | TBD | 1 day | triage |
| 13 | R6 | Medium | 30 | maintainability | auth.ts private validators duplicate validate.ts | auth.ts, validate.ts | auth.ts contains inline regex checks for usernames/roles that overlap with `validate.ts` exports | -- | Import and reuse validators from `validate.ts` | TBD | < 1 hour | triage |
| 14 | D3 | Medium | 30 | docs | No transport selection (QUIC vs gRPC) documentation | -- | No docs explain when to use which transport | -- | -- | -- | -- | **Won't Do** (doc creation scope) |
| 15 | T8 | Low | 25 | ci-cd | ESLint ignores all test files + dual config present | eslint.config.js, .eslintrc | Consolidated to single flat config | -- | Single flat config; tests linted with relaxed rules | -- | -- | **Closed** (Phase B, as GAP-0009) |
| 16 | T4 | Low | 20 | perf | Hardcoded 5 s inline timeout in `_tryReceiveInline` | connection.ts | connection.ts:503 | -- | Made configurable via `inlineTimeout` config field | -- | -- | **Closed** (Phase A) |
| 17 | D2 | Low | 20 | docs | `batchParallel` JSDoc is misleading | batch.ts | batch.ts:300-308 -- JSDoc says "parallel" but uses a single connection, which serializes | -- | Update JSDoc to document single-connection limitation and recommend pool-based usage | TBD | < 1 hour | triage |
| 18 | R4/R5 | Low | 15 | cleanup | Dead code -- legacy aliases and legacy JSON methods | types.ts, query-builder.ts | Legacy re-exports and deprecated JSON serialization methods that are no longer referenced | -- | Remove dead exports; if public API, deprecate formally for one release cycle first | TBD | 1 day | triage |
| 19 | R7 | Low | 10 | maintainability | Builder mutation via `Object.assign` in query-builder | query-builder.ts | Builder methods mutate internal state objects with `Object.assign` instead of producing new copies | -- | Use spread operator to produce immutable builder steps | TBD | 1 day | triage |
| 20 | R8 | Low | 10 | maintainability | 5 source files exceed 800-line threshold | query-builder.ts (943), validate.ts (915), types.ts (913), connection.ts (842), auth.ts (834) | `wc -l` output | -- | Extract logical sub-modules (e.g. `query-builder-patterns.ts`, `type-conversions.ts`) | TBD | 2-3 days | triage |
| 21 | T6 | Low | 10 | perf | Pool idle eviction over-retains connections | pool.ts | Idle eviction only removes closed connections, never proactively shrinks below `minConnections` even when load is zero | -- | Add configurable idle-timeout eviction that shrinks toward `minConnections` | TBD | 1 day | triage |
| 22 | D1 | Low | 10 | docs | Missing JSDoc on internal public methods | connection.ts, pool.ts, transport.ts | Multiple exported methods lack `@param` / `@returns` / `@throws` documentation | -- | Add JSDoc to all public/exported symbols | TBD | 2 days | triage |
| 23 | D4 | Low | 10 | docs | CLAUDE.md connection state machine is stale | CLAUDE.md | State diagram omits the `error` state defined in errors.ts:186-192 | -- | Update state machine diagram in CLAUDE.md | TBD | < 1 hour | triage |
| 24 | D5 | Low | 10 | docs | No contributor onboarding guide | -- | No CONTRIBUTING.md or developer setup guide exists | -- | -- | -- | -- | **Won't Do** (doc creation scope) |

---

## Findings by Category

### Architecture (5 findings)

| ID | Severity | PriorityScore | Finding | Status |
|----|----------|---------------|---------|--------|
| A1 | Critical | 90 | `batchParallel` broken for concurrency > 1 | **Closed** |
| A2 | Critical | 85 | `prepare()` connection lifecycle bug | **Closed** |
| A3 | Critical | 85 | `auth()` connection leak | **Closed** |
| T7 | Critical | 80 | Result drain missing in connection | **Closed** |
| T5 | Medium   | 40 | Pool maintenance exceeds maxConnections | Open |

### Tests (1 finding)

| ID | Severity | PriorityScore | Finding |
|----|----------|---------------|---------|
| T1/T2 | High | 70 | 0-28% coverage on critical modules |

### Maintainability (6 findings)

| ID | Severity | PriorityScore | Finding | Status |
|----|----------|---------------|---------|--------|
| A4 | High   | 50 | Sentinel errors are shared mutable singletons | **Closed** |
| R1 | Medium | 40 | Config mutation via Object.assign | **Closed** |
| R2 | Medium | 35 | Duplicated abort-signal wiring | Open |
| R3 | Medium | 35 | Duplicated TLS cert loading | Open |
| R6 | Medium | 30 | Duplicated validators in auth.ts | Open |
| R7 | Low    | 10 | Builder mutation via Object.assign | Open |

### API Contract (2 findings)

| ID | Severity | PriorityScore | Finding | Status |
|----|----------|---------------|---------|--------|
| A5 | Medium | 45 | gRPC transport missing savepoint support | **Closed** |
| A6 | Medium | 35 | `fromJSON` implicit type coercion surprises | Open |

### Performance (2 findings)

| ID | Severity | PriorityScore | Finding | Status |
|----|----------|---------------|---------|--------|
| T4 | Low | 20 | Hardcoded 5s inline timeout | **Closed** |
| T6 | Low | 10 | Pool idle eviction over-retains | Open |

### CI/CD (1 finding)

| ID | Severity | PriorityScore | Finding | Status |
|----|----------|---------------|---------|--------|
| T8 | Low | 25 | ESLint ignores tests + dual config | **Closed** |

### Documentation (5 findings)

| ID | Severity | PriorityScore | Finding | Status |
|----|----------|---------------|---------|--------|
| D3 | Medium | 30 | No transport selection docs | **Won't Do** |
| D2 | Low    | 20 | Misleading batchParallel JSDoc | Open |
| D1 | Low    | 10 | Missing JSDoc on public methods | Open |
| D4 | Low    | 10 | Stale CLAUDE.md state machine | Open |
| D5 | Low    | 10 | No contributor onboarding guide | **Won't Do** |

### Cleanup (1 finding)

| ID | Severity | PriorityScore | Finding |
|----|----------|---------------|---------|
| R4/R5 | Low | 15 | Dead code -- legacy aliases and JSON methods |

---

## Detailed Evidence

### A1: `batchParallel` broken for concurrency > 1 (Critical, PriorityScore 90) -- **CLOSED**

**Status:** Closed / Implemented (Phase B, commits 41e0b96-e702098)

**Resolution:** `batchParallel` now accepts a pool or connection-factory instead of a single Connection. Acquires separate connections per in-flight query slot.

**Evidence:** `src/batch.ts` batchParallel implementation, `tests/unit/pool.test.ts`.

**Effort:** M

---

### A2: `prepare()` releases connection before `PreparedStatement` used (Critical, PriorityScore 85) -- **CLOSED**

**Status:** Closed / Implemented (Phase B, commits 41e0b96-e702098)

**Resolution:** Deferred connection release until `PreparedStatement.close()`. Connection is held for the lifetime of the statement.

**Evidence:** `src/client.ts` prepare() method, `src/prepared.ts` close() method.

**Effort:** S

---

### A3: `auth()` acquires connection but never releases it (Critical, PriorityScore 85) -- **CLOSED**

**Status:** Closed / Implemented (Phase B, commits 41e0b96-e702098)

**Resolution:** Added `AuthClient.close()` that releases the connection back to the pool.

**Evidence:** `src/auth.ts` close() method, `src/client.ts` auth() method.

**Effort:** S

---

### T7: Connection does not drain multi-page results (Critical, PriorityScore 80) -- **CLOSED**

**Status:** Closed / Implemented (Phase A, commits 68b7aea-22726e2)

**Resolution:** Added loop in exec() to drain `_tryReceiveInline` until `final=true` before returning connection to idle.

**Evidence:** `src/connection.ts` exec() method, `tests/unit/connection.test.ts`.

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

### A4: Sentinel errors are shared mutable singletons (High, PriorityScore 50) -- **CLOSED**

**Status:** Closed / Implemented (Phase B, commits 41e0b96-e702098)

**Resolution:** Replaced singleton Error instances with factory functions. Each thrown error now has a stack trace pointing to the throw site. Sentinel message strings retained as constants for identity checks.

**Evidence:** `src/errors.ts` factory functions.

**Effort:** S

---

### A5: gRPC transport silently ignores savepoint/rollbackTo (Medium, PriorityScore 45) -- **CLOSED**

**Status:** Closed / Implemented (Phase B, commits 41e0b96-e702098)

**Resolution:** gRPC transport savepoint() and rollbackTo() now throw `DriverError` with clear message identifying the transport and limitation.

**Evidence:** `src/grpc-transport.ts` savepoint/rollbackTo methods.

**Effort:** S

---

### R1: Config mutation via Object.assign (Medium, PriorityScore 40) -- **CLOSED**

**Status:** Closed / Implemented (Phase B, commits 41e0b96-e702098)

**Resolution:** Replaced `Object.assign(config, options)` with `{ ...config, ...options }`.

**Evidence:** `src/client.ts` connect() method.

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

### D3: No transport selection documentation (Medium, PriorityScore 30) -- **WON'T DO**

**Status:** Won't Do

**Reason:** Doc creation scope. Transport selection guidance is out of scope for gap closure work. QUIC vs gRPC differences are partially documented in code-level JSDoc on the transport modules.

**Effort:** S

---

### T8: ESLint ignores all tests + dual config (Low, PriorityScore 25) -- **CLOSED**

**Status:** Closed / Implemented (Phase B, commits 41e0b96-e702098; also tracked as GAP-0009)

**Resolution:** Consolidated to single flat `eslint.config.js` with test file overrides. Removed legacy `.eslintrc.json`.

**Evidence:** `eslint.config.js`.

**Effort:** S

---

### T4: Hardcoded 5s inline timeout (Low, PriorityScore 20) -- **CLOSED**

**Status:** Closed / Implemented (Phase A, commits 68b7aea-22726e2)

**Resolution:** Made inline timeout configurable via `inlineTimeout` config field sourced from `this._config.requestTimeout`.

**Evidence:** `src/connection.ts` _tryReceiveInline method.

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

### D5: No contributor onboarding guide (Low, PriorityScore 10) -- **WON'T DO**

**Status:** Won't Do

**Reason:** Doc creation scope. CONTRIBUTING.md creation is a documentation task outside the scope of gap closure work. CLAUDE.md serves as the primary developer guide.

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
