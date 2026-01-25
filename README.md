# Geode Node.js Client

A high-performance Node.js client library for the [Geode](https://gitlab.com/devnw/geode) graph database, implementing the ISO/IEC 39075:2024 GQL standard over QUIC + TLS 1.3.

## Features

- **Full GQL Support**: Implements ISO/IEC 39075:2024 Graph Query Language standard
- **QUIC Transport**: High-performance transport with TLS 1.3 encryption
- **Connection Pooling**: Efficient connection management for high-throughput applications
- **Type Safety**: Full TypeScript support with comprehensive type definitions
- **Query Builder**: Fluent API for building GQL queries programmatically
- **Transaction Support**: Full transaction management with savepoints
- **Async/Await**: Modern async API with proper cancellation support

## Installation

```bash
npm install @geode/client
```

**Requirements:**

- Node.js 20.0.0 or later
- A running Geode server (default port: 3141)

## Quick Start

```typescript
import { createClient } from '@geode/client';

// Connect to Geode
const client = await createClient('geode://localhost:3141');

// Execute a query
const rows = await client.queryAll('MATCH (n:Person) RETURN n.name, n.age');
console.log(rows);
// [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]

// Close connection
await client.close();
```

## Configuration

### DSN Format

```
geode://[username:password@]host[:port][?options]
```

### Options

| Option            | Description                       | Default      |
| ----------------- | --------------------------------- | ------------ |
| `page_size`       | Results per page                  | 1000         |
| `hello_name`      | Client name                       | geode-nodejs |
| `hello_ver`       | Client version                    | 1.0.0        |
| `conformance`     | GQL conformance level             | min          |
| `insecure`        | Skip TLS verification (dev only)  | false        |
| `ca`              | Path to CA certificate            | -            |
| `cert`            | Path to client certificate (mTLS) | -            |
| `key`             | Path to client key (mTLS)         | -            |
| `server_name`     | SNI server name                   | -            |
| `connect_timeout` | Connection timeout (ms)           | 30000        |
| `request_timeout` | Request timeout (ms)              | 120000       |

### Environment Variables

| Variable         | Description                 |
| ---------------- | --------------------------- |
| `GEODE_HOST`     | Default host                |
| `GEODE_PORT`     | Default port                |
| `GEODE_TLS_CA`   | Default CA certificate path |
| `GEODE_USERNAME` | Default username            |
| `GEODE_PASSWORD` | Default password            |

### Example Configurations

```typescript
// Simple connection
const client = await createClient('localhost:3141');

// With authentication
const client = await createClient('geode://admin:secret@localhost:3141');

// With TLS
const client = await createClient('geode://localhost:3141?ca=/path/to/ca.crt');

// With mTLS
const client = await createClient(
  'geode://localhost:3141?ca=/path/to/ca.crt&cert=/path/to/client.crt&key=/path/to/client.key'
);

// With connection pool
const client = await createClient('geode://localhost:3141', {
  pooling: true,
  pool: {
    min: 2,
    max: 10,
    acquireTimeout: 30000,
    idleTimeout: 60000,
  },
});
```

## Usage Examples

### Basic Queries

```typescript
// Query with iteration
const result = await client.query('MATCH (n:Person) RETURN n');
for await (const row of result) {
  console.log(row.get('n')?.asNode);
}

// Query all rows at once
const rows = await client.queryAll('MATCH (n:Person) RETURN n.name AS name');

// Get first row
const first = await client.queryFirst('MATCH (n:Person) RETURN n.name LIMIT 1');

// Get scalar value
const count = await client.queryScalar<number>('MATCH (n:Person) RETURN count(n) AS cnt', 'cnt');
```

### Parameterized Queries

```typescript
// Named parameters
const rows = await client.queryAll('MATCH (n:Person) WHERE n.age > $minAge RETURN n', {
  params: { minAge: 21 },
});

// Positional parameters (converted to $p1, $p2, etc.)
const rows = await client.queryAll('MATCH (n:Person) WHERE n.age > ? AND n.name = ? RETURN n', {
  params: [21, 'Alice'],
});
```

### Create, Update, Delete

```typescript
// Create nodes
await client.exec("CREATE (n:Person {name: 'Alice', age: 30})");

// Create with helper method
const node = await client.createNode('Person', { name: 'Bob', age: 25 });

// Update
await client.exec("MATCH (n:Person {name: 'Alice'}) SET n.age = 31");

// Delete
await client.exec("MATCH (n:Person {name: 'Alice'}) DELETE n");

// Delete with relationships
await client.exec("MATCH (n:Person {name: 'Alice'}) DETACH DELETE n");
```

### Relationships

```typescript
// Create relationship
await client.exec(`
  MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})
  CREATE (a)-[:KNOWS {since: 2020}]->(b)
`);

// Query relationships
const rows = await client.queryAll(`
  MATCH (a:Person)-[r:KNOWS]->(b:Person)
  RETURN a.name AS from, b.name AS to, r.since AS since
`);

// Variable-length paths
const rows = await client.queryAll(`
  MATCH (a:Person {name: 'Alice'})-[:KNOWS*1..3]->(friend)
  RETURN friend.name
`);
```

### Transactions

```typescript
// Basic transaction
await client.withTransaction(async (tx) => {
  await tx.exec("CREATE (n:Person {name: 'Alice'})");
  await tx.exec("CREATE (n:Person {name: 'Bob'})");
  // Auto-commits on success
});

// Manual transaction control
const conn = await client.getConnection();
const tx = await conn.begin();
try {
  await tx.exec('CREATE (n:Test {value: 1})');
  await tx.savepoint('sp1');
  await tx.exec('CREATE (n:Test {value: 2})');
  await tx.rollbackTo('sp1'); // Undo second create
  await tx.commit();
} catch (e) {
  await tx.rollback();
  throw e;
} finally {
  await client.releaseConnection(conn);
}
```

### Query Builder

```typescript
import { query, pattern, predicate } from '@geode/client';

// Build complex queries
const q = query()
  .match(
    pattern()
      .node((n) => n.as('a').label('Person'))
      .outgoing((e) => e.type('KNOWS'))
      .node((n) => n.as('b').label('Person'))
  )
  .where(predicate().gt('a.age', 21).isNotNull('b.email'))
  .return('a.name AS from', 'b.name AS to')
  .orderBy('a.name')
  .limit(10);

const { query: gql, params } = q.build();
const rows = await client.queryAll(gql, { params });
```

### Prepared Statements

```typescript
import { PreparedStatement } from '@geode/client';

// Prepare a statement once
const stmt = await client.prepare('MATCH (n:Person {name: $name}) RETURN n');

// Execute multiple times with different parameters
const alice = await stmt.executeAll({ name: 'Alice' });
const bob = await stmt.executeAll({ name: 'Bob' });

// Validate parameters without executing
stmt.validate({ name: 'Charlie' });

// Check parameter info
console.log(stmt.parameterCount); // 1
console.log(stmt.namedParameters); // ['name']

// Close when done
stmt.close();
```

### Query Explain/Profile

```typescript
import { explain, profile, formatPlan, formatProfile } from '@geode/client';

// Get query execution plan
const plan = await client.explain('MATCH (n:Person)-[:KNOWS]->(m) RETURN n, m');
console.log('Estimated cost:', plan.totalCost);
console.log('Estimated rows:', plan.totalRows);

// Format plan for display
console.log(formatPlan(plan));

// Profile actual execution
const prof = await client.profile('MATCH (n:Person) RETURN count(n)');
console.log('Execution time:', prof.totalTimeMs, 'ms');
console.log('Rows processed:', prof.totalRows);
console.log('Planning time:', prof.planningTimeMs, 'ms');
console.log('Memory used:', prof.memoryBytes, 'bytes');

// Format profile for display
console.log(formatProfile(prof));
```

### Batch Operations

```typescript
import { batch, batchMap, batchParallel } from '@geode/client';

// Execute multiple queries in a batch
const summary = await client.batch([
  { query: "CREATE (n:Person {name: 'Alice'})" },
  { query: "CREATE (n:Person {name: 'Bob'})" },
  { query: 'MATCH (n:Person) RETURN count(n) AS cnt' },
]);

console.log(`${summary.successful}/${summary.total} queries succeeded`);
console.log('Total time:', summary.totalDurationMs, 'ms');

// Stop on first error
const summary2 = await client.batch(queries, { stopOnError: true });

// Execute in a transaction (all or nothing)
const summary3 = await client.batch(queries, { transaction: true });

// Map over data
const people = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }];
await batchMap(conn, 'CREATE (n:Person {name: $name})', people);
```

### Authentication Client

```typescript
import { AuthClient } from '@geode/client';

const auth = await client.auth();

// User management
await auth.createUser('alice', { password: 'securePass123', roles: ['analyst'] });
await auth.changePassword('alice', 'newPassword456');
await auth.deactivateUser('alice');
const users = await auth.listUsers();

// Role management
await auth.createRole('analyst', {
  description: 'Data analyst role',
  permissions: [{ resource: 'NODE', action: 'READ' }],
});
await auth.assignRole('alice', 'analyst');
await auth.grantPermission('analyst', { resource: 'NODE', action: 'READ', label: 'Person' });

// Row-level security policies
await auth.createRLSPolicy(
  'tenant_isolation',
  'Document',
  'ALL',
  'n.tenant_id = current_user().tenant_id',
  { roles: ['user', 'analyst'] }
);
await auth.enableRLSPolicy('tenant_isolation', 'Document');

// Session info
const currentUser = await auth.currentUser();
const roles = await auth.currentRoles();
const canRead = await auth.hasPermission('NODE', 'READ', 'Person');
```

### Abort/Cancellation

```typescript
const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  const rows = await client.queryAll('MATCH (n) RETURN n', { signal: controller.signal });
} catch (e) {
  if (e.message.includes('Aborted')) {
    console.log('Query was cancelled');
  }
}
```

## Type System

The client provides a comprehensive GQL type system:

```typescript
import { GQLValue, fromJSON } from '@geode/client';

// Create typed values
const intVal = GQLValue.int(42);
const strVal = GQLValue.string('hello');
const arrVal = GQLValue.array([GQLValue.int(1), GQLValue.int(2)]);
const nodeVal = GQLValue.node({
  id: '123',
  labels: ['Person'],
  properties: { name: 'Alice' },
});

// Type-safe access
intVal.asNumber; // 42
intVal.asInt; // 42n (bigint)
strVal.asString; // 'hello'
arrVal.asArray; // [GQLValue, GQLValue]
nodeVal.asNode; // { id, labels, properties }

// Convert to plain JS
intVal.toJS(); // 42
nodeVal.toJS(); // { id: '123', labels: ['Person'], ... }

// Parse from JSON
const value = fromJSON({ name: 'Alice', age: 30 });
```

### Supported Types

| GQL Type   | Node.js Type  |
| ---------- | ------------- |
| INT        | number/bigint |
| FLOAT      | number        |
| DECIMAL    | Decimal       |
| STRING     | string        |
| BOOL       | boolean       |
| NULL       | null          |
| ARRAY/LIST | Array         |
| OBJECT/MAP | Object/Map    |
| NODE       | GQLNode       |
| EDGE       | GQLEdge       |
| PATH       | GQLPath       |
| BYTEA      | Uint8Array    |
| DATE       | Date          |
| TIME       | Date          |
| TIMESTAMP  | Date          |
| UUID       | string        |
| JSON/JSONB | any           |

## Error Handling

```typescript
import {
  DriverError,
  TransportError,
  ConfigError,
  SecurityError,
  isRetryableError,
} from '@geode/client';

try {
  await client.queryAll('INVALID QUERY');
} catch (e) {
  if (e instanceof DriverError) {
    console.log('Server error:', e.code, e.message);
    console.log('Status class:', e.statusClass); // ISO 39075 code

    if (isRetryableError(e)) {
      // Serialization or deadlock - can retry
    }
  } else if (e instanceof TransportError) {
    console.log('Network error:', e.operation, e.message);
  } else if (e instanceof ConfigError) {
    console.log('Configuration error:', e.field, e.message);
  } else if (e instanceof SecurityError) {
    console.log('Security error:', e.type, e.message);
  }
}
```

### ISO 39075 Status Classes

| Class | Meaning                   | Retryable |
| ----- | ------------------------- | --------- |
| 00000 | Success                   | -         |
| 01000 | Warning                   | No        |
| 02000 | No data                   | No        |
| 25000 | Invalid transaction state | No        |
| 28000 | Authorization error       | No        |
| 40001 | Serialization failure     | Yes       |
| 40502 | Transaction deadlock      | Yes       |
| 42000 | Syntax error              | No        |
| 23000 | Constraint violation      | No        |
| 58000 | System error              | No        |

## Connection Pool

```typescript
const client = await createClient('geode://localhost:3141', {
  pooling: true,
  pool: {
    min: 2, // Minimum connections to maintain
    max: 10, // Maximum connections
    acquireTimeout: 30000, // Max wait time to acquire
    idleTimeout: 60000, // Close idle connections after
  },
});

// Check pool stats
console.log(client.poolStats);
// { total: 5, available: 3, inUse: 2, waiting: 0 }
```

## Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Run integration tests (requires Docker)
npm run test:integration
```

## API Reference

### GeodeClient

| Method                            | Description                          |
| --------------------------------- | ------------------------------------ |
| `query(gql, options?)`            | Execute query, return async iterator |
| `queryAll(gql, options?)`         | Execute query, return all rows       |
| `queryFirst(gql, options?)`       | Get first row                        |
| `queryScalar(gql, col, options?)` | Get single value                     |
| `exec(gql, options?)`             | Execute statement (no results)       |
| `withTransaction(fn)`             | Execute in transaction               |
| `prepare(gql)`                    | Create prepared statement            |
| `explain(gql, options?)`          | Get query execution plan             |
| `profile(gql, options?)`          | Profile query execution              |
| `batch(queries, options?)`        | Execute multiple queries             |
| `auth()`                          | Get authentication client            |
| `ping()`                          | Check connection health              |
| `close()`                         | Close client                         |

### Connection

| Method                     | Description               |
| -------------------------- | ------------------------- |
| `query(gql, options?)`     | Execute query             |
| `exec(gql, options?)`      | Execute statement         |
| `begin()`                  | Start transaction         |
| `prepare(gql)`             | Create prepared statement |
| `explain(gql, options?)`   | Get query plan            |
| `profile(gql, options?)`   | Profile execution         |
| `batch(queries, options?)` | Execute batch             |
| `ping()`                   | Health check              |
| `reset()`                  | Reset session             |
| `close()`                  | Close connection          |

### Transaction

| Method                 | Description           |
| ---------------------- | --------------------- |
| `query(gql, options?)` | Execute query         |
| `exec(gql, options?)`  | Execute statement     |
| `savepoint(name)`      | Create savepoint      |
| `rollbackTo(name)`     | Rollback to savepoint |
| `commit()`             | Commit transaction    |
| `rollback()`           | Rollback transaction  |

### PreparedStatement

| Method                          | Description               |
| ------------------------------- | ------------------------- |
| `execute(params?, options?)`    | Execute, return iterator  |
| `executeAll(params?, options?)` | Execute, return all rows  |
| `exec(params?, options?)`       | Execute (no results)      |
| `validate(params?)`             | Validate parameters       |
| `close()`                       | Close statement           |
| `query`                         | Get query text            |
| `parameterCount`                | Get parameter count       |
| `namedParameters`               | Get named parameter names |

### AuthClient

| Method                               | Description           |
| ------------------------------------ | --------------------- |
| `createUser(name, options)`          | Create user           |
| `deleteUser(name)`                   | Delete user           |
| `getUser(name)`                      | Get user info         |
| `listUsers()`                        | List all users        |
| `changePassword(name, password)`     | Change password       |
| `activateUser(name)`                 | Activate user         |
| `deactivateUser(name)`               | Deactivate user       |
| `createRole(name, options?)`         | Create role           |
| `deleteRole(name)`                   | Delete role           |
| `assignRole(user, role)`             | Assign role to user   |
| `revokeRole(user, role)`             | Revoke role from user |
| `grantPermission(role, perm)`        | Grant permission      |
| `revokePermission(role, perm)`       | Revoke permission     |
| `createRLSPolicy(...)`               | Create RLS policy     |
| `deleteRLSPolicy(name, label)`       | Delete RLS policy     |
| `currentUser()`                      | Get current user      |
| `currentRoles()`                     | Get current roles     |
| `hasPermission(res, action, label?)` | Check permission      |

## Contributing

See [CLAUDE.md](./CLAUDE.md) for development guidelines.

```bash
# Clone repository
git clone https://gitlab.com/devnw/geode/geode-client-nodejs.git
cd geode-client-nodejs

# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## License

Apache License 2.0

## Related Projects

- [Geode Server](https://gitlab.com/devnw/geode/geode) - The Geode database server
- [Go Client](https://gitlab.com/devnw/geode/geode-client-go) - Go client library
- [Python Client](https://gitlab.com/devnw/geode/geode-client-python) - Python client library
- [Rust Client](https://gitlab.com/devnw/geode/geode-client-rust) - Rust client library
