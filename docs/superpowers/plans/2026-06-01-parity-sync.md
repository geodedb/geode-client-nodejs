# Node.js Client Parity-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. TDD: failing test first, then minimal implementation.

**Goal:** Finalize the Node.js Geode client at feature/behavior parity with the Go and Zig references, ship on `main` with a version bump and green CI.

**Architecture:** The Node client is the most complete of the three targets. It already has QUIC+gRPC transports, full DSN parse/redact, pool with rate-limiter, transactions + client-side savepoints, graph-native `GQLNode/GQLEdge/GQLPath`, full error classes + predicates (`isRetryableError`, `isDriverError`), quoting (`escapeGQLIdentifier`, `propsToGQL`, `valueToGQL`), full `AuthClient`, query/predicate builders, prepared statements, explain/profile, batch, and an `AsyncIterable` result. The parity-sync branch already added heartbeat-aware response draining, connection self-heal on transport error, and a pool race fix. Remaining work is small: a **client-level retry wrapper** (parity with Go `RetryPolicy`), explicit handling of the **gRPC savepoint asymmetry**, and validation + ship.

**Tech Stack:** TypeScript / Node 24, `@matrixai/quic`/`@grpc/grpc-js`, Vitest, GitLab CI (`node-lint`, `node-format`, `node-typecheck`, `node-build`, `node-test` coverage thresholds 55/50/55/55).

**Reference sources to mirror (read these):**
- Go retry: `../geode-client-go/retry.go` (`RetryPolicy`, `Retry`, retryable predicate).
- Go errors: `../geode-client-go/errors.go`.

---

## Baseline (verified 2026-06-01)
- Branch `codex/client-parity-sync`. `npm ci` ok; `npm test` = 780 unit tests passed (18 files).
- Committed branch commits `e532d4f` (heartbeat-aware draining, gRPC stream lifecycle hardening, TLS SNI fix, auth-on integration), `e868d18` (connection self-heal `_closeOnTransportError`, QUIC unsolicited-response buffering, pool race `_pendingConnections`, `maxIdleTime` 30s→120s).
- `package.json` version `1.0.0-alpha.25` is stale relative to tag `v1.0.1` (releases are tag-driven; coverage thresholds enforced).

---

### Task 1: Client-level retry wrapper (parity with Go RetryPolicy)

**Files:**
- Create: `src/retry.ts` (`RetryPolicy` type, `defaultRetryPolicy()`, `withRetry(fn, policy?)`)
- Modify: `src/index.ts` (export `RetryPolicy`, `withRetry`, `defaultRetryPolicy`)
- Test: `tests/unit/retry.test.ts`

Mirror Go `retry.go`: `{ maxAttempts, initialBackoffMs, maxBackoffMs, multiplier }`; retry only when `isRetryableError(err)`; exponential backoff capped at `maxBackoffMs`.

- [ ] **Step 1:** Write failing tests in `tests/unit/retry.test.ts`: succeeds first attempt; retries a retryable `TransportError` then resolves; rejects after `maxAttempts`; does NOT retry a non-retryable `DriverError` (e.g. syntax `42000`); backoff is capped (use fake timers).
- [ ] **Step 2:** `npx vitest run tests/unit/retry.test.ts` → FAIL (module absent).
- [ ] **Step 3:** Implement `src/retry.ts` reusing existing `isRetryableError` from `src/errors.ts`.
- [ ] **Step 4:** Export from `src/index.ts`. `npm test` → all pass; ensure coverage thresholds still met (add tests if `retry.ts` drags coverage).
- [ ] **Step 5:** `npm run lint && npm run typecheck && npm run format:check`. Commit: `feat(retry): add withRetry/RetryPolicy for transient errors`

---

### Task 2: gRPC savepoint asymmetry — explicit, tested behavior

**Files:**
- Modify: `src/grpc-transport.ts` (confirm `savepoint`/`rollbackTo` throw a typed `DriverError` 58000 with a clear message), `src/transaction.ts` if needed
- Test: `tests/unit/grpc-transport.test.ts` (assert the throw + message), `tests/unit/transaction.test.ts`

- [ ] **Step 1:** Write a failing test asserting that over gRPC, `savepoint()` rejects with a `DriverError` whose `statusClass` is `58000` and message names QUIC as the supported transport.
- [ ] **Step 2:** `npx vitest run tests/unit/grpc-transport.test.ts -t savepoint` → confirm pass/fail; if behavior already correct, the test just locks it in (regression guard).
- [ ] **Step 3:** If message/format inconsistent, fix to a single typed error path.
- [ ] **Step 4:** `npm test` → pass. Commit: `test(grpc): lock in typed savepoint-unsupported error; docs note QUIC-only savepoints`

---

### Task 3: Version bump + changelog

**Files:**
- Modify: `package.json` (`"version": "1.0.2"`), `CHANGELOG.md`

- [ ] **Step 1:** Set `package.json` version to `1.0.2`; add CHANGELOG entry summarizing parity-sync (heartbeat draining, self-heal, pool race fix, retry wrapper).
- [ ] **Step 2:** `npm run build` → `dist` builds clean; `npm test` → pass.
- [ ] **Step 3:** Commit: `chore(release): v1.0.2`

---

### Task 4: Validate + merge

- [ ] **Step 1:** Full local gate: `npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:coverage` (coverage ≥ thresholds).
- [ ] **Step 2:** Integration gate vs local server (QUIC): `GEODE_TRANSPORT=quic GEODE_HOST=127.0.0.1 GEODE_PORT=3141 GEODE_USERNAME=geode GEODE_PASSWORD=... npm run test:integration` → fix regressions via TDD.
- [ ] **Step 3:** Merge `codex/client-parity-sync` → `main`, push. **(Orchestrator handles push + tag + CI.)**

---

## Self-Review Notes
- Spec coverage: retry wrapper (T1 — the one clear missing Go feature), gRPC savepoint behavior locked (T2), version (T3), validate/merge (T4).
- Node already has Node/Edge/Path, quoting, error predicates, FormatDSN-equivalent (redactDSN/cloneConfig), AuthClient — no new work needed there.
- CDC RPCs and `tenantId` plumbing remain out of scope (server-side / not in cross-client baseline).
