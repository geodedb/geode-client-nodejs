# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
