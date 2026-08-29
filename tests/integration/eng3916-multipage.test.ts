/**
 * ENG-3916 / ENG-3918 live multi-page regression tests.
 *
 * The real Geode server PUSHES the schema and then EVERY data page as
 * `execute` responses until `final = true`
 * (`src/server/quic_connection_handler.zig:7544-7566`). The client reads a
 * single pushed page and then sends a speculative PULL, so on any result that
 * spans more than one server page the real PULL replies pile up unread on the
 * stream. The connection is then permanently out of phase: the next query on it
 * fails with "Invalid execute response" / "Expected schema response", and a
 * pooled connection in that state is handed to the next caller unchanged.
 *
 * These tests need a live server. Start one with:
 *
 *   GEODE_ADMIN_PASSWORD='GeodeTestPassword123!' \
 *     geode serve --listen 127.0.0.1:31499 --data-dir <tmp>
 *
 *   GEODE_PORT=31499 GEODE_USERNAME=geode GEODE_PASSWORD='GeodeTestPassword123!' \
 *     npx vitest run --config vitest.integration.config.ts \
 *       tests/integration/eng3916-multipage.test.ts
 *
 * (`--no-auth` does NOT work with this client: authenticate with real
 * credentials.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Connection } from '../../src/connection.js';
import { parseDSN } from '../../src/config.js';

const HOST = process.env['GEODE_HOST'] ?? '127.0.0.1';
const PORT = process.env['GEODE_PORT'] ?? '3141';
// parseDSN pulls GEODE_USERNAME / GEODE_PASSWORD out of the environment.
const DSN = `quic://${HOST}:${PORT}?insecure=true`;

/** Enough rows to span several server-pushed pages. */
const NODE_COUNT = 1200;
const BATCH = 100;
const LABEL = 'Eng3916Page';

const explicitConfig = ['GEODE_HOST', 'GEODE_PORT', 'GEODE_USERNAME', 'GEODE_PASSWORD'].some((k) =>
  Boolean(process.env[k])
);

let available = false;

const connect = (): Promise<Connection> => Connection.connect(parseDSN(DSN));

beforeAll(async () => {
  let conn: Connection | null = null;
  try {
    conn = await connect();
    await conn.ping();
    available = true;
  } catch (e) {
    if (conn) await conn.close().catch(() => undefined);
    if (explicitConfig) {
      throw e;
    }
    console.warn(`Skipping ENG-3916 multi-page integration tests: no server at ${HOST}:${PORT}`);
    return;
  }

  try {
    await conn.exec(`MATCH (n:${LABEL}) DETACH DELETE n`);
    for (let i = 0; i < NODE_COUNT; i += BATCH) {
      const parts: string[] = [];
      for (let j = 0; j < BATCH; j++) {
        parts.push(`(:${LABEL} {i: ${i + j}})`);
      }
      await conn.exec(`CREATE ${parts.join(', ')}`);
    }
    const counted = await conn.queryAll(`MATCH (n:${LABEL}) RETURN count(n) AS c`);
    expect(Number(counted[0]?.['c'])).toBe(NODE_COUNT);
  } finally {
    await conn.close();
  }
}, 180000);

afterAll(async () => {
  if (!available) return;
  const conn = await connect();
  try {
    await conn.exec(`MATCH (n:${LABEL}) DETACH DELETE n`);
  } catch {
    // best-effort cleanup
  } finally {
    await conn.close();
  }
}, 60000);

describe('ENG-3916 live: multi-page results', () => {
  // Control: today the speculative PULL loop still collects every row (it just
  // desyncs the connection doing it, see the next two tests). Row completeness
  // must survive the fix that stops the speculative PULL.
  it('returns every row of a 1200-node result [control]', async () => {
    if (!available) return;
    const conn = await connect();
    try {
      const rows = await conn.queryAll(`MATCH (n:${LABEL}) RETURN n.i AS i`);
      expect(rows).toHaveLength(NODE_COUNT);
    } finally {
      await conn.close();
    }
  }, 120000);

  // Regression: after the multi-page read the connection is one or more
  // exchanges out of phase, so the NEXT query on it fails or, worse, receives
  // the previous query's rows.
  it('keeps the connection healthy for the next query [regression]', async () => {
    if (!available) return;
    const conn = await connect();
    try {
      const rows = await conn.queryAll(`MATCH (n:${LABEL}) RETURN n.i AS i`);
      expect(rows).toHaveLength(NODE_COUNT);

      const ok = await conn.queryAll('RETURN 1 AS ok');
      expect(Object.keys(ok[0] ?? {})).toEqual(['ok']);
      expect(Number(ok[0]?.['ok'])).toBe(1);
    } finally {
      await conn.close();
    }
  }, 120000);

  // Regression (ENG-3918 "Expected schema response"): abandoning a multi-page
  // result after the first row leaves the remaining pushed pages undrained.
  it('recovers after a multi-page result is abandoned via first() [regression]', async () => {
    if (!available) return;
    const conn = await connect();
    try {
      const result = await conn.query(`MATCH (n:${LABEL}) RETURN n.i AS i`);
      const first = await result.first();
      expect(first).not.toBeNull();
      result.close();

      const ok = await conn.queryAll('RETURN 1 AS ok');
      expect(Object.keys(ok[0] ?? {})).toEqual(['ok']);
      expect(Number(ok[0]?.['ok'])).toBe(1);
    } finally {
      await conn.close();
    }
  }, 120000);
});
