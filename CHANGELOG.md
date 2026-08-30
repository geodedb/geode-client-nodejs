# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-08-29

Connection-protocol correctness. Needs a **minor** release: concurrent requests
on one connection now queue instead of failing fast, which is a behaviour
change for callers that relied on `ErrQueryInProgress`.

### Changed

- **Concurrent requests on a single `Connection` are serialized, not rejected.**
  A connection owns one bidirectional stream and the wire protocol carries no
  request/response correlation id, so overlapping exchanges read each other's
  answers. Every exchange (`query`, `exec`, `ping`, `begin`, commit, rollback,
  savepoint, rollback-to and page fetches) now takes a FIFO exchange lock for
  its full request -> final-response round trip. `Connection.checkState()` no
  longer throws `ErrQueryInProgress` for a concurrent request; callers queue.
  `ErrQueryInProgress` remains exported for compatibility but is deprecated and
  is no longer thrown by the driver.
- `ConnectionPool.query()` keeps its pooled member checked out for the lifetime
  of a **streaming** `QueryResult` and releases it when the result closes. A
  result whose rows are already buffered releases the member immediately, as
  before.
- `withAbortTimeout()` aborts its deadline with an explicit reason
  (`geode:request-timeout`) and its handle exposes `timedOut()`, so a deadline
  can be told apart from a caller-initiated abort.

### Fixed

- **ENG-3916 / ENG-3918: results larger than one server page desynced the
  connection.** The server pushes SCHEMA and then EVERY data page as `execute`
  responses until `final = true` (`quic_connection_handler.zig:7544-7566`) and
  expects no PULL, but the client read a single page and then sent a
  speculative PULL for each subsequent page. An N-page result therefore left
  N-1 pushed pages _and_ every PULL's own reply unread on a stream with no
  correlation ids. The connection was permanently one or more messages out of
  phase: the next query failed with "Invalid execute response" /
  "Expected schema response", and once it stopped failing it silently served
  the PREVIOUS query's schema and rows - to any caller, including one that got
  the connection back from the pool. The client now reads the pushed pages, and
  reserves PULL for the case where the server genuinely parks a result awaiting
  one (node-scan stream / inline results disabled).
- **ENG-3916: abandoning a multi-page result left the connection out of phase.**
  Closing a `QueryResult` early (`first()`, `close()`, `break`) now drains the
  pages the server still owes - bounded, under the exchange lock the result
  holds - and tears the connection down if it cannot be brought back in phase.
- **ENG-3918: a request timeout left a poisoned connection open and pooled.**
  The request deadline aborts with cause `Aborted`, which
  `_closeOnTransportError` exempted, so a connection that still owed a response
  stayed `idle` in the pool and handed the timed-out query's rows to the next
  caller. Any receive that fails now marks the connection broken.
- **ENG-3918: `QuicTransport` lied about liveness.** `startReading()` broke out
  of its read loop when the stream ended or errored but never latched `_closed`,
  so `isClosed()` reported healthy (the pool's only liveness predicate) and a
  later `receiveProto()` parked a reader on a pump that had already exited and
  waited forever. A dead read pump now latches the transport closed and stores a
  sticky error thrown by the next `receiveProto()`. Already-decoded frames stay
  readable so in-flight requests are still answered.
- **ENG-3916: concurrent `sendProto()` calls threw "WritableStream is locked".**
  QUIC stream writes are serialized on a write chain.
- `ConnectionPool` evicts broken members at acquire time (in addition to release
  and maintenance), so a pool at `maxConnections` full of dead connections
  reconnects on next use instead of blocking until the maintenance tick.
- `Connection.reset()` takes over an unfinished streaming result's exchange lock
  and drains its outstanding pages before the connection is reused.

## [1.2.0] - 2026-08-25

Correctness release: exact int64 handling on the wire and an end to the
inline/PULL desync that could serve one query another query's rows.

### Added

- `inline_timeout` DSN parameter, matching the existing `inlineTimeout` config
  field: how long to wait for the data page the server sends inline after
  SCHEMA before falling back to an explicit PULL (default 5000 ms).

### Changed

- int64/uint64 protobuf fields are decoded as exact `bigint` values
  (bindings regenerated with ts-proto `forceLong=bigint`). Values are narrowed
  back to `number` at the JS boundary when they are safe integers, so the
  public `GQLId`, `QueryPlan` and `QueryProfile` shapes are unchanged; callers
  that read raw protobuf messages now see `bigint` for those fields.
- gRPC messages are loaded with `longs: String` and normalized during value
  conversion, so string, bigint and number representations resolve to the same
  lossless value.

### Fixed

- **ENG-3908**: int64 precision loss across both transports. Over QUIC, any
  value above 2^53 (server-assigned graph ids routinely exceed it) threw
  "Value is larger than Number.MAX_SAFE_INTEGER" and failed the whole result
  page; over gRPC the same values were silently truncated. A QUIC frame that
  fails to decode with no reader parked is now latched and surfaced to the
  next `receiveProto()` instead of being dropped, which used to stall the
  inline read until the server answered 02000 "no active result set".
- **ENG-3916**: cross-query data leakage after a slow first page. The client
  abandoned the in-flight inline page once `inlineTimeout` elapsed and sent a
  speculative PULL; the late page was consumed as the PULL answer and the real
  PullResponse stayed queued in the FIFO transport. The connection was then one
  message out of phase permanently - the next query failed with "Invalid
  execute response" and every query after it silently received the PREVIOUS
  query's schema and rows, including on connections handed back to the pool.
  The inline exchange is no longer abandoned: the client tracks the pending
  inline response and reconciles it with the server's `pull`-wrapped
  acknowledgement before returning.
- **ENG-3916 (security)**: any unexpected message type, and any exchange that
  cannot be reconciled, now closes the connection instead of throwing on an
  open one, so a desynced connection can never be reused or returned to the
  pool.

### Notes

- The durable fix for the desync class is a request/response correlation id in
  the wire protocol; the client can currently only reconcile by message type
  plus stream ordering. Flagged for the server team (see the NOTE on
  `Connection._pullFirstPage`).

## [1.0.2] - 2026-06-01

Parity-sync release: finalizes feature/behavior parity with the Go and Zig reference clients.

### Added

- Client-level retry wrapper (`withRetry`, `RetryPolicy`, `defaultRetryPolicy`) mirroring
  the Go reference `RetryPolicy`: retries only on retryable errors (`isRetryableError`)
  with exponential backoff capped at `maxBackoffMs`.

### Changed

- Heartbeat-aware response draining and gRPC stream lifecycle hardening.
- Connection self-heal on transport error (`_closeOnTransportError`) and QUIC
  unsolicited-response buffering.
- Connection pool race fix (`_pendingConnections`); raised `maxIdleTime` 30s → 120s.

### Fixed

- TLS SNI handling and auth-on integration behavior over gRPC.

### Notes

- Savepoints (`savepoint` / `rollbackTo`) are supported only over the QUIC transport.
  Over gRPC they reject with a typed `DriverError` (statusClass `58000`) directing
  callers to use `quic://`. This behavior is now covered by a regression test.
