/**
 * Drift guard for the protobuf bindings.
 *
 * 1. The vendored proto (proto/geode.proto) must match the canonical geode
 *    server proto when the sibling server repo is present. Skips gracefully
 *    (CI without the server repo) when canonical is absent.
 * 2. The committed generated bindings (src/generated/geode.ts) must exist and
 *    expose the QuicClientMessage / QuicServerMessage codecs the client relies
 *    on -- a cheap structural check that the generation step was run.
 *
 * A full byte-for-byte staleness check (regenerate to a temp file and diff) is
 * provided by the `npm run proto:check` script, which is CI-safe (no network,
 * no server) but requires protoc; this test keeps the unit suite offline-safe.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __test_dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__test_dirname, '..', '..');
const VENDORED_PROTO = path.join(PROJECT_DIR, 'proto', 'geode.proto');
const CANONICAL_PROTO = path.resolve(PROJECT_DIR, '..', 'geode', 'src', 'proto', 'geode.proto');
const GENERATED = path.join(PROJECT_DIR, 'src', 'generated', 'geode.ts');

describe('proto drift guard', () => {
  it('vendored proto matches canonical (skips if canonical absent)', (ctx) => {
    if (!existsSync(CANONICAL_PROTO)) {
      ctx.skip();
      return;
    }
    const vendored = readFileSync(VENDORED_PROTO, 'utf8');
    const canonical = readFileSync(CANONICAL_PROTO, 'utf8');
    expect(vendored).toBe(canonical);
  });

  it('canonical backup fields are present in the vendored proto', (ctx) => {
    if (!existsSync(CANONICAL_PROTO)) {
      ctx.skip();
      return;
    }
    const vendored = readFileSync(VENDORED_PROTO, 'utf8');
    // GAP-0880 fields that were previously missing from the vendored copy.
    expect(vendored).toContain('bytes payload = 4;');
    expect(vendored).toMatch(/UploadBackupRequest[\s\S]*string session_id = 3;/);
  });

  it('generated bindings exist and expose the wire codecs', () => {
    expect(existsSync(GENERATED)).toBe(true);
    const gen = readFileSync(GENERATED, 'utf8');
    expect(gen).toContain('export const QuicClientMessage');
    expect(gen).toContain('export const QuicServerMessage');
    expect(gen).toContain('DO NOT EDIT');
  });
});
