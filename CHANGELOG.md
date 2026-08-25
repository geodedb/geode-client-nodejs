# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
