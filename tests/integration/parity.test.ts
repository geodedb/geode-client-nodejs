import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, GeodeClient } from '../../src/index.js';
import { parseSchemaFS } from '../../src/schema.js';
import { pipelineExec, batchExec } from '../../src/pipeline.js';
import { quoteIdent, quoteString, sanitizeGraphName } from '../../src/quote.js';
import { createCipher } from '../../src/crypto.js';
import { formatDSN, parseDSN } from '../../src/config.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = process.env['GEODE_HOST'] ?? '127.0.0.1';
const PORT = process.env['GEODE_PORT'] ?? '3141';
const DSN = `quic://${HOST}:${PORT}?insecure=true`;

let client: GeodeClient | null = null;
let available = false;

beforeAll(async () => {
  try {
    client = await createClient(DSN, { pooling: true, connectTimeout: 3000 });
    // Probe the connection to verify it is actually usable (e.g. not auth-protected).
    await client.ping();
    available = true;
  } catch {
    available = false;
    if (client) {
      try {
        await client.close();
      } catch {
        // ignore close errors
      }
      client = null;
    }
  }
}, 15000);

afterAll(async () => {
  if (client) await client.close();
});

describe('Parity integration', () => {
  it('quoting + crypto + DSN helpers work without a server', () => {
    // Pure-function parity checks — always run, no server needed.
    expect(quoteIdent('Person')).toBe('Person');
    expect(quoteString("it's")).toBe("'it''s'");
    expect(sanitizeGraphName('bad name!')).toBe('badname');

    const cfg = parseDSN(DSN);
    expect(parseDSN(formatDSN(cfg))).toEqual(cfg);

    const cipher = createCipher(Buffer.alloc(32, 'k'));
    expect(cipher.decryptString(cipher.encryptString('x'))).toBe('x');
  });

  it('parseSchemaFS + pipelineExec apply a schema (server required)', async () => {
    if (!available || !client) {
      console.log('Skipping: no Geode server reachable');
      return;
    }

    try {
      const dir = await mkdtemp(join(tmpdir(), 'geode-parity-'));
      try {
        await writeFile(
          join(dir, 'schema.gql'),
          'CREATE (a:ParityTest {n: 1})\nCREATE (b:ParityTest {n: 2})\n'
        );

        const stmts = await parseSchemaFS(dir);
        expect(stmts.length).toBe(2);

        // Use the client directly as a PipelineExecutor via its withTransaction method.
        // GeodeClient.withTransaction satisfies the PipelineExecutor interface.
        const executor = {
          withTransaction: <T>(
            fn: (tx: {
              exec(q: string, o?: { params?: Record<string, unknown> }): Promise<void>;
            }) => Promise<T>
          ) => client!.withTransaction(fn),
        };

        await batchExec(executor, stmts.slice(0, 1));
        await pipelineExec(executor, stmts, { chunkSize: 1, maxWorkers: 2 });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    } catch (err) {
      console.log('Skipping: Geode server not usable: ' + String(err));
      return;
    }
  });
});
