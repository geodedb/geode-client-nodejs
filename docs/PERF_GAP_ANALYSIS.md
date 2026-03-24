# Performance Gap Analysis -- Geode Node.js Client

Last updated: 2026-03-24

---

## Summary

| PerfSeverity | Count | Closed | Won't Do | Open |
|--------------|-------|--------|----------|------|
| P0           | 3     | 3      | 0        | 0    |
| P1           | 5     | 5      | 0        | 0    |
| P2           | 5     | 3      | 1        | 1    |
| **Total**    | **13**| **11** | **1**    | **1**|

### Closed Items (Phase A/B/C)

| # | Finding | PerfScore | Status |
|---|---------|-----------|--------|
| 1 | Buffer.concat O(n^2) (PERF-1) | 90 | **Closed** (Phase B) |
| 2 | gRPC backpressure (PERF-2) | 85 | **Closed** (Phase B) |
| 3 | execBatch pipelining with withTransaction (PERF-3) | 75 | **Closed** (Phase C) |
| 4 | GQLValue lazy fields (PERF-4) | 65 | **Closed** (Phase B) |
| 5 | queryAll fast path (PERF-5) | 60 | **Closed** (Phase B) |
| 6 | batch() concurrency (PERF-6) | 55 | **Closed** (Phase B) |
| 7 | gRPC stream timeout (PERF-7) | 50 | **Closed** (Phase B) |
| 8 | Pool .unref() (PERF-8) | 45 | **Closed** (Phase A) |
| 11 | Async cert validation (PERF-11) | 20 | **Closed** (Phase C, already fixed) |
| 12 | Regex pre-compilation (PERF-12) | 15 | **Closed** (Phase C) |
| 13 | Pool stats single-pass (PERF-13) | 10 | **Closed** (Phase A) |

### Won't Do

| # | Finding | Reason |
|---|---------|--------|
| 9 | No benchmarks in CI (PERF-9) | CI infrastructure -- shared runners have variable performance |

### Remaining Open

| # | Finding | PerfScore | Priority |
|---|---------|-----------|----------|
| 10 | Sync proto loading at startup | 30 | Open - Low Priority (risky refactor) |

---

## Stack-Ranked Findings

| Rank | Sev | PerfScore | Finding | Component | Evidence | Measurement | Fix Summary | Owner | SLA | Status |
|------|-----|-----------|---------|-----------|----------|-------------|-------------|-------|-----|--------|
| 1 | P0 | 90 | Buffer.concat O(n^2) in processData | transport | `src/transport.ts` | Buffer list pattern implemented | Buffer list pattern; concat once at message boundary | -- | -- | **Closed** (Phase B) |
| 2 | P0 | 85 | gRPC unbounded response buffering | grpc-transport | `src/grpc-transport.ts` | Backpressure implemented | stream.pause()/resume() backpressure added | -- | -- | **Closed** (Phase B) |
| 3 | P0 | 75 | Sequential await in execBatch | client | `src/client.ts:191-194` | N serial round-trips for N queries | Pipelined via withTransaction for single-connection; pool-based for multi-connection | -- | -- | **Closed** (Phase C) |
| 4 | P1 | 65 | GQLValue allocates 14 fields per instance | types | `src/types.ts` | Lazy initialization implemented | Lazy/undefined initialization; only set used field | -- | -- | **Closed** (Phase B) |
| 5 | P1 | 60 | queryAll double-conversion via GQLValue | connection | `src/connection.ts` | Fast path implemented | Fast path bypassing GQLValue for toJS() consumers | -- | -- | **Closed** (Phase B) |
| 6 | P1 | 55 | batch() ignores concurrency option | batch | `src/batch.ts` | Concurrency option honored | Delegates to batchParallel() when concurrency > 1 | -- | -- | **Closed** (Phase B) |
| 7 | P1 | 50 | Missing gRPC stream timeout | grpc-transport | `src/grpc-transport.ts` | Timeout added | Configurable streamTimeout with deadline | -- | -- | **Closed** (Phase B) |
| 8 | P1 | 45 | Pool maintenance interval prevents clean exit | pool | `src/pool.ts` | .unref() added | .unref() on maintenance interval | -- | -- | **Closed** (Phase A) |
| 9 | P2 | 40 | No benchmarks in CI | ci | `.gitlab-ci.yml` | 159 benchmarks exist, zero run in CI | -- | -- | -- | **Won't Do** (CI infra) |
| 10 | P2 | 30 | Sync proto loading at startup | proto | `src/proto.ts:346-352` | protobuf.loadSync blocks event loop 10-50ms | Use async protobuf.load() | TBD | Next quarter | **Open - Low Priority** (risky refactor) |
| 11 | P2 | 20 | Sync filesystem in cert validation | validate | `src/validate.ts:888-892` | existsSync/lstatSync/realpathSync; less than 5ms, startup-only | Async cert validation already implemented | -- | -- | **Closed** (Phase C, already fixed) |
| 12 | P2 | 15 | Regex in fromJSON per string value | types | `src/types.ts:671,675` | UUID+ISO regex on every string in fromJSON path | Pre-compiled as module-level constants; inline regex removed | -- | -- | **Closed** (Phase C) |
| 13 | P2 | 10 | Pool stats double array scan | pool | `src/pool.ts` | Single-pass implemented | Single-pass reduce | -- | -- | **Closed** (Phase A) |

---

## Findings by Area

### App (Transport / Client / Types)

#### 1. Buffer.concat O(n^2) in processData -- **CLOSED**

- **PerfSeverity**: P0 | **PerfScore**: 90
- **Status**: **Closed / Implemented** (Phase B, commits 41e0b96-e702098)

**Resolution**: Replaced single-buffer concat with buffer list pattern. Chunks accumulated in `Buffer[]` array; `Buffer.concat()` called once at message boundary.

**Evidence**: `src/transport.ts` processData method, `tests/unit/transport.test.ts`.

---

#### 2. gRPC Unbounded Response Buffering -- **CLOSED**

- **PerfSeverity**: P0 | **PerfScore**: 85
- **Status**: **Closed / Implemented** (Phase B, commits 41e0b96-e702098)

**Resolution**: Added `stream.pause()`/`stream.resume()` backpressure with configurable high-water mark. Memory stays bounded during large result set streaming.

**Evidence**: `src/grpc-transport.ts` stream handler.

---

#### 3. Sequential await in execBatch -- **CLOSED**

- **PerfSeverity**: P0 | **PerfScore**: 75
- **Status**: **Closed / Implemented** (Phase C)

**Resolution**: `execBatch` now pipelines queries using `withTransaction` for single-connection scenarios, reducing N round-trips to a single transaction boundary. When pooling is enabled, delegates to `batchParallel()` for true concurrency.

**Evidence**: `src/client.ts` execBatch method, `src/batch.ts`

---

#### 4. GQLValue Allocates 14 Fields Per Instance -- **CLOSED**

- **PerfSeverity**: P1 | **PerfScore**: 65
- **Status**: **Closed / Implemented** (Phase B, commits 41e0b96-e702098)

**Resolution**: Changed all fields to `undefined` default. Only the relevant field is set in each factory method. Getters handle `undefined`.

**Evidence**: `src/types.ts` GQLValue class, `tests/unit/types.test.ts`.

---

#### 5. queryAll Double-Conversion via GQLValue -- **CLOSED**

- **PerfSeverity**: P1 | **PerfScore**: 60
- **Status**: **Closed / Implemented** (Phase B, commits 41e0b96-e702098)

**Resolution**: Added fast path in queryAll that converts wire values directly to JS types without GQLValue intermediate allocation.

**Evidence**: `src/connection.ts` queryAll method.

---

#### 6. batch() Ignores Concurrency Option -- **CLOSED**

- **PerfSeverity**: P1 | **PerfScore**: 55
- **Status**: **Closed / Implemented** (Phase B, commits 41e0b96-e702098)

**Resolution**: `batch()` now delegates to `batchParallel()` when `options.concurrency` is set and greater than 1.

**Evidence**: `src/batch.ts` batch() function.

---

#### 7. Missing gRPC Stream Timeout -- **CLOSED**

- **PerfSeverity**: P1 | **PerfScore**: 50
- **Status**: **Closed / Implemented** (Phase B, commits 41e0b96-e702098)

**Resolution**: Added configurable `streamTimeout` to gRPC transport config with deadline propagation. Fallback setTimeout cancels stream if caller does not provide signal.

**Evidence**: `src/grpc-transport.ts` execute stream handling.

---

#### 8. Pool Maintenance Interval Prevents Clean Process Exit -- **CLOSED**

- **PerfSeverity**: P1 | **PerfScore**: 45
- **Status**: **Closed / Implemented** (Phase A, commits 68b7aea-22726e2)

**Resolution**: Added `.unref()` to the maintenance interval handle.

**Evidence**: `src/pool.ts` constructor, `tests/unit/pool.test.ts`.

---

### CI

#### 9. No Benchmarks in CI -- **WON'T DO**

- **PerfSeverity**: P2 | **PerfScore**: 40
- **Status**: **Won't Do** (also tracked as GAP-0007)

**Reason**: CI infrastructure limitation. GitLab shared runners have variable performance, making benchmark comparisons unreliable. Benchmarks are run locally via `make bench`.

---

### Infra (Startup / Initialization)

#### 10. Sync Proto Loading at Startup -- **Open - Low Priority**

- **PerfSeverity**: P2 | **PerfScore**: 30
- **Status**: **Open - Low Priority** (risky refactor)

**Summary**: `protobuf.loadSync(PROTO_PATH)` at `src/proto.ts:346` is called synchronously at module load time. This blocks the event loop for 10-50ms. Particularly impactful in serverless / cold-start environments.

**Why deferred**: Removing sync init requires auditing all code paths that assume proto is initialized at import time. The async `ensureProtoInitialized()` already exists but is not the default path. Converting all callers introduces regression risk for a modest startup time improvement.

**Fix Guidance**: Replace `loadSync` with `protobuf.load()` (async). Ensure all entry points await the async version.

---

#### 11. Sync Filesystem in Cert Validation -- **CLOSED**

- **PerfSeverity**: P2 | **PerfScore**: 20
- **Status**: **Closed / Implemented** (Phase C, already fixed)

**Resolution**: Async cert validation was already implemented. The calling chain uses async fs operations.

**Evidence**: `src/validate.ts`, `src/transport.ts`

---

#### 12. Regex in fromJSON Per String Value -- **CLOSED**

- **PerfSeverity**: P2 | **PerfScore**: 15
- **Status**: **Closed / Implemented** (Phase C)

**Resolution**: Inline regexes removed from `fromJSON()`. Implicit type coercion (QUAL-A6) was also removed, eliminating the per-string regex cost entirely. Remaining regexes in the module are pre-compiled as module-level constants.

**Evidence**: `src/types.ts` fromJSON() method

---

#### 13. Pool Stats Double Array Scan -- **CLOSED**

- **PerfSeverity**: P2 | **PerfScore**: 10
- **Status**: **Closed / Implemented** (Phase A, commits 68b7aea-22726e2)

**Resolution**: Replaced dual `filter().length` calls with single-pass counter.

**Evidence**: `src/pool.ts` stats getter, `tests/unit/pool.test.ts`.

---

## Roadmap

### Remaining Open Items

| Finding | PerfScore | Effort | Priority |
|---------|-----------|--------|----------|
| Async proto loading (10) | 30 | ~1-2 days | Low (risky refactor, requires audit of all init paths) |

All other items have been closed or marked Won't Do. See summary table above.

---

## Unknowns and Blockers

1. **Buffer.concat measurement**: The 8 GiB estimate assumes 16 KiB chunks for a 16 MiB response. Actual QUIC chunk sizes may vary. Confirm with transport-level logging under realistic load.

2. **gRPC backpressure deadlock risk**: Adding pause/resume requires careful analysis of the gRPC Node.js internals to ensure the server-side flow control cooperates. Test with slow consumers.

3. **batchParallel single-connection behavior**: The finding notes batchParallel is "broken with single connection." This needs investigation -- if the Geode protocol does not support pipelining, concurrent queries on one connection will serialize at the wire level regardless.

4. **Proto load time**: The 10-50ms estimate for loadSync needs measurement on the actual proto file. Smaller protos may load in less than 5ms, making this a non-issue outside serverless.

5. **queryAll allocation overhead**: Profiler data would confirm whether the GQLValue intermediaries are the bottleneck or whether wire parsing dominates. Run `node --prof` on a 10K-row query to confirm.
