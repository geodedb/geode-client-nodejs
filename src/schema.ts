/**
 * Schema Loading
 *
 * Ports geode-client-go schema.go: read .gql files from a directory and turn
 * them into Statements suitable for batchExec / pipelineExec.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A GQL query paired with optional bound parameters. */
export interface Statement {
  query: string;
  params?: Record<string, unknown>;
}

const KEYWORDS = ['CREATE', 'MERGE', 'MATCH', 'DELETE'];

/**
 * Read all direct-child `.gql` files from `dir` and return Statements.
 *
 * Subdirectories are not traversed. Lines are split into statements at
 * semicolons after stripping blank lines, line comments (`//` and `--`), and
 * lines that do not start with a recognised GQL keyword.
 */
export async function parseSchemaFS(dir: string): Promise<Statement[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const stmts: Statement[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() || !entry.name.endsWith('.gql')) {
      continue;
    }
    const content = await readFile(join(dir, entry.name), 'utf8');
    for (const rawLine of content.split('\n')) {
      const trimmed = rawLine.trim();
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('--')) {
        continue;
      }
      const upper = trimmed.toUpperCase();
      if (!KEYWORDS.some((kw) => upper.startsWith(kw))) {
        continue;
      }
      for (const part of trimmed.split(';')) {
        const p = part.trim();
        if (p !== '') {
          stmts.push({ query: p });
        }
      }
    }
  }

  return stmts;
}
