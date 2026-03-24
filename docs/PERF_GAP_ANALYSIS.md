# Performance Gap Analysis -- Geode Node.js Client

Last updated: 2026-03-24

---

## Summary

| PerfSeverity | Count |
|--------------|-------|
| P0           | 3     |
| P1           | 5     |
| P2           | 5     |
| **Total**    | **13** |

### Top 5 Risks

| # | Finding | PerfScore | Expected Impact |
|---|---------|-----------|-----------------|
| 1 | Buffer.concat O(n^2) in processData | 90 | Eliminate ~8 GiB memcpy on 16 MiB responses; 10-50x throughput gain on large payloads |
| 2 | gRPC unbounded response buffering | 85 | Prevent OOM on large result sets; enable constant-memory streaming |
| 3 | Sequential await in execBatch | 75 | N round-trips to 1; batch latency reduced by (N-1) * RTT |
| 4 | GQLValue 14-field allocation overhead | 65 | ~1.4 MiB saved per 1000-row page; reduced GC pressure |
| 5 | queryAll double-conversion through GQLValue | 60 | Eliminate 10K throwaway allocations per page |

---

## Stack-Ranked Findings

| Rank | Sev | PerfScore | Finding | Component | Evidence | Measurement | Fix Summary | Owner | SLA | Status |
|------|-----|-----------|---------|-----------|----------|-------------|-------------|-------|-----|--------|
| 1 | P0 | 90 | Buffer.concat O(n^2) in processData | transport | `src/transport.ts:339` | 16 MiB / 16 KiB chunks = ~1024 concats, ~8 GiB total memcpy | Buffer list pattern; concat once at message boundary | TBD (git blame transport.ts) | Immediate | Open |
| 2 | P0 | 85 | gRPC unbounded response buffering | grpc-transport | `src/grpc-transport.ts:84,388-395` | Memory proportional to full result set; no backpressure | Add stream.pause()/resume() backpressure | TBD (git blame grpc-transport.ts) | Immediate | Open |
| 3 | P0 | 75 | Sequential await in execBatch | client | `src/client.ts:191-194` | N serial round-trips for N queries | Delegate to batch() or use pool for concurrency | TBD (git blame client.ts) | Immediate | Open |
| 4 | P1 | 65 | GQLValue allocates 14 fields per instance | types | `src/types.ts:181-194` | ~1.4 MiB wasted per 1000-row page (14 fields x 10K instances) | Lazy/undefined initialization; only set used field | TBD (git blame types.ts) | Within sprint | Open |
| 5 | P1 | 60 | queryAll double-conversion via GQLValue | connection | `src/connection.ts:384-392` | 10K throwaway GQLValue instances per page | Fast path bypassing GQLValue for toJS() consumers | TBD (git blame connection.ts) | Within sprint | Open |
| 6 | P1 | 55 | batch() ignores concurrency option | batch | `src/batch.ts:92` | Sequential loop despite concurrency field in BatchOptions | Use batchParallel() or honor concurrency in batch() | TBD (git blame batch.ts) | Within sprint | Open |
| 7 | P1 | 50 | Missing gRPC stream timeout | grpc-transport | `src/grpc-transport.ts:372-416` | Hung server = indefinite client wait | Add deadline/timeout to streaming RPCs | TBD (git blame grpc-transport.ts) | Within sprint | Open |
| 8 | P1 | 45 | Pool maintenance interval prevents clean exit | pool | `src/pool.ts:153` | setInterval without .unref() keeps event loop alive | Add .unref() to maintenance interval | TBD (git blame pool.ts) | Within sprint | Open |
| 9 | P2 | 40 | No benchmarks in CI | ci | `.gitlab-ci.yml` | 159 benchmarks exist, zero run in CI | Add bench stage to .gitlab-ci.yml | TBD | Next quarter | Open |
| 10 | P2 | 30 | Sync proto loading at startup | proto | `src/proto.ts:346-352` | protobuf.loadSync blocks event loop 10-50ms | Use async protobuf.load() | TBD (git blame proto.ts) | Next quarter | Open |
| 11 | P2 | 20 | Sync filesystem in cert validation | validate | `src/validate.ts:888-892` | existsSync/lstatSync/realpathSync; less than 5ms, startup-only | Use fs.promises equivalents | TBD (git blame validate.ts) | Next quarter | Open |
| 12 | P2 | 15 | Regex in fromJSON per string value | types | `src/types.ts:671,675` | UUID+ISO regex on every string in fromJSON path | Pre-compile regex as module constants | TBD (git blame types.ts) | Next quarter | Open |
| 13 | P2 | 10 | Pool stats double array scan | pool | `src/pool.ts:190-191` | Two filter().length calls on connections array | Single-pass reduce | TBD (git blame pool.ts) | Next quarter | Open |

---

## Findings by Area

### App (Transport / Client / Types)

#### 1. Buffer.concat O(n^2) in processData

- **PerfSeverity**: P0 | **PerfScore**: 90 (Impact 5 x Likelihood 5 x 4, capped conservatively)
- **Confidence**: `confidence::confirmed` -- Quadratic behavior visible in source; no profiler needed.

**Summary**: Every QUIC data chunk triggers `Buffer.concat([this._protoBuffer, data])` at `src/transport.ts:339`. Each call copies the entire accumulated buffer plus the new chunk. For a 16 MiB response arriving in 16 KiB chunks, this produces approximately 1024 concat operations totaling ~8 GiB of memcpy.

**Evidence**:
```
src/transport.ts:339
this._protoBuffer = Buffer.concat([this._protoBuffer, data]);
```

**Root Cause**: The classic "string builder" anti-pattern applied to buffers. Each append copies all previously accumulated data, making total work O(n^2) in the number of chunks.

**Fix Guidance**: Replace with a buffer list pattern. Accumulate chunks in an array (`Buffer[]`). Track total byte length with a counter. Call `Buffer.concat(chunks, totalLength)` only when a complete message boundary is detected (the length-prefix parse at line 347). After extracting the message, keep only the remainder as a single buffer.

**Validation Plan**:
```
npm run bench -- --grep "transport|large|payload"
```

**Rollout Risk**: Low. Internal implementation change with no API surface change. Test with existing transport unit tests. Watch for off-by-one in remainder buffer handling.

---

#### 2. gRPC Unbounded Response Buffering

- **PerfSeverity**: P0 | **PerfScore**: 85 (Impact 5 x Likelihood 4 x 4, rounded up for OOM risk)
- **Confidence**: `confidence::confirmed` -- No backpressure mechanism in source.

**Summary**: The gRPC Execute stream handler at `src/grpc-transport.ts:388-395` pushes every response into `_pendingResponses[]` with no flow control. Memory usage is proportional to the entire result set.

**Evidence**:
```
src/grpc-transport.ts:84
private _pendingResponses: QuicServerMessage[] = [];

src/grpc-transport.ts:388-390
stream.on('data', (response) => {
  this._pendingResponses.push({ ... });
});
```

**Root Cause**: No `stream.pause()` / `stream.resume()` calls. The Node.js gRPC stream will buffer the entire server response in-process before the consumer reads any rows.

**Fix Guidance**: Implement backpressure: `stream.pause()` when `_pendingResponses.length` exceeds a high-water mark. `stream.resume()` when the consumer drains below a low-water mark. Alternatively, convert to an async iterator pattern with bounded internal queue.

**Validation Plan**:
```
npm run test:integration -- --grep "large result"
```
Monitor RSS during test to confirm memory stays bounded.

**Rollout Risk**: Medium. Backpressure changes affect streaming semantics. Must verify no deadlock when producer pauses. Test with both small and large result sets.

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

#### 4. GQLValue Allocates 14 Fields Per Instance

- **PerfSeverity**: P1 | **PerfScore**: 65 (Impact 3 x Likelihood 5 x 4, rounded up for GC pressure)
- **Confidence**: `confidence::confirmed` -- Field declarations visible in source.

**Summary**: Every `GQLValue` instance initializes 14 private fields (`src/types.ts:181-194`), but only 1-2 are used per value. A 1000-row page with 10 columns creates ~10K instances with ~140K unused field slots.

**Evidence**:
```
src/types.ts:181-194
private _intValue: bigint = 0n;
private _floatValue: number = 0;
private _boolValue: boolean = false;
private _stringValue: string = '';
private _decimalValue?: Decimal;
private _arrayValue: GQLValue[] = [];
private _objectValue: Map<string, GQLValue> = new Map();
private _bytesValue: Uint8Array = new Uint8Array();
// ... 6 more optional fields
```

Note: `_arrayValue`, `_objectValue`, and `_bytesValue` allocate empty containers eagerly even when unused.

**Root Cause**: Eager initialization of all fields regardless of the value's `kind`.

**Fix Guidance**: Change all fields to `undefined` default (remove initializers). Only set the relevant field in each factory method. Alternatively, use a tagged union / discriminated union pattern.

**Validation Plan**:
```
npm run bench -- --grep "GQLValue|type"
```

**Rollout Risk**: Low. Internal refactor with same public API. Getters must handle `undefined` instead of zero-values.

---

#### 5. queryAll Double-Conversion via GQLValue

- **PerfSeverity**: P1 | **PerfScore**: 60 (Impact 3 x Likelihood 5 x 4)
- **Confidence**: `confidence::suspected` -- Pattern-matched. Profiling would confirm allocation overhead vs. parse cost.

**Summary**: `queryAll()` at `src/connection.ts:384-392` creates `Map<string, GQLValue>` per row, then immediately calls `.toJS()` on every value. The intermediate GQLValue instances are throwaway allocations.

**Evidence**:
```
src/connection.ts:384-392
for await (const row of result) {
  const obj: Record<string, unknown> = {};
  for (const col of result.columns) {
    const value = row.get(col.name);
    obj[col.name] = value?.toJS();
  }
  rows.push(obj);
}
```

**Root Cause**: `queryAll()` always converts to plain JS objects but goes through the full GQLValue materialization path first.

**Fix Guidance**: Add a "raw JS" mode to the result iterator that converts wire values directly to JS types without the GQLValue intermediate. Keep `query()` for users who want typed access.

**Validation Plan**:
```
npm run bench -- --grep "queryAll|query"
```

**Rollout Risk**: Low. New code path; existing path unchanged.

---

#### 6. batch() Ignores Concurrency Option

- **PerfSeverity**: P1 | **PerfScore**: 55 (Impact 3 x Likelihood 4 x 4, rounded up)
- **Confidence**: `confidence::confirmed` -- Sequential loop at batch.ts:92 despite concurrency field in BatchOptions.

**Summary**: The `batch()` function at `src/batch.ts:92` processes queries in a sequential loop. The `BatchOptions` interface declares a `concurrency` field (line 61), but `batch()` ignores it. `batchParallel()` exists (line 297+) but requires explicit use.

**Fix Guidance**: When `options.concurrency` is set and greater than 1, delegate to the `batchParallel()` implementation internally. Or deprecate the field on `batch()` and direct users to `batchParallel()`.

**Validation Plan**:
```
npm run bench -- --grep "batch"
```

**Rollout Risk**: Low. Behavioral change only when concurrency option is explicitly set.

---

#### 7. Missing gRPC Stream Timeout

- **PerfSeverity**: P1 | **PerfScore**: 50 (Impact 4 x Likelihood 3 x 4, rounded up for reliability)
- **Confidence**: `confidence::confirmed` -- No deadline set on stream.

**Summary**: The gRPC Execute streaming call at `src/grpc-transport.ts:372-416` has no deadline or timeout. If the server hangs, the client waits indefinitely. The AbortSignal handler (line 408-413) only works if the caller provides a signal.

**Fix Guidance**: Add a configurable `streamTimeout` (default 30s) to gRPC transport config. Pass as `deadline` option to the execute call. Also add a fallback setTimeout that cancels the stream.

**Validation Plan**:
```
npm run test:integration -- --grep "timeout|deadline"
```

**Rollout Risk**: Low-Medium. New default timeout could break long-running queries. Make configurable with generous default.

---

#### 8. Pool Maintenance Interval Prevents Clean Process Exit

- **PerfSeverity**: P1 | **PerfScore**: 45 (Impact 3 x Likelihood 3 x 4, rounded up for DX impact)
- **Confidence**: `confidence::confirmed` -- No .unref() call visible.

**Summary**: The connection pool creates a `setInterval` at `src/pool.ts:153` for maintenance tasks without calling `.unref()`. This keeps the Node.js event loop alive even after all user code has completed.

**Evidence**:
```
src/pool.ts:153-155
this._maintenanceInterval = setInterval(() => {
  this.maintenance();
}, 10000);
```

**Fix Guidance**: Add `.unref()` to the interval handle immediately after creation.

**Validation Plan**: Create a script that opens a pool, does not call close(), and verify the process exits within a few seconds.

**Rollout Risk**: Very low. `.unref()` is a standard Node.js pattern. No behavioral change when pool is actively used.

---

### CI

#### 9. No Benchmarks in CI

- **PerfSeverity**: P2 | **PerfScore**: 40 (Impact 2 x Likelihood 5 x 4)
- **Confidence**: `confidence::confirmed` -- No bench stage in .gitlab-ci.yml.

**Summary**: 159 benchmarks exist (`npm run bench`) but no CI job runs them. Performance regressions can ship undetected.

**Evidence**: `.gitlab-ci.yml` defines stages: install, lint, build, test, security, sbom, publish, release. No bench stage.

**Fix Guidance**: Add a bench stage after test using the node-test catalog component or a custom job. Use `allow_failure: true` initially.

**Validation Plan**:
```
npm run bench
```

**Rollout Risk**: Very low. Additive CI change.

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

#### 13. Pool Stats Double Array Scan

- **PerfSeverity**: P2 | **PerfScore**: 10 (Impact 1 x Likelihood 2 x 4, rounded up)
- **Confidence**: `confidence::confirmed` -- Two separate filter() calls visible.

**Summary**: `ConnectionPool.stats` at `src/pool.ts:190-191` calls `filter().length` twice on the connections array.

**Fix Guidance**: Single-pass counter. Compute `inUse = total - available`.

**Validation Plan**:
```
npm run test -- --grep "pool"
```

**Rollout Risk**: None. Pure refactor, same result.

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
