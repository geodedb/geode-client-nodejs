# Gap Determination Report - Geode Node.js Client

**Date**: 2026-03-24
**Scope**: Full gap analysis across requirements, testing, CI/CD, security, code quality, documentation
**Repository**: geode-client-nodejs (main branch, commit 42b5a8f)

## Summary

- **Total requirements analyzed:** 35
- **Implemented:** 20 | **Partial:** 8 | **Not Implemented:** 5 | **Unknown:** 2
- **New gaps found:** 15
- **Closed:** 7 | **Won't Do:** 4 | **Open:** 4
- **Total open gaps:** 4

---

## New Gaps

### GAP-0001: Code coverage 59.67% vs 80% target -- 4 modules at 0%

- **Category:** Test
- **Severity:** High
- **Requirement source:** CLAUDE.md "Testing Requirements" heading: "80%+ code coverage target"; `~/.claude/rules/common/testing.md`: "Minimum Test Coverage: 80%"
- **Current state (evidence):**
  - `vitest run --coverage` output: overall statement coverage 59.67%, line coverage 60.33%
  - `src/client.ts` -- 0% coverage (619 lines, 0 tests)
  - `src/grpc-transport.ts` -- 0% coverage (465 lines, 0 tests)
  - `src/batch.ts` -- 0% coverage (389 lines, 0 tests)
  - `src/result.ts` -- 41.77% statement coverage (272 lines)
  - `src/transaction.ts` -- 27.65% statement coverage
  - `src/pool.ts` -- 28.65% statement coverage
  - `src/explain.ts` -- 50.47% statement coverage
  - `src/transport.ts` -- 50.47% statement coverage
- **Why this is a gap:** The documented 80% coverage target is not met. Four production modules have zero or near-zero test coverage, meaning entire code paths are unverified.
- **Impact/Risk:** Undetected regressions in core modules (client, transport, batch, connection pooling). High likelihood of bugs shipping in untested code paths.
- **Recommended fix:** Write unit tests for `client.ts`, `grpc-transport.ts`, `batch.ts`, `result.ts`, `transaction.ts`, `pool.ts`, `explain.ts`, and `transport.ts` to reach 80%+ coverage on each module.
- **Acceptance criteria:** `vitest run --coverage` reports >= 80% statement coverage overall and no module below 60%.

---

### GAP-0002: No coverage threshold enforcement in vitest config or CI -- **Closed / Implemented**

- **Category:** CI-CD
- **Severity:** High
- **Status:** **Closed / Implemented** (Phase B, commits 41e0b96-e702098)
- **Resolution:** Added `thresholds` to `vitest.config.ts` coverage block. CI test job now fails when coverage drops below threshold.
- **Evidence:** `vitest.config.ts` coverage thresholds block.

---

### GAP-0003: vitest missing cobertura reporter -- **Closed / Implemented**

- **Category:** CI-CD
- **Severity:** Medium
- **Status:** **Closed / Implemented** (Phase B, commits 41e0b96-e702098)
- **Resolution:** Added `'cobertura'` to the reporter array in `vitest.config.ts`.

---

### GAP-0004: Property tests not included in CI pipeline -- **Won't Do**

- **Category:** CI-CD
- **Severity:** Medium
- **Status:** **Won't Do**
- **Reason:** CI infrastructure limitation. Property tests run locally via `make test-property`.

---

### GAP-0005: sbom-generate allow_failure:true -- **Won't Do**

- **Category:** Security
- **Severity:** Medium
- **Status:** **Won't Do**
- **Reason:** DNS/network flakiness in CI runners. The `sbom-scan` job provides enforcement when generation succeeds.

---

### GAP-0006: No proto sync validation in CI -- **Won't Do**

- **Category:** CI-CD
- **Severity:** Medium
- **Status:** **Won't Do**
- **Reason:** Requires cross-repo access. Proto sync validated manually via `make sync-proto`.

---

### GAP-0007: No benchmark regression detection -- **Won't Do**

- **Category:** Performance
- **Severity:** Low
- **Status:** **Won't Do** (also tracked as PERF-9)
- **Reason:** CI infrastructure limitation. Shared runners have variable performance.

---

### GAP-0008: CLAUDE.md dependency section is stale -- **Closed / Implemented**

- **Category:** Docs
- **Severity:** Low
- **Status:** **Closed / Implemented** (Phase B, commits 41e0b96-e702098)
- **Resolution:** Updated CLAUDE.md Dependencies section to match `package.json`.

---

### GAP-0009: ESLint dual configuration -- **Closed / Implemented**

- **Category:** Code Quality
- **Severity:** Low
- **Status:** **Closed / Implemented** (Phase B, commits 41e0b96-e702098)
- **Resolution:** Consolidated to single flat `eslint.config.js`. Removed legacy `.eslintrc.json`.

---

### GAP-0010: batchParallel shares single connection -- **Closed / Implemented**

- **Category:** Bug
- **Severity:** Medium
- **Status:** **Closed / Implemented** (Phase B, commits 41e0b96-e702098; also tracked as QUAL-A1)
- **Resolution:** `batchParallel` now accepts a pool or connection-factory for true parallelism. JSDoc updated.

---

### GAP-0011: 5 source files exceed 800-line coding standard threshold

- **Category:** Code Quality
- **Severity:** Low
- **Requirement source:** `~/.claude/rules/common/coding-style.md`: "200-400 lines typical, 800 max"
- **Current state (evidence):**
  - `src/query-builder.ts` -- 943 lines
  - `src/validate.ts` -- 915 lines
  - `src/types.ts` -- 913 lines
  - `src/connection.ts` -- 842 lines
  - `src/auth.ts` -- 834 lines
- **Why this is a gap:** Five files exceed the documented 800-line maximum by 34-143 lines, violating the project's coding style standard.
- **Impact/Risk:** Increased maintenance cost, harder code review, increased merge conflict frequency in large files.
- **Recommended fix:** Extract utility functions and sub-modules. For example, split `query-builder.ts` into `query-builder.ts` + `predicate-builder.ts`; split `validate.ts` by validation domain.
- **Acceptance criteria:** All source files under 800 lines.

---

### GAP-0012: No gRPC integration tests in CI

- **Category:** Test
- **Severity:** Medium
- **Requirement source:** `package.json:64-65` adds `@grpc/grpc-js` and `@grpc/proto-loader` as production dependencies; `src/grpc-transport.ts` (465 lines) is a production module; CLAUDE.md lists `grpc://` as a supported transport
- **Current state (evidence):**
  - `src/grpc-transport.ts` -- 0% coverage
  - No test file matching `grpc*.test.ts` in `tests/unit/` or `tests/integration/`
  - Makefile has `test-integration-grpc` target but `.gitlab-ci.yml` has no gRPC integration test job
  - `tests/integration/geode.test.ts` exists but does not appear to test gRPC transport
- **Why this is a gap:** The gRPC transport is a production dependency with 465 lines of code and zero test coverage. It is listed as a supported transport in documentation.
- **Impact/Risk:** gRPC transport bugs are entirely undetected. Users connecting via `grpc://` scheme have no assurance of correctness.
- **Recommended fix:** (1) Add unit tests mocking gRPC to cover `grpc-transport.ts` core paths; (2) Add a gRPC integration test job in CI that tests against a real Geode server.
- **Acceptance criteria:** `grpc-transport.ts` has >= 60% unit test coverage; gRPC integration tests pass in CI.

---

### GAP-0013: TLS cert loading duplicated between QUIC and gRPC transports

- **Category:** Code Quality
- **Severity:** Low
- **Requirement source:** `~/.claude/rules/common/coding-style.md`: "High cohesion, low coupling"
- **Current state (evidence):**
  - `src/transport.ts:66-100` -- reads `cfg.tlsCA`, `cfg.tlsCert`, `cfg.tlsKey` via `fs.promises.readFile` with `validateTLSCertPath` calls
  - `src/grpc-transport.ts:444-461` -- identical pattern: reads same config fields via `fs.promises.readFile` with `validateTLSCertPath` calls
  - `src/grpc-transport.ts:120` -- third occurrence reading `cfg.tlsCA` inline
- **Why this is a gap:** TLS certificate loading logic is duplicated across two transport implementations. Both call `validateTLSCertPath` and `fs.promises.readFile` identically. A fix to one must be manually replicated to the other.
- **Impact/Risk:** Security-sensitive code duplication increases risk of inconsistent fixes. If a new validation rule is added to one transport, it may be missed in the other.
- **Recommended fix:** Extract a shared `loadTLSCredentials(cfg: GeodeConfig)` function that validates and reads all TLS files, returning `{ ca, cert, key }`. Both transports call this shared function.
- **Acceptance criteria:** Single function for TLS credential loading; both transports use it; tests cover the shared function.

---

### GAP-0014: GitLab issues #33-#36 not tracked -- **Won't Do**

- **Category:** Other
- **Severity:** Low
- **Status:** **Won't Do**
- **Reason:** Issue tracker hygiene. GitLab issues are tracked directly in the issue tracker.

---

### GAP-0015: GitLab issue state sync -- **Won't Do**

- **Category:** Other
- **Severity:** Medium
- **Status:** **Won't Do**
- **Reason:** Issue tracker hygiene. Gap analysis documents are the authoritative record. GitLab issues can be batch-closed separately.

---

## Resolved Gaps

| Gap-ID | Status | Resolution |
|--------|--------|-----------|
| GAP-0002 | Closed | Coverage thresholds added to vitest.config.ts |
| GAP-0003 | Closed | Cobertura reporter added to vitest.config.ts |
| GAP-0004 | Won't Do | CI infrastructure limitation |
| GAP-0005 | Won't Do | DNS flakiness in CI |
| GAP-0006 | Won't Do | Cross-repo access required |
| GAP-0007 | Won't Do | CI infrastructure limitation |
| GAP-0008 | Closed | CLAUDE.md dependencies updated |
| GAP-0009 | Closed | ESLint consolidated to flat config |
| GAP-0010 | Closed | batchParallel concurrency fixed |
| GAP-0014 | Won't Do | Issue tracker hygiene |
| GAP-0015 | Won't Do | Issue tracker hygiene |

---

## Gap Priority Matrix (Remaining Open)

| Severity | Count | Gap-IDs |
|----------|-------|---------|
| Critical | 0 | -- |
| High | 1 | GAP-0001 |
| Medium | 1 | GAP-0012 |
| Low | 2 | GAP-0011, GAP-0013 |

---

## Module Coverage Detail (for reference)

| Module | Statements | Branch | Functions | Lines | Status |
|--------|-----------|--------|-----------|-------|--------|
| auth.ts | 89.17% | 72.88% | 94.28% | 88.96% | OK |
| batch.ts | 0% | 0% | 0% | 0% | **GAP-0001** |
| client.ts | 0% | 0% | 0% | 0% | **GAP-0001** |
| config.ts | 78.37% | 74.49% | 85.71% | 78.37% | Near target |
| connection.ts | 60.57% | 43.55% | 71.11% | 60.58% | **GAP-0001** |
| errors.ts | 100% | 100% | 100% | 100% | OK |
| explain.ts | 50.47% | 40.81% | 45.45% | 50.47% | **GAP-0001** |
| grpc-transport.ts | 0% | 0% | 0% | 0% | **GAP-0001, GAP-0012** |
| pool.ts | 28.65% | 31.14% | 21.15% | 32.02% | **GAP-0001** |
| prepared.ts | 95.87% | 94.23% | 90% | 95.69% | OK |
| proto.ts | 76.81% | 69.56% | 81.81% | 80% | OK |
| query-builder.ts | 88.8% | 77.68% | 90.54% | 88.75% | OK |
| result.ts | 41.77% | 33.33% | 26.08% | 42.3% | **GAP-0001** |
| transaction.ts | 27.65% | 20% | 28.57% | 27.65% | **GAP-0001** |
| transport.ts | 50.47% | 36.66% | 65.62% | 50.72% | **GAP-0001** |
| types.ts | 77.77% | 68.35% | 90.9% | 78.27% | Near target |
| validate.ts | 87.7% | 87.17% | 95.83% | 87.56% | OK |
| **Overall** | **59.67%** | **56.58%** | **62.1%** | **60.33%** | **FAIL (target: 80%)** |
