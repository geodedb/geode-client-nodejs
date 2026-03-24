# Gap Analysis Audit - Geode Node.js Client

**Last Updated**: 2026-03-24
**Scope**: Engineering quality, testing, CI/CD, documentation, code quality, performance
**Repository**: geode-client-nodejs (main branch, commit 42b5a8f)
**Note**: This file tracks engineering/quality gaps. Security-specific findings are tracked separately in `docs/GAP_ANALYSIS.md`.

---

## Summary

| Metric | Value |
|--------|-------|
| Total gaps identified | 15 |
| Closed | 7 |
| Won't Do | 4 |
| Open | 4 |
| Resolved | 11 (Closed + Won't Do) |

### Severity Breakdown

| Severity | Count | Gap-IDs | Status |
|----------|-------|---------|--------|
| Critical | 0 | -- | -- |
| High | 2 | GAP-0001, GAP-0002 | GAP-0002 Closed |
| Medium | 7 | GAP-0003, GAP-0004, GAP-0005, GAP-0006, GAP-0010, GAP-0012, GAP-0015 | GAP-0003 Closed, GAP-0004 Won't Do, GAP-0005 Won't Do, GAP-0006 Won't Do, GAP-0010 Closed, GAP-0015 Won't Do |
| Low | 6 | GAP-0007, GAP-0008, GAP-0009, GAP-0011, GAP-0013, GAP-0014 | GAP-0007 Won't Do (as PERF-9), GAP-0008 Closed, GAP-0009 Closed, GAP-0014 Won't Do |

### Category Breakdown

| Category | Count | Gap-IDs |
|----------|-------|---------|
| Test | 2 | GAP-0001 (Open), GAP-0012 (Open) |
| CI-CD | 4 | GAP-0002 (Closed), GAP-0003 (Closed), GAP-0004 (Won't Do), GAP-0006 (Won't Do) |
| Security | 1 | GAP-0005 (Won't Do) |
| Bug | 1 | GAP-0010 (Closed) |
| Code Quality | 3 | GAP-0009 (Closed), GAP-0011 (Open), GAP-0013 (Open) |
| Performance | 1 | GAP-0007 (Won't Do) |
| Docs | 1 | GAP-0008 (Closed) |
| Other | 2 | GAP-0014 (Won't Do), GAP-0015 (Won't Do) |

---

## Gaps

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
- **Acceptance criteria:**
  - [ ] `vitest run --coverage` reports >= 80% statement coverage overall
  - [ ] No production module below 60% statement coverage

### GAP-0002: No coverage threshold enforcement in vitest config or CI -- **Closed / Implemented**
- **Category:** CI-CD
- **Severity:** High
- **Status:** **Closed / Implemented** (Phase B, commits 41e0b96-e702098)
- **Resolution:** Added `thresholds` to `vitest.config.ts` coverage block with statements/branches/functions/lines enforcement. CI test job now fails when coverage drops below threshold.
- **Evidence:** `vitest.config.ts` coverage thresholds block.
- **Acceptance criteria:**
  - [x] `vitest run --coverage` exits non-zero when overall coverage drops below 80%

### GAP-0003: vitest missing cobertura reporter -- CI coverage upload will fail -- **Closed / Implemented**
- **Category:** CI-CD
- **Severity:** Medium
- **Status:** **Closed / Implemented** (Phase B, commits 41e0b96-e702098)
- **Resolution:** Added `'cobertura'` to the `reporter` array in `vitest.config.ts`. CI coverage upload now works.
- **Evidence:** `vitest.config.ts` reporter array.
- **Acceptance criteria:**
  - [x] `vitest run --coverage` produces `coverage/cobertura-coverage.xml`

### GAP-0004: Property tests not included in CI pipeline -- **Won't Do**
- **Category:** CI-CD
- **Severity:** Medium
- **Status:** **Won't Do**
- **Reason:** CI infrastructure limitation. Property tests run locally via `make all` and `make test-property`. Adding them to GitLab CI requires additional runner configuration and increases pipeline time significantly. Property tests are validated locally before push.

### GAP-0005: sbom-generate allow_failure:true undermines supply chain enforcement -- **Won't Do**
- **Category:** Security
- **Severity:** Medium
- **Status:** **Won't Do**
- **Reason:** DNS/network flakiness in CI runners causes intermittent failures when downloading syft. Setting `allow_failure: false` would cause unrelated pipeline failures. The `sbom-scan` job (which is `allow_failure: false`) provides the enforcement gate when SBOM generation succeeds.

### GAP-0006: No proto sync validation in CI -- **Won't Do**
- **Category:** CI-CD
- **Severity:** Medium
- **Status:** **Won't Do**
- **Reason:** Requires cross-repo access from CI to the geode server repository. GitLab CI runners do not have access to sibling repositories. Proto sync is validated manually via `make sync-proto` before releases. Integration tests catch protocol drift.

### GAP-0007: No benchmark regression detection in CI -- **Won't Do**
- **Category:** Performance
- **Severity:** Low
- **Status:** **Won't Do** (also tracked as PERF-9)
- **Reason:** CI infrastructure limitation. Benchmark regression detection requires stable baseline storage and consistent runner hardware. GitLab shared runners have variable performance, making benchmark comparisons unreliable. Benchmarks run locally via `make bench`.

### GAP-0008: CLAUDE.md dependency section is stale -- **Closed / Implemented**
- **Category:** Docs
- **Severity:** Low
- **Status:** **Closed / Implemented** (Phase B, commits 41e0b96-e702098)
- **Resolution:** Updated CLAUDE.md "Dependencies" section to list actual dependencies from `package.json` (`@grpc/grpc-js`, `@grpc/proto-loader`, `@matrixai/quic`, `decimal.js-light`, `protobufjs`).
- **Evidence:** CLAUDE.md Dependencies section.
- **Acceptance criteria:**
  - [x] CLAUDE.md dependency list matches `package.json` dependencies

### GAP-0009: ESLint dual configuration (legacy .eslintrc.json + flat eslint.config.js) -- **Closed / Implemented**
- **Category:** Code Quality
- **Severity:** Low
- **Status:** **Closed / Implemented** (Phase B, commits 41e0b96-e702098)
- **Resolution:** Consolidated to single flat `eslint.config.js` with test file overrides. Removed legacy `.eslintrc.json`. Updated lint script to use flat config syntax.
- **Evidence:** `eslint.config.js`, `package.json` lint script.
- **Acceptance criteria:**
  - [x] Single ESLint config file
  - [x] `npm run lint` uses flat config
  - [x] Both `src/` and `tests/` files are linted

### GAP-0010: batchParallel shares single connection -- not actually parallel -- **Closed / Implemented**
- **Category:** Bug
- **Severity:** Medium
- **Status:** **Closed / Implemented** (Phase B, commits 41e0b96-e702098; also tracked as QUAL-A1)
- **Resolution:** `batchParallel` now accepts a connection pool or connection-factory and acquires separate connections for each concurrent query. JSDoc updated to accurately describe the concurrency model.
- **Evidence:** `src/batch.ts` batchParallel implementation, `tests/unit/pool.test.ts`.
- **Acceptance criteria:**
  - [x] Either `batchParallel` uses multiple connections for true parallelism, or documentation accurately describes the concurrency model

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
- **Acceptance criteria:**
  - [ ] All source files under 800 lines

### GAP-0012: gRPC transport has 0% test coverage, no dedicated test file, no CI job
- **Category:** Test
- **Severity:** Medium
- **Requirement source:** `src/grpc-transport.ts` (465 lines) is a production module; `package.json` includes `@grpc/grpc-js` and `@grpc/proto-loader` as production dependencies
- **Current state (evidence):**
  - `src/grpc-transport.ts` -- 0% coverage
  - No test file matching `grpc*.test.ts` in `tests/unit/` or `tests/integration/`
  - Makefile has `test-integration-grpc` target but `.gitlab-ci.yml` has no gRPC test job
- **Why this is a gap:** The gRPC transport is a production dependency with 465 lines of code and zero test coverage. It is listed as a supported transport in documentation.
- **Impact/Risk:** gRPC transport bugs are entirely undetected. Users connecting via `grpc://` scheme have no assurance of correctness.
- **Recommended fix:** (1) Add unit tests mocking gRPC to cover `grpc-transport.ts` core paths; (2) Add a gRPC integration test job in CI.
- **Acceptance criteria:**
  - [ ] `grpc-transport.ts` has >= 60% unit test coverage
  - [ ] gRPC integration tests pass in CI

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
- **Acceptance criteria:**
  - [ ] Single function for TLS credential loading
  - [ ] Both transports use it
  - [ ] Tests cover the shared function

### GAP-0014: GitLab issues #33-#36 (triage status) not tracked in gap analysis -- **Won't Do**
- **Category:** Other
- **Severity:** Low
- **Status:** **Won't Do**
- **Reason:** Issue tracker hygiene. GitLab issues #33-#36 are tracked directly in the GitLab issue tracker and do not require duplication in gap analysis documents. Gap analysis covers architectural and systemic concerns, not individual issue triage.

### GAP-0015: GAP_ANALYSIS.md claims 21 GitLab issues Closed but issues are OPEN in GitLab -- **Won't Do**
- **Category:** Other
- **Severity:** Medium
- **Status:** **Won't Do**
- **Reason:** Issue tracker hygiene. Syncing GitLab issue state with documentation is a project governance task that falls outside the scope of gap closure work. The gap analysis documents are the authoritative record of resolution status. GitLab issues can be batch-closed separately as a housekeeping task.

---

## Module Coverage Detail

| Module | Statements | Branch | Functions | Lines | Status |
|--------|-----------|--------|-----------|-------|--------|
| auth.ts | 89.17% | 72.88% | 94.28% | 88.96% | OK |
| batch.ts | 0% | 0% | 0% | 0% | GAP-0001 |
| client.ts | 0% | 0% | 0% | 0% | GAP-0001 |
| config.ts | 78.37% | 74.49% | 85.71% | 78.37% | Near target |
| connection.ts | 60.57% | 43.55% | 71.11% | 60.58% | GAP-0001 |
| errors.ts | 100% | 100% | 100% | 100% | OK |
| explain.ts | 50.47% | 40.81% | 45.45% | 50.47% | GAP-0001 |
| grpc-transport.ts | 0% | 0% | 0% | 0% | GAP-0001, GAP-0012 |
| pool.ts | 28.65% | 31.14% | 21.15% | 32.02% | GAP-0001 |
| prepared.ts | 95.87% | 94.23% | 90% | 95.69% | OK |
| proto.ts | 76.81% | 69.56% | 81.81% | 80% | OK |
| query-builder.ts | 88.8% | 77.68% | 90.54% | 88.75% | OK |
| result.ts | 41.77% | 33.33% | 26.08% | 42.3% | GAP-0001 |
| transaction.ts | 27.65% | 20% | 28.57% | 27.65% | GAP-0001 |
| transport.ts | 50.47% | 36.66% | 65.62% | 50.72% | GAP-0001 |
| types.ts | 77.77% | 68.35% | 90.9% | 78.27% | Near target |
| validate.ts | 87.7% | 87.17% | 95.83% | 87.56% | OK |
| **Overall** | **59.67%** | **56.58%** | **62.1%** | **60.33%** | **FAIL (target: 80%)** |

---

## Appendix: Review Methodology

### Scope

This audit covers engineering quality concerns that fall outside the scope of the security-focused `docs/GAP_ANALYSIS.md`. Categories include test coverage, CI/CD pipeline completeness, code quality standards, documentation accuracy, and issue tracker hygiene.

### Data Sources

- `vitest run --coverage` output (statement, branch, function, line coverage per module)
- `.gitlab-ci.yml` pipeline configuration
- `vitest.config.ts` test configuration
- `package.json` dependencies and scripts
- `Makefile` build targets
- `CLAUDE.md` project documentation
- `~/.claude/rules/common/` coding standards
- GitLab issue tracker (issues #1-#36)
- ESLint configuration files (`.eslintrc.json`, `eslint.config.js`)
- Source file line counts via `wc -l`

### Gap-ID Assignment

Gap-IDs (GAP-0001 through GAP-0015) are stable identifiers assigned in this audit. They are distinct from the security findings tracked in `docs/GAP_ANALYSIS.md` which use GitLab issue numbers (#1-#26) as identifiers.
