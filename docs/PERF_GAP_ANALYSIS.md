# Performance Gap Analysis -- Geode Node.js Client

Last updated: 2026-03-24

---

## Summary

| PerfSeverity | Count | Closed | Won't Do | Open |
|--------------|-------|--------|----------|------|
| P0           | 3     | 2      | 0        | 1    |
| P1           | 5     | 5      | 0        | 0    |
| P2           | 5     | 1      | 1        | 3    |
| **Total**    | **13**| **8**  | **1**    | **4**|

### Closed Items (Phase A/B)

| # | Finding | PerfScore | Status |
|---|---------|-----------|--------|
| 1 | Buffer.concat O(n^2) (PERF-1) | 90 | **Closed** (Phase B) |
| 2 | gRPC backpressure (PERF-2) | 85 | **Closed** (Phase B) |
| 4 | GQLValue lazy fields (PERF-4) | 65 | **Closed** (Phase B) |
| 5 | queryAll fast path (PERF-5) | 60 | **Closed** (Phase B) |
| 6 | batch() concurrency (PERF-6) | 55 | **Closed** (Phase B) |
| 7 | gRPC stream timeout (PERF-7) | 50 | **Closed** (Phase B) |
| 8 | Pool .unref() (PERF-8) | 45 | **Closed** (Phase A) |
| 13 | Pool stats single-pass (PERF-13) | 10 | **Closed** (Phase A) |

### Won't Do

| # | Finding | Reason |
|---|---------|--------|
| 9 | No benchmarks in CI (PERF-9) | CI infrastructure -- shared runners have variable performance |

### Remaining Open

| # | Finding | PerfScore |
|---|---------|-----------|
| 3 | Sequential await in execBatch | 75 |
| 10 | Sync proto loading at startup | 30 |
| 11 | Sync filesystem in cert validation | 20 |
| 12 | Regex in fromJSON per string value | 15 |

---

## Stack-Ranked Findings

| Rank | Sev | PerfScore | Finding | Component | Evidence | Measurement | Fix Summary | Owner | SLA | Status |
|------|-----|-----------|---------|-----------|----------|-------------|-------------|-------|-----|--------|
| 1 | P0 | 90 | Buffer.concat O(n^2) in processData | transport | `src/transport.ts` | Buffer list pattern implemented | Buffer list pattern; concat once at message boundary | -- | -- | **Closed** (Phase B) |
| 2 | P0 | 85 | gRPC unbounded response buffering | grpc-transport | `src/grpc-transport.ts` | Backpressure implemented | stream.pause()/resume() backpressure added | -- | -- | **Closed** (Phase B) |
| 3 | P0 | 75 | Sequential await in execBatch | client | `src/client.ts:191-194` | N serial round-trips for N queries | Delegate to batch() or use pool for concurrency | TBD (git blame client.ts) | Immediate | **Open** |
| 4 | P1 | 65 | GQLValue allocates 14 fields per instance | types | `src/types.ts` | Lazy initialization implemented | Lazy/undefined initialization; only set used field | -- | -- | **Closed** (Phase B) |
| 5 | P1 | 60 | queryAll double-conversion via GQLValue | connection | `src/connection.ts` | Fast path implemented | Fast path bypassing GQLValue for toJS() consumers | -- | -- | **Closed** (Phase B) |
| 6 | P1 | 55 | batch() ignores concurrency option | batch | `src/batch.ts` | Concurrency option honored | Delegates to batchParallel() when concurrency > 1 | -- | -- | **Closed** (Phase B) |
| 7 | P1 | 50 | Missing gRPC stream timeout | grpc-transport | `src/grpc-transport.ts` | Timeout added | Configurable streamTimeout with deadline | -- | -- | **Closed** (Phase B) |
| 8 | P1 | 45 | Pool maintenance interval prevents clean exit | pool | `src/pool.ts` | .unref() added | .unref() on maintenance interval | -- | -- | **Closed** (Phase A) |
| 9 | P2 | 40 | No benchmarks in CI | ci | `.gitlab-ci.yml` | 159 benchmarks exist, zero run in CI | -- | -- | -- | **Won't Do** (CI infra) |
| 10 | P2 | 30 | Sync proto loading at startup | proto | `src/proto.ts:346-352` | protobuf.loadSync blocks event loop 10-50ms | Use async protobuf.load() | TBD (git blame proto.ts) | Next quarter | Open |
| 11 | P2 | 20 | Sync filesystem in cert validation | validate | `src/validate.ts:888-892` | existsSync/lstatSync/realpathSync; less than 5ms, startup-only | Use fs.promises equivalents | TBD (git blame validate.ts) | Next quarter | Open |
| 12 | P2 | 15 | Regex in fromJSON per string value | types | `src/types.ts:671,675` | UUID+ISO regex on every string in fromJSON path | Pre-compile regex as module constants | TBD (git blame types.ts) | Next quarter | Open |
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

#### 3. Sequential await in execBatch

- **PerfSeverity**: P0 | **PerfScore**: 75 (Impact 4 x Likelihood 5 x 4, adjusted for existing workaround)
- **Confidence**: `confidence::confirmed` -- Sequential loop visible in source.

**Summary**: `GeodeClient.execBatch()` at `src/client.ts:191-194` awaits each query serially, producing N network round-trips for N queries. The `batch.ts` module has a `batchParallel()` function with concurrency control, but `execBatch` does not use it.

**Evidence**:
```
src/client.ts:191-194
async execBatch(queries) {
  for (const q of queries) {
    await this.exec(q.query, { params: q.params });
  }
}
```

**Root Cause**: Simple implementation that serializes inherently parallelizable work. The `batch()` function in `batch.ts:92` also has a sequential loop, but `batchParallel()` exists at line 297+.

**Fix Guidance**: When pooling is enabled, delegate to `batchParallel()` using pool connections. When using a single connection, pipeline queries if the protocol supports it, otherwise use `batch()` with transaction wrapping.

**Validation Plan**:
```
npm run bench -- --grep "batch"
```

**Rollout Risk**: Low-Medium. Parallel execution changes error semantics (partial failure). Document that some queries may execute even if others fail.

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

#### 10. Sync Proto Loading at Startup

- **PerfSeverity**: P2 | **PerfScore**: 30 (Impact 2 x Likelihood 3 x 4, rounded up for serverless)
- **Confidence**: `confidence::suspected` -- loadSync blocks event loop; exact duration depends on proto file size.

**Summary**: `protobuf.loadSync(PROTO_PATH)` at `src/proto.ts:346` is called synchronously at module load time (line 352). This blocks the event loop for 10-50ms. Particularly impactful in serverless / cold-start environments.

**Evidence**:
```
src/proto.ts:346
protoRoot = protobuf.loadSync(PROTO_PATH);

src/proto.ts:352
initProtoSync(); // Called at module scope
```

**Fix Guidance**: Replace `loadSync` with `protobuf.load()` (async). The async `ensureProtoInitialized()` already exists at line 357. Remove the sync init and ensure all entry points await the async version.

**Validation Plan**:
```
node -e "const t=Date.now(); require('./dist'); console.log('import ms:', Date.now()-t)"
```

**Rollout Risk**: Low. The async path already exists. Requires audit of all code paths that assume proto is initialized at import time.

---

#### 11. Sync Filesystem in Cert Validation

- **PerfSeverity**: P2 | **PerfScore**: 20 (Impact 1 x Likelihood 5 x 4)
- **Confidence**: `confidence::suspected` -- Sync calls confirmed; impact is startup-only, typically less than 5ms.

**Summary**: Certificate validation at `src/validate.ts:888-892` uses `fs.existsSync()`, `fs.lstatSync()`, and `fs.realpathSync()`.

**Fix Guidance**: Replace with `fs.promises` equivalents. The calling function would need to be async.

**Validation Plan**:
```
npm run test -- --grep "validate|cert|tls"
```

**Rollout Risk**: Very low. Startup-only path.

---

#### 12. Regex in fromJSON Per String Value

- **PerfSeverity**: P2 | **PerfScore**: 15 (Impact 1 x Likelihood 3 x 4, rounded up)
- **Confidence**: `confidence::suspected` -- Regex cost is minimal per call; only matters at very high volume. Normal typed query path bypasses this.

**Summary**: `fromJSON()` at `src/types.ts:671,675` tests every string value against UUID and ISO date regexes.

**Fix Guidance**: Pre-compile regexes as module-level constants. Consider removing auto-detection and making callers explicit about types.

**Validation Plan**:
```
npm run bench -- --grep "fromJSON|type"
```

**Rollout Risk**: Very low. Pre-compiling regexes is a mechanical change.

---

#### 13. Pool Stats Double Array Scan -- **CLOSED**

- **PerfSeverity**: P2 | **PerfScore**: 10
- **Status**: **Closed / Implemented** (Phase A, commits 68b7aea-22726e2)

**Resolution**: Replaced dual `filter().length` calls with single-pass counter.

**Evidence**: `src/pool.ts` stats getter, `tests/unit/pool.test.ts`.

---

## Roadmap

### Quick Wins (less than 1 day)

| Finding | PerfScore | Effort |
|---------|-----------|--------|
| Pool .unref() (8) | 45 | ~5 min, 1-line fix |
| Pool stats single pass (13) | 10 | ~10 min |
| Pre-compile fromJSON regexes (12) | 15 | ~15 min |
| GQLValue lazy initialization (4) | 65 | ~2 hours |

### Medium (1-5 days)

| Finding | PerfScore | Effort |
|---------|-----------|--------|
| Buffer.concat O(n^2) fix (1) | 90 | ~1 day, needs careful remainder handling |
| execBatch parallelization (3) | 75 | ~1 day, delegate to batchParallel |
| batch() honor concurrency (6) | 55 | ~0.5 day |
| gRPC stream timeout (7) | 50 | ~0.5 day |
| Add benchmarks to CI (9) | 40 | ~0.5 day |
| queryAll fast path (5) | 60 | ~2 days |

### Strategic (more than 5 days)

| Finding | PerfScore | Effort |
|---------|-----------|--------|
| gRPC backpressure (2) | 85 | ~3-5 days, streaming architecture change |
| Async proto loading (10) | 30 | ~1-2 days, requires audit of all init paths |
| Async cert validation (11) | 20 | ~1 day, depends on caller chain |

---

## Unknowns and Blockers

1. **Buffer.concat measurement**: The 8 GiB estimate assumes 16 KiB chunks for a 16 MiB response. Actual QUIC chunk sizes may vary. Confirm with transport-level logging under realistic load.

2. **gRPC backpressure deadlock risk**: Adding pause/resume requires careful analysis of the gRPC Node.js internals to ensure the server-side flow control cooperates. Test with slow consumers.

3. **batchParallel single-connection behavior**: The finding notes batchParallel is "broken with single connection." This needs investigation -- if the Geode protocol does not support pipelining, concurrent queries on one connection will serialize at the wire level regardless.

4. **Proto load time**: The 10-50ms estimate for loadSync needs measurement on the actual proto file. Smaller protos may load in less than 5ms, making this a non-issue outside serverless.

5. **queryAll allocation overhead**: Profiler data would confirm whether the GQLValue intermediaries are the bottleneck or whether wire parsing dominates. Run `node --prof` on a 10K-row query to confirm.
