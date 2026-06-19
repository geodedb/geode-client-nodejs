import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSchemaFS } from '../../src/schema.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'geode-schema-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseSchemaFS', () => {
  it('returns no statements for an empty directory', async () => {
    expect(await parseSchemaFS(dir)).toEqual([]);
  });

  it('rejects on a non-existent directory', async () => {
    await expect(parseSchemaFS(join(dir, 'nope'))).rejects.toThrow();
  });

  it('ignores non-.gql files', async () => {
    await writeFile(join(dir, 'schema.sql'), 'CREATE TABLE t (id INT)');
    await writeFile(join(dir, 'notes.txt'), 'CREATE notes');
    expect(await parseSchemaFS(dir)).toEqual([]);
  });

  it('parses one statement per line', async () => {
    await writeFile(
      join(dir, '01_nodes.gql'),
      'CREATE NODE TYPE Person (name STRING)\nCREATE NODE TYPE Company (name STRING)\n'
    );
    const stmts = await parseSchemaFS(dir);
    expect(stmts).toEqual([
      { query: 'CREATE NODE TYPE Person (name STRING)' },
      { query: 'CREATE NODE TYPE Company (name STRING)' },
    ]);
  });

  it('strips comments and non-GQL lines', async () => {
    await writeFile(
      join(dir, 'a.gql'),
      '// a comment\n-- sql comment\n\nSET x = 1\nMATCH (n) RETURN n\nMERGE (m)\nDELETE n\n'
    );
    const stmts = await parseSchemaFS(dir);
    expect(stmts.map((s) => s.query)).toEqual(['MATCH (n) RETURN n', 'MERGE (m)', 'DELETE n']);
  });

  it('splits multiple statements on a single line at semicolons', async () => {
    await writeFile(join(dir, 'b.gql'), 'CREATE (a); CREATE (b);\n');
    const stmts = await parseSchemaFS(dir);
    expect(stmts.map((s) => s.query)).toEqual(['CREATE (a)', 'CREATE (b)']);
  });

  it('only reads direct children, not subdirectories', async () => {
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'nested.gql'), 'CREATE (x)');
    await writeFile(join(dir, 'top.gql'), 'CREATE (y)');
    const stmts = await parseSchemaFS(dir);
    expect(stmts.map((s) => s.query)).toEqual(['CREATE (y)']);
  });
});
