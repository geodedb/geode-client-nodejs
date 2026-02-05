# CLAUDE.md - Geode Node.js Client

This file provides guidance to Claude Code when working with the Geode Node.js client library.

## Project Overview

This is the **Node.js client library** for **Geode**, implementing the ISO/IEC 39075:2024 GQL standard over QUIC or gRPC with TLS 1.3.

**Language**: TypeScript/JavaScript
**Runtime**: Node.js 20+
**Protocol**: Protobuf wire protocol over QUIC (default) or gRPC
**Package Type**: ESM-only

## Quick Reference

### Makefile Commands (Recommended)

```bash
# Full build + test pipeline
make                             # install, build, lint, typecheck, test, property tests

# Clean and rebuild
make clean && make

# Individual targets
make build                       # Build library
make test-unit                   # Unit tests (359 tests)
make test-property               # Property-based tests (80 tests)
make test-integration            # Integration tests (requires Geode server)
make test-integration-docker     # Integration tests with Docker
make bench                       # Run benchmarks (159 benchmarks)
make lint                        # ESLint
make fmt                         # Format code
make typecheck                   # TypeScript type checking
make coverage                    # Generate coverage report
make ci                          # Full CI pipeline
```

### npm Commands

```bash
# Build
npm install                      # Install dependencies
npm run build                    # Build library
npm run typecheck                # Type checking
npm run dev                      # Watch mode for development

# Test
npm test                         # Unit tests
npm run test:coverage            # Unit tests with coverage
npm run test:integration         # Integration tests (requires Docker)
npm run test:watch               # Watch mode
npm run bench                    # Benchmarks

# Lint
npm run lint                     # Run linter
npm run lint:fix                 # Fix lint issues
npm run format:check             # Check formatting
npm run format                   # Fix formatting
```

## Architecture Overview

```
src/
├── index.ts          # Main exports
├── client.ts         # GeodeClient - high-level API
├── connection.ts     # Connection management
├── transport.ts      # QUIC transport layer
├── grpc-transport.ts # gRPC transport layer
├── proto.ts          # Protobuf encoding/decoding
├── types.ts          # GQL type system
├── errors.ts         # Error types (ISO status codes)
├── config.ts         # Configuration/DSN parsing (quic://, grpc://)
├── pool.ts           # Connection pooling
├── query-builder.ts  # Fluent query builder
├── result.ts         # Query result handling
├── transaction.ts    # Transaction support
├── validate.ts       # Input validation
├── prepared.ts       # Prepared statements
├── explain.ts        # Query explain/profile
├── batch.ts          # Batch query operations
└── auth.ts           # Authentication client (users, roles, RLS)

proto/
└── geode.proto       # Protocol buffer definitions
```

## Wire Protocol

The client communicates with Geode using Protocol Buffers over QUIC or gRPC.

**QUIC Wire Format**: 4-byte Big Endian length prefix + protobuf message body
**gRPC**: Standard gRPC with protobuf serialization

### DSN Schemes

| Scheme    | Transport | Default Port |
| --------- | --------- | ------------ |
| `quic://` | QUIC      | 3141         |
| `grpc://` | gRPC      | 50051        |

### Message Types (QuicClientMessage)

| Field       | Purpose               |
| ----------- | --------------------- |
| hello       | Connection handshake  |
| execute     | Execute GQL query     |
| pull        | Fetch result page     |
| begin       | Start transaction     |
| commit      | Commit transaction    |
| rollback    | Rollback transaction  |
| savepoint   | Create savepoint      |
| rollbackTo  | Rollback to savepoint |
| ping        | Health check          |

### Response Types (Server → Client)

| Type     | Purpose            |
| -------- | ------------------ |
| HELLO    | Handshake response |
| SCHEMA   | Column definitions |
| BINDINGS | Result rows        |
| ERROR    | Error response     |
| PROFILE  | Execution profile  |
| RESULT   | Operation result   |
| STATUS   | Status response    |

### Query Flow

```
CLIENT                          SERVER
  │
  ├─ RUN_GQL ──────────────────→
  │                             │
  │← SCHEMA ─────────────────────
  │
  ├─ PULL ──────────────────────→
  │                             │
  │← BINDINGS ───────────────────
  │
  └─ (repeat PULL until final=true)
```

## Key Implementation Details

### Connection State Machine

```
idle ──────→ executing ──────→ idle
  │              │
  │              ↓
  └──→ fetching ───────→ idle
  │
  └──→ in_transaction ──→ idle
                  │
                  ↓
              closed/error
```

### Error Handling

All errors use ISO/IEC 39075 status classes:

| Class | Meaning           | Retryable |
| ----- | ----------------- | --------- |
| 00000 | Success           | No        |
| 40001 | Serialization     | Yes       |
| 40502 | Deadlock          | Yes       |
| 42000 | Syntax            | No        |
| 25000 | Transaction state | No        |
| 28000 | Authorization     | No        |
| 58000 | System error      | No        |

### Type System

GQL values are wrapped in `GQLValue` class with type-safe accessors:

```typescript
const value = GQLValue.int(42);
value.kind; // 'INT'
value.asInt; // 42n (bigint)
value.asNumber; // 42 (number)
value.toJS(); // 42 (auto-converts based on safety)
```

## Development Guidelines

### Code Style

- Use TypeScript strict mode
- Follow ESLint rules (configured in project)
- Use Prettier for formatting
- Document all public APIs with JSDoc

### Testing Requirements

- Unit tests for all modules
- Integration tests for protocol compliance
- Property-based tests for parsers
- 80%+ code coverage target

### Security Considerations

1. **Input Validation**: Always validate user inputs
   - Query length limits
   - Null byte detection
   - Parameter name validation
   - Depth limits for nested values

2. **TLS Configuration**: Default to secure
   - TLS 1.3 minimum
   - No skip-verify in production
   - Support mTLS

3. **Credential Handling**: Never log sensitive data
   - Use `sanitizeForLog()` for logging
   - Clear credentials from memory when possible

## Common Patterns

### Basic Usage

```typescript
import { createClient } from '@geodedb/client';

const client = await createClient('quic://localhost:3141');
const rows = await client.queryAll('MATCH (n) RETURN n LIMIT 10');
await client.close();
```

### Transaction Pattern

```typescript
await client.withTransaction(async (tx) => {
  await tx.exec('CREATE (n:Person {name: $name})', { params: { name: 'Alice' } });
  await tx.exec('CREATE (n:Person {name: $name})', { params: { name: 'Bob' } });
  // Auto-commits on success, auto-rolls back on error
});
```

### Connection Pool Usage

```typescript
const client = await createClient('quic://localhost:3141', {
  pooling: true,
  pool: { min: 2, max: 10 },
});

// Connections are automatically managed
const rows = await client.queryAll('MATCH (n) RETURN n');
```

### Query Builder

```typescript
import { query, pattern, predicate } from '@geodedb/client';

const q = query()
  .match(
    pattern()
      .node((n) => n.as('a').label('Person'))
      .outgoing((e) => e.type('KNOWS'))
      .node((n) => n.as('b'))
  )
  .where(predicate().gt('a.age', 21).isNotNull('b.email'))
  .return('a.name', 'b.name')
  .limit(10);

const { query: gql, params } = q.build();
```

## Troubleshooting

### Connection Issues

1. **TLS Errors**: Check certificate configuration
2. **Timeout**: Increase `connectTimeout` in config
3. **QUIC Issues**: Ensure UDP port is accessible

### Query Issues

1. **Syntax Errors**: Check GQL compliance
2. **Parameter Errors**: Validate parameter names
3. **Type Errors**: Use appropriate type conversions

## Dependencies

### Required

- `@aspect-build/quiche`: QUIC implementation
- `decimal.js-light`: Decimal precision

### Development

- `typescript`: Type checking
- `vitest`: Testing
- `tsup`: Building
- `eslint/prettier`: Code quality
- `testcontainers`: Integration tests

## CI/CD

The project uses GitLab CI with the following stages:

1. **lint**: Code quality checks
2. **build**: TypeScript compilation
3. **test:unit**: Unit tests
4. **test:integration**: Docker-based tests
5. **coverage**: Coverage reporting
6. **publish**: NPM publishing (tagged releases)

## Related Documentation

- [Main CLAUDE.md](../CLAUDE.md) - Monorepo overview
- [Geode Server CLAUDE.md](../geode/CLAUDE.md) - Server implementation
- [UPGRADE_PLAN.md](../UPGRADE_PLAN.md) - Client upgrade guidelines
- [Protocol Specification](../geode/docs/PROTOCOL.md) - Wire protocol details
