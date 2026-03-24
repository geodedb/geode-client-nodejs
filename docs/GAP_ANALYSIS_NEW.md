# Gap Determination Report - Geode Node.js Client

**Date**: 2026-03-24
**Scope**: Full gap analysis across requirements, testing, CI/CD, security, code quality, documentation
**Repository**: geode-client-nodejs (main branch, commit 42b5a8f)

## Summary

- **Total requirements analyzed:** 35
- **Implemented:** 20 | **Partial:** 8 | **Not Implemented:** 5 | **Unknown:** 2
- **New gaps found:** 15
- **Previously open gaps resolved:** 0 (no prior GAP-ID system existed)
- **Total open gaps:** 15

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

### GAP-0002: No coverage threshold enforcement in vitest config or CI

- **Category:** CI-CD
- **Severity:** High
- **Requirement source:** CLAUDE.md "Testing Requirements": "80%+ code coverage target"; `.gitlab-ci.yml` line 67-68: expects `coverage/cobertura-coverage.xml`
- **Current state (evidence):**
  - `vitest.config.ts:8-13` -- coverage block has `reporter: ['text', 'json', 'html']` but no `thresholds` key
  - No `thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 }` or equivalent
  - `.gitlab-ci.yml` has no `coverage` regex or threshold gate in the test job
- **Why this is a gap:** Coverage can drop to any level without failing the build. The 80% target is aspirational only -- not enforced.
- **Impact/Risk:** Coverage silently regresses over time. Developers can merge code with 0% test coverage.
- **Recommended fix:** Add `thresholds` to `vitest.config.ts` coverage block: `{ statements: 80, branches: 70, functions: 80, lines: 80 }`. Ensure the CI test job fails when thresholds are not met.
- **Acceptance criteria:** `vitest run --coverage` exits non-zero when overall coverage drops below 80%.

---

### GAP-0003: vitest missing cobertura reporter -- CI coverage upload will fail

- **Category:** CI-CD
- **Severity:** Medium
- **Requirement source:** `.gitlab-ci.yml:68`: `coverage_path: 'coverage/cobertura-coverage.xml'`
- **Current state (evidence):**
  - `vitest.config.ts:10` -- `reporter: ['text', 'json', 'html']` -- no `'cobertura'` reporter
  - `.gitlab-ci.yml:68` -- expects `coverage/cobertura-coverage.xml`
- **Why this is a gap:** The CI pipeline references a cobertura XML file that vitest never generates. GitLab coverage visualization and merge request coverage diff will silently have no data.
- **Impact/Risk:** No coverage visibility in GitLab merge requests. Coverage trends not tracked.
- **Recommended fix:** Add `'cobertura'` to the `reporter` array in `vitest.config.ts`.
- **Acceptance criteria:** `vitest run --coverage` produces `coverage/cobertura-coverage.xml`.

---

### GAP-0004: Property tests not included in CI pipeline

- **Category:** CI-CD
- **Severity:** Medium
- **Requirement source:** CLAUDE.md "Testing Requirements": "Property-based tests for parsers"; Makefile `all` target includes `test-property`
- **Current state (evidence):**
  - `tests/property/` contains 3 property test files: `config.property.ts`, `types.property.ts`, `validate.property.ts`
  - `.gitlab-ci.yml` -- no mention of property tests; test job runs `test:coverage` which uses `vitest run --coverage` with `include: ['tests/unit/**/*.test.ts']` -- excludes `tests/property/`
  - `vitest.config.ts:7` -- `include: ['tests/unit/**/*.test.ts']` -- explicitly excludes property tests
- **Why this is a gap:** 80 property-based tests exist locally but never run in CI. The `make all` target runs them, but the CI pipeline does not.
- **Impact/Risk:** Property tests could be broken without anyone noticing. Parser edge cases caught by property tests are not CI-verified.
- **Recommended fix:** Either add a separate CI job for property tests or extend the vitest include pattern to cover `tests/property/**/*.property.ts`.
- **Acceptance criteria:** Property tests execute and pass in CI on every pipeline run.

---

### GAP-0005: sbom-generate allow_failure:true undermines supply chain enforcement

- **Category:** Security
- **Severity:** Medium
- **Requirement source:** GAP_ANALYSIS.md Phase 5 Finding 5 (claimed "Closed"): "CI pipeline lacks SBOM enforcement and provenance"
- **Current state (evidence):**
  - `.gitlab-ci.yml:113-114` -- `sbom-generate: allow_failure: true`
  - `.gitlab-ci.yml:89-90` -- `sbom-scan` has `allow_failure: false`
  - Comment on line 112: "SBOM jobs may fail due to DNS/network issues downloading syft"
- **Why this is a gap:** If sbom-generate fails (allow_failure: true), the sbom-scan job has nothing to scan and effectively becomes a no-op or auto-passes. The GAP_ANALYSIS.md claims this was "Closed" but only fixed the scan side, not the generation side.
- **Impact/Risk:** Supply chain artifacts (SBOM) may silently not be generated for releases. The sbom-scan enforcement is hollow without successful generation.
- **Recommended fix:** Set `sbom-generate: allow_failure: false`. If DNS/network flakiness is a concern, add retry logic instead.
- **Acceptance criteria:** `sbom-generate` fails the pipeline on error; SBOM is present for every release.

---

### GAP-0006: No proto sync validation in CI

- **Category:** CI-CD
- **Severity:** Medium
- **Requirement source:** Makefile line `CANONICAL_PROTO ?= ../geode/src/proto/geode.proto` and `sync-proto` target; protocol compliance is a core requirement per CLAUDE.md "Wire Protocol"
- **Current state (evidence):**
  - `.gitlab-ci.yml` -- no job, step, or reference to proto sync validation
  - Makefile has `sync-proto` target to copy from canonical source
  - No CI check that `proto/geode.proto` matches the canonical proto in the server repo
- **Why this is a gap:** Proto definitions can drift between the client and server without detection. A developer could modify `proto/geode.proto` locally without matching the server's canonical version.
- **Impact/Risk:** Wire protocol incompatibilities discovered only at runtime in integration testing or production.
- **Recommended fix:** Add a CI job that checksums or diffs `proto/geode.proto` against the canonical proto from the server repo.
- **Acceptance criteria:** CI fails if client proto diverges from canonical server proto.

---

### GAP-0007: No benchmark regression detection

- **Category:** Performance
- **Severity:** Low
- **Requirement source:** CLAUDE.md "Makefile Commands": `make bench -- Run benchmarks (159 benchmarks)`
- **Current state (evidence):**
  - No `bench` or `benchmark` job in `.gitlab-ci.yml`
  - No benchmark comparison script or tooling in the repo
  - `npm run bench` runs vitest bench but results are not stored or compared
- **Why this is a gap:** Benchmarks exist (159) but there is no automated detection of performance regressions. A change could cause a 10x slowdown and it would not be caught in CI.
- **Impact/Risk:** Performance regressions ship undetected. For a database client library, latency regressions directly affect all users.
- **Recommended fix:** Add a CI job that runs benchmarks and compares against stored baselines, failing on significant regressions (e.g., >20% degradation).
- **Acceptance criteria:** CI warns or fails on benchmark regressions exceeding a configurable threshold.

---

### GAP-0008: CLAUDE.md dependency section is stale

- **Category:** Docs
- **Severity:** Low
- **Requirement source:** CLAUDE.md "Dependencies" heading (lines 287-300)
- **Current state (evidence):**
  - CLAUDE.md:291 lists `@aspect-build/quiche` as a required dependency
  - `package.json:64-68` shows actual dependencies: `@grpc/grpc-js`, `@grpc/proto-loader`, `@matrixai/quic`, `decimal.js-light`, `protobufjs`
  - CLAUDE.md does not mention `@grpc/grpc-js`, `@grpc/proto-loader`, `@matrixai/quic`, or `protobufjs`
- **Why this is a gap:** Developers consulting CLAUDE.md for dependency information get incorrect guidance. `@aspect-build/quiche` is not installed; `@matrixai/quic` is the actual QUIC library.
- **Impact/Risk:** Confusion for contributors; incorrect troubleshooting guidance.
- **Recommended fix:** Update CLAUDE.md "Dependencies" section to list actual dependencies from `package.json`.
- **Acceptance criteria:** CLAUDE.md dependency list matches `package.json` dependencies.

---

### GAP-0009: ESLint dual configuration (legacy .eslintrc.json + flat eslint.config.js)

- **Category:** Code Quality
- **Severity:** Low
- **Requirement source:** Coding standards (single source of truth for linting rules)
- **Current state (evidence):**
  - `.eslintrc.json` -- legacy eslintrc format (64 lines, includes test overrides)
  - `eslint.config.js` -- new flat config format (51 lines, no test overrides)
  - `package.json:28` -- `"lint": "eslint src --ext .ts"` uses legacy flag `--ext` suggesting it targets `.eslintrc.json`
  - ESLint 9 (`eslint: ^9.39.2`) defaults to flat config; `.eslintrc.json` is legacy
  - The two configs have identical rules for `src/` but `.eslintrc.json` has test overrides that `eslint.config.js` lacks
- **Why this is a gap:** Two competing ESLint configs create confusion about which is authoritative. Divergent rules could apply depending on which config ESLint loads.
- **Impact/Risk:** Inconsistent lint behavior; developer confusion; one config may silently be ignored.
- **Recommended fix:** Remove `.eslintrc.json`, complete `eslint.config.js` with test file overrides, update the lint script to use flat config syntax (remove `--ext .ts`).
- **Acceptance criteria:** Single ESLint config file; `npm run lint` uses flat config; both `src/` and `tests/` files are linted.

---

### GAP-0010: batchParallel shares single connection -- not actually parallel for request-response protocols

- **Category:** Bug
- **Severity:** Medium
- **Requirement source:** `src/batch.ts:296-301` JSDoc: "Unlike the sequential batch(), this executes multiple queries concurrently up to the specified limit."
- **Current state (evidence):**
  - `src/batch.ts:309-312` -- signature: `batchParallel(conn: Connection, ...)` takes a single `Connection`
  - `src/batch.ts:326` -- each query calls `conn.query()` on the same connection
  - `src/connection.ts` connection state machine (per CLAUDE.md): `idle -> executing -> idle` -- a connection can only execute one query at a time
  - The semaphore pattern at lines 358-377 creates concurrent promises, but they will serialize on the single connection
- **Why this is a gap:** The function claims to execute queries concurrently but uses a single connection that serializes queries. The concurrency semaphore only creates promise-level concurrency; the underlying connection processes one query at a time.
- **Impact/Risk:** Users expect parallel execution for performance but get serial behavior. The overhead of the semaphore pattern adds complexity without benefit.
- **Recommended fix:** Either (a) accept a connection pool and acquire separate connections for each concurrent query, or (b) document clearly that "parallel" means promise-level interleaving only on multiplexed transports (QUIC streams), not true parallel execution on a single connection.
- **Acceptance criteria:** Either `batchParallel` uses multiple connections for true parallelism, or documentation accurately describes the concurrency model.

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

### GAP-0014: GitLab issues #33-#36 (triage) not tracked in GAP_ANALYSIS.md

- **Category:** Other
- **Severity:** Low
- **Requirement source:** GitLab issue tracker; project governance requires tracking all known issues
- **Current state (evidence):**
  - GAP_ANALYSIS.md covers issues #1-#26 only
  - Issues #33-#36 exist in GitLab (per phase 1-2 context) and are in triage status
  - These issues are not mentioned anywhere in the gap analysis document
- **Why this is a gap:** Known issues in the tracker are not reflected in the gap analysis, creating a blind spot in the project's risk assessment.
- **Impact/Risk:** Issues may be forgotten or deprioritized without visibility in the consolidated analysis.
- **Recommended fix:** Triage issues #33-#36, assign severity, and add them to the gap analysis document.
- **Acceptance criteria:** All open GitLab issues are referenced in GAP_ANALYSIS.md with status and severity.

---

### GAP-0015: GAP_ANALYSIS.md claims 21 GitLab issues "Closed" but issues may still be open in GitLab

- **Category:** Other
- **Severity:** Medium
- **Requirement source:** GAP_ANALYSIS.md (all phases); GitLab issue tracker
- **Current state (evidence):**
  - GAP_ANALYSIS.md marks issues #1-#22 and #23-#26 as "Closed"
  - Phase 1-2 context states: "21 issues documented as Closed in GAP_ANALYSIS.md but OPEN in GitLab"
  - The document records fixes and test additions for each issue, suggesting code fixes were applied
  - However, GitLab issue state was never updated to match the document
- **Why this is a gap:** The gap analysis document and the GitLab issue tracker are out of sync. This creates confusion about what is actually resolved vs. what needs attention.
- **Impact/Risk:** Auditors or new team members checking GitLab see open issues for resolved problems, wasting triage time and creating false alarm.
- **Recommended fix:** Close all GitLab issues that have verified fixes (with links to commits). Update any that are not actually resolved.
- **Acceptance criteria:** GitLab issue state matches GAP_ANALYSIS.md status for every referenced issue.

---

## Updated Gaps (evidence changed)

| Gap-ID | Change | Updated Evidence |
|--------|--------|-----------------|
| N/A | First gap determination -- no prior GAP-IDs existed | N/A |

## Resolved Gaps (ready to close)

| Gap-ID | Resolution Evidence |
|--------|-------------------|
| N/A | First gap determination -- no prior GAP-IDs to resolve | |

Note: The existing `docs/GAP_ANALYSIS.md` used a different format (Phase 1-5 security findings with GitLab issue numbers, no GAP-XXXX IDs). All 26 security findings in that document are marked "Closed" with code fixes and tests cited. This gap determination covers broader scope beyond security.

---

## Gap Priority Matrix

| Severity | Count | Gap-IDs |
|----------|-------|---------|
| Critical | 0 | -- |
| High | 2 | GAP-0001, GAP-0002 |
| Medium | 6 | GAP-0003, GAP-0004, GAP-0005, GAP-0006, GAP-0010, GAP-0012, GAP-0015 |
| Low | 6 | GAP-0007, GAP-0008, GAP-0009, GAP-0011, GAP-0013, GAP-0014 |

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
