# Gap Analysis -- Resolved Items

**Last Updated**: 2026-03-24
**Repository**: geode-client-nodejs (main branch)

This file contains all closed and won't-do items from the gap analysis tracking files.

---

## Closed Items

### Phase A Closures (commits 68b7aea through 22726e2)

#### SEC-P6-1: Prototype pollution in proto.ts rowToRecord()/protoValueToJS()
- **Source file:** `docs/GAP_ANALYSIS.md` (Phase 6, Rank 1)
- **Severity:** Medium
- **Resolution:** Replaced `{}` with `Object.create(null)` and added `isSafeObjectKey()` checks in rowToRecord() and protoValueToJS().
- **Evidence:** `src/proto.ts` rowToRecord/protoValueToJS functions
- **Resolved date:** 2026-03-24

#### SEC-P6-2: Prototype pollution in GQLValue.toJS() via Object.fromEntries
- **Source file:** `docs/GAP_ANALYSIS.md` (Phase 6, Rank 2)
- **Severity:** Medium
- **Resolution:** Replaced `Object.fromEntries()` with loop using `Object.create(null)` and key validation.
- **Evidence:** `src/types.ts` GQLValue.toJS() method
- **Resolved date:** 2026-03-24

#### SEC-P6-4: gRPC transport missing production insecureSkipVerify guard
- **Source file:** `docs/GAP_ANALYSIS.md` (Phase 6, Rank 4)
- **Severity:** Low
- **Resolution:** Ported NODE_ENV/GEODE_ENV production check from QUIC transport to gRPC transport.
- **Evidence:** `src/grpc-transport.ts`
- **Resolved date:** 2026-03-24

#### SEC-P6-5: gRPC max message size 100 MB vs QUIC 16 MiB
- **Source file:** `docs/GAP_ANALYSIS.md` (Phase 6, Rank 5)
- **Severity:** Low
- **Resolution:** Aligned gRPC max message size with QUIC (16 MiB) or made configurable with safe default.
- **Evidence:** `src/grpc-transport.ts`
- **Resolved date:** 2026-03-24

#### SEC-P6-6: propsToGQL() lacks internal key validation
- **Source file:** `docs/GAP_ANALYSIS.md` (Phase 6, Rank 6)
- **Severity:** Low
- **Resolution:** Added key validation in propsToGQL() as defense-in-depth.
- **Evidence:** `src/query-builder.ts` propsToGQL() function
- **Resolved date:** 2026-03-24

#### SEC-P6-8 (N4) / QUAL-R1: Object.assign config mutation
- **Source file:** `docs/GAP_ANALYSIS.md` (Phase 6, Rank 8), `docs/QUALITY_GAP_ANALYSIS.md` (R1)
- **Severity:** Info / Medium
- **Resolution:** Replaced `Object.assign(config, options)` with spread `{ ...config, ...options }`.
- **Evidence:** `src/client.ts` connect() method
- **Resolved date:** 2026-03-24

#### QUAL-T7: Connection method does not drain multi-page results
- **Source file:** `docs/QUALITY_GAP_ANALYSIS.md` (T7)
- **Severity:** Critical
- **Resolution:** Added loop in method to drain `_tryReceiveInline` until `final=true` before returning connection to idle.
- **Evidence:** `src/connection.ts`, `tests/unit/connection.test.ts`
- **Resolved date:** 2026-03-24

#### QUAL-T4: Configurable inlineTimeout
- **Source file:** `docs/QUALITY_GAP_ANALYSIS.md` (T4)
- **Severity:** Low
- **Resolution:** Made inline timeout configurable via `inlineTimeout` config field.
- **Evidence:** `src/connection.ts` _tryReceiveInline method
- **Resolved date:** 2026-03-24

#### PERF-8: Pool .unref()
- **Source file:** `docs/PERF_GAP_ANALYSIS.md` (Finding 8)
- **Severity:** P1
- **Resolution:** Added `.unref()` to the maintenance interval handle.
- **Evidence:** `src/pool.ts` constructor, `tests/unit/pool.test.ts`
- **Resolved date:** 2026-03-24

#### PERF-13: Pool stats single-pass
- **Source file:** `docs/PERF_GAP_ANALYSIS.md` (Finding 13)
- **Severity:** P2
- **Resolution:** Replaced dual `filter().length` calls with single-pass counter.
- **Evidence:** `src/pool.ts` stats getter
- **Resolved date:** 2026-03-24

### Phase B Closures (commits 41e0b96 through e702098)

#### QUAL-A2: prepare() connection lifecycle
- **Source file:** `docs/QUALITY_GAP_ANALYSIS.md` (A2)
- **Severity:** Critical
- **Resolution:** Deferred connection release until `PreparedStatement.close()`.
- **Evidence:** `src/client.ts` prepare() method, `src/prepared.ts` close() method
- **Resolved date:** 2026-03-24

#### QUAL-A3: auth() connection leak
- **Source file:** `docs/QUALITY_GAP_ANALYSIS.md` (A3)
- **Severity:** Critical
- **Resolution:** Added `AuthClient.close()` that releases the connection back to the pool.
- **Evidence:** `src/auth.ts` close() method, `src/client.ts` auth() method
- **Resolved date:** 2026-03-24

#### QUAL-R1: Config immutability
- **Source file:** `docs/QUALITY_GAP_ANALYSIS.md` (R1)
- **Severity:** Medium
- **Resolution:** Replaced `Object.assign(config, options)` with `{ ...config, ...options }`.
- **Evidence:** `src/client.ts` connect() method
- **Resolved date:** 2026-03-24

#### QUAL-A4: Sentinel errors factory
- **Source file:** `docs/QUALITY_GAP_ANALYSIS.md` (A4)
- **Severity:** High
- **Resolution:** Replaced singleton Error instances with factory functions.
- **Evidence:** `src/errors.ts` factory functions
- **Resolved date:** 2026-03-24

#### QUAL-A1 / GAP-0010: batchParallel concurrency
- **Source file:** `docs/QUALITY_GAP_ANALYSIS.md` (A1), `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0010)
- **Severity:** Critical / Medium
- **Resolution:** `batchParallel` now accepts a pool or connection-factory.
- **Evidence:** `src/batch.ts` batchParallel implementation
- **Resolved date:** 2026-03-24

#### PERF-6: batch() concurrency option
- **Source file:** `docs/PERF_GAP_ANALYSIS.md` (Finding 6)
- **Severity:** P1
- **Resolution:** `batch()` delegates to `batchParallel()` when `options.concurrency` > 1.
- **Evidence:** `src/batch.ts` batch() function
- **Resolved date:** 2026-03-24

#### PERF-1: Buffer.concat O(n^2)
- **Source file:** `docs/PERF_GAP_ANALYSIS.md` (Finding 1)
- **Severity:** P0
- **Resolution:** Buffer list pattern; chunks accumulated in array, concat once at message boundary.
- **Evidence:** `src/transport.ts` processData method, `tests/unit/transport.test.ts`
- **Resolved date:** 2026-03-24

#### PERF-4: GQLValue lazy fields
- **Source file:** `docs/PERF_GAP_ANALYSIS.md` (Finding 4)
- **Severity:** P1
- **Resolution:** Changed all fields to `undefined` default. Only relevant field set per factory method.
- **Evidence:** `src/types.ts` GQLValue class, `tests/unit/types.test.ts`
- **Resolved date:** 2026-03-24

#### PERF-5: queryAll fast path
- **Source file:** `docs/PERF_GAP_ANALYSIS.md` (Finding 5)
- **Severity:** P1
- **Resolution:** Fast path bypassing GQLValue intermediate for toJS() consumers.
- **Evidence:** `src/connection.ts` queryAll method
- **Resolved date:** 2026-03-24

#### PERF-2: gRPC backpressure
- **Source file:** `docs/PERF_GAP_ANALYSIS.md` (Finding 2)
- **Severity:** P0
- **Resolution:** Added stream.pause()/resume() backpressure with configurable high-water mark.
- **Evidence:** `src/grpc-transport.ts` stream handler
- **Resolved date:** 2026-03-24

#### PERF-7: gRPC stream timeout
- **Source file:** `docs/PERF_GAP_ANALYSIS.md` (Finding 7)
- **Severity:** P1
- **Resolution:** Added configurable streamTimeout with deadline propagation.
- **Evidence:** `src/grpc-transport.ts`
- **Resolved date:** 2026-03-24

#### QUAL-A5: gRPC savepoint DriverError
- **Source file:** `docs/QUALITY_GAP_ANALYSIS.md` (A5)
- **Severity:** Medium
- **Resolution:** gRPC transport savepoint() and rollbackTo() now throw `DriverError` with clear message.
- **Evidence:** `src/grpc-transport.ts` savepoint/rollbackTo methods
- **Resolved date:** 2026-03-24

#### GAP-0009: ESLint consolidated
- **Source file:** `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0009), `docs/QUALITY_GAP_ANALYSIS.md` (T8)
- **Severity:** Low
- **Resolution:** Consolidated to single flat `eslint.config.js`. Removed legacy `.eslintrc.json`.
- **Evidence:** `eslint.config.js`, `package.json` lint script
- **Resolved date:** 2026-03-24

#### GAP-0003: vitest cobertura reporter
- **Source file:** `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0003)
- **Severity:** Medium
- **Resolution:** Added `'cobertura'` to vitest reporter array.
- **Evidence:** `vitest.config.ts` reporter array
- **Resolved date:** 2026-03-24

#### GAP-0008: CLAUDE.md deps updated
- **Source file:** `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0008)
- **Severity:** Low
- **Resolution:** Updated CLAUDE.md Dependencies section to match package.json.
- **Evidence:** CLAUDE.md Dependencies section
- **Resolved date:** 2026-03-24

#### GAP-0002: Coverage thresholds
- **Source file:** `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0002)
- **Severity:** High
- **Resolution:** Added coverage thresholds to vitest.config.ts.
- **Evidence:** `vitest.config.ts` coverage thresholds block
- **Resolved date:** 2026-03-24

---

## Won't Do Items

#### GAP-0004: Property tests in CI
- **Source file:** `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0004)
- **Severity:** Medium
- **Reason:** CI infrastructure limitation. Property tests run locally via `make test-property`.
- **Resolved date:** 2026-03-24

#### GAP-0005: sbom-generate allow_failure
- **Source file:** `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0005)
- **Severity:** Medium
- **Reason:** DNS/network flakiness in CI runners causes intermittent failures downloading syft.
- **Resolved date:** 2026-03-24

#### GAP-0006: Proto sync in CI
- **Source file:** `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0006)
- **Severity:** Medium
- **Reason:** Requires cross-repo access from CI to sibling repository. Proto sync validated manually.
- **Resolved date:** 2026-03-24

#### GAP-0007 / PERF-9: Benchmark regression in CI
- **Source file:** `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0007), `docs/PERF_GAP_ANALYSIS.md` (Finding 9)
- **Severity:** Low / P2
- **Reason:** CI infrastructure limitation. Shared runners have variable performance.
- **Resolved date:** 2026-03-24

#### GAP-0014: GitLab issues #33-36 tracking
- **Source file:** `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0014)
- **Severity:** Low
- **Reason:** Issue tracker hygiene. GitLab issues tracked directly in issue tracker.
- **Resolved date:** 2026-03-24

#### GAP-0015: GitLab issue state sync
- **Source file:** `docs/GAP_ANALYSIS_AUDIT.md` (GAP-0015)
- **Severity:** Medium
- **Reason:** Issue tracker hygiene. Gap analysis documents are the authoritative record.
- **Resolved date:** 2026-03-24

#### SEC-P6-3 (D1): Dependency vulnerabilities
- **Source file:** `docs/GAP_ANALYSIS.md` (Phase 6, Rank 3)
- **Severity:** Medium
- **Reason:** Transitive dependency management. Vulnerabilities in dev-only or deeply transitive deps.
- **Resolved date:** 2026-03-24

#### QUAL-D5: CONTRIBUTING.md
- **Source file:** `docs/QUALITY_GAP_ANALYSIS.md` (D5)
- **Severity:** Low
- **Reason:** Doc creation scope. CLAUDE.md serves as primary developer guide.
- **Resolved date:** 2026-03-24

#### QUAL-D3: Transport selection docs
- **Source file:** `docs/QUALITY_GAP_ANALYSIS.md` (D3)
- **Severity:** Medium
- **Reason:** Doc creation scope. Transport differences partially documented in code-level JSDoc.
- **Resolved date:** 2026-03-24

#### SEC-P6-9 (I1): Session ID getter
- **Source file:** `docs/GAP_ANALYSIS.md` (Phase 6, Rank 9)
- **Severity:** Info
- **Reason:** Design choice. Session ID needed for debugging and connection correlation.
- **Resolved date:** 2026-03-24
