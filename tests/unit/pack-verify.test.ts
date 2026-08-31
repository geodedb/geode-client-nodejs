/**
 * Packaging regression guard: the published tarball MUST contain dist/.
 *
 * Bug (observed on v1.3.1): package.json declares `files: ["dist", ...]` and
 * points main/module/types/exports at dist/index.js + dist/index.d.ts, but
 * dist/ is gitignored (.gitignore:9) and the ONLY build lifecycle hook is
 * `prepublishOnly`. npm runs `prepublishOnly` for `npm publish` but NOT for
 * `npm pack` (nor for `npm publish <tarball>`), so any packaging path that goes
 * through `npm pack` from a clean checkout emits a 4-file tarball
 * (LICENSE, README.md, package.json, proto/geode.proto) with no dist/ at all.
 * Installing that tarball fails at import time with
 * ERR_MODULE_NOT_FOUND for .../dist/index.js.
 *
 * WHY A CLEAN TREE IS REQUIRED: in a developer checkout dist/ usually exists
 * from a previous `npm run build`, and `npm pack` happily picks it up -- which
 * MASKS the defect entirely. So this test never packs the working directory.
 * It materializes a temp tree containing exactly the git-TRACKED files (via
 * `git ls-files`), which is byte-for-byte what a fresh `git clone` would give
 * you: no dist/, no coverage/, no node_modules/. Working-tree edits to tracked
 * files ARE reflected, so the fixer can validate a package.json change before
 * committing it. (A brand-new file must be `git add`ed to be seen here.)
 *
 * node_modules is symlinked from the repo rather than installed, so the test
 * needs no network and stays fast (~1s red / ~8s green once the build runs).
 *
 * Expected: RED before the fix, GREEN once a pack-time build hook (`prepack`)
 * is added.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __test_dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__test_dirname, '..', '..');

/** Files the package's own entry points promise a consumer will find. */
const REQUIRED_TARBALL_FILES = ['package/dist/index.js', 'package/dist/index.d.ts'];

interface PackJsonEntry {
  filename: string;
  entryCount: number;
  files: { path: string; size: number }[];
}

interface PackResult {
  /** Root of the simulated clean checkout that was packed. */
  cleanTree: string;
  /** Absolute path to the produced .tgz. */
  tarball: string;
  /** Paths as npm itself reports them (relative to the package root). */
  npmFileList: string[];
  /** Directory the tarball was extracted into; entries live under `package/`. */
  extractDir: string;
  /** Entry paths present in the extracted tarball, e.g. `package/dist/index.js`. */
  tarballEntries: string[];
}

function requireTool(bin: string, args: string[]): void {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
  } catch {
    throw new Error(
      `pack-verify requires \`${bin}\` on PATH (environment problem, not a packaging defect)`
    );
  }
}

/** Copy every git-tracked file into `dest`, reproducing a fresh-clone layout. */
function materializeCleanCheckout(dest: string): number {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter((p) => p.length > 0);

  let copied = 0;
  for (const rel of tracked) {
    const src = path.join(PROJECT_DIR, rel);
    if (!existsSync(src)) continue; // tracked-but-deleted in the working tree
    const dst = path.join(dest, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    copied += 1;
  }
  return copied;
}

/**
 * Pull npm's `--json` array out of stdout.
 *
 * A pack-time build hook (tsup) writes its own progress banner to STDOUT ahead
 * of npm's JSON, so `JSON.parse(stdout)` is not safe: scan candidate `[`
 * offsets and keep the first slice that parses into npm's pack manifest.
 */
function parsePackJson(stdout: string): PackJsonEntry[] {
  const end = stdout.lastIndexOf(']');
  for (let i = stdout.indexOf('['); i !== -1 && i < end; i = stdout.indexOf('[', i + 1)) {
    try {
      const candidate: unknown = JSON.parse(stdout.slice(i, end + 1));
      if (
        Array.isArray(candidate) &&
        candidate.length > 0 &&
        typeof (candidate[0] as PackJsonEntry).filename === 'string'
      ) {
        return candidate as PackJsonEntry[];
      }
    } catch {
      // keep scanning
    }
  }
  throw new Error(`could not parse \`npm pack --json\` output:\n${stdout.slice(0, 600)}`);
}

/** Recursively list files under `root`, as `/`-joined paths relative to it. */
function listFiles(root: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(root, rel));
    else out.push(rel);
  }
  return out;
}

/** Temp roots created by this file; drained in afterAll even on setup failure. */
const scratchRoots: string[] = [];

function packFromCleanCheckout(): PackResult {
  requireTool('git', ['--version']);
  requireTool('npm', ['--version']);
  requireTool('tar', ['--version']);

  const workdir = mkdtempSync(path.join(os.tmpdir(), 'geode-pack-verify-'));
  scratchRoots.push(workdir);
  const cleanTree = path.join(workdir, 'tree');
  const outDir = path.join(workdir, 'out');
  const extractDir = path.join(workdir, 'extract');
  mkdirSync(cleanTree, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

  const copied = materializeCleanCheckout(cleanTree);
  if (copied === 0) throw new Error('materialized clean checkout is empty (git ls-files failed?)');
  if (existsSync(path.join(cleanTree, 'dist'))) {
    throw new Error(
      'clean checkout unexpectedly contains dist/ -- it must be gitignored for this guard to be meaningful'
    );
  }

  // Reuse installed dependencies instead of `npm ci`: offline + fast. A
  // pack-time build hook resolves tsup/typescript through this symlink.
  symlinkSync(path.join(PROJECT_DIR, 'node_modules'), path.join(cleanTree, 'node_modules'), 'dir');

  const stdout = execFileSync('npm', ['pack', '--json', '--pack-destination', outDir], {
    cwd: cleanTree,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
    timeout: 100_000,
    env: { ...process.env, NO_COLOR: '1', npm_config_loglevel: 'error' },
  });

  const meta = parsePackJson(stdout)[0];
  const tarball = path.join(outDir, meta.filename);
  if (!existsSync(tarball)) throw new Error(`npm pack reported ${meta.filename} but it is absent`);

  execFileSync('tar', ['-xzf', tarball, '-C', extractDir], { stdio: 'ignore' });

  return {
    cleanTree,
    tarball,
    npmFileList: meta.files.map((f) => f.path),
    extractDir,
    tarballEntries: listFiles(extractDir),
  };
}

describe('npm pack tarball completeness', () => {
  let result: PackResult;

  beforeAll(() => {
    result = packFromCleanCheckout();
  }, 120_000);

  afterAll(() => {
    while (scratchRoots.length > 0) {
      rmSync(scratchRoots.pop() as string, { recursive: true, force: true });
    }
  });

  // Regression: the exact v1.3.1 defect -- pack from a clean checkout drops dist/.
  it('includes the built dist/ entry points in the tarball (regression: v1.3.1 dist-less tarball)', () => {
    expect(result.tarballEntries).toEqual(expect.arrayContaining(REQUIRED_TARBALL_FILES));
  });

  it("npm's own pack manifest lists dist/index.js and dist/index.d.ts", () => {
    expect(result.npmFileList).toEqual(
      expect.arrayContaining(['dist/index.js', 'dist/index.d.ts'])
    );
  });

  // A consumer resolving the package must find every advertised entry point;
  // a missing one is the ERR_MODULE_NOT_FOUND failure mode reported downstream.
  it('every entry point declared in package.json resolves inside the tarball', () => {
    const pkg = JSON.parse(readFileSync(path.join(PROJECT_DIR, 'package.json'), 'utf8')) as {
      main?: string;
      module?: string;
      types?: string;
      exports?: Record<string, Record<string, string>>;
    };

    const declared = new Set<string>();
    for (const field of [pkg.main, pkg.module, pkg.types]) {
      if (typeof field === 'string') declared.add(field);
    }
    for (const subpath of Object.values(pkg.exports ?? {})) {
      for (const target of Object.values(subpath)) {
        if (typeof target === 'string') declared.add(target);
      }
    }
    expect(declared.size).toBeGreaterThan(0);

    const missing = [...declared].filter(
      (target) => !existsSync(path.join(result.extractDir, 'package', target.replace(/^\.\//, '')))
    );
    expect(missing).toEqual([]);
  });

  // Root cause pin: `prepublishOnly` alone does not cover `npm pack`.
  it('declares a build hook that npm runs for pack, not just for publish', () => {
    const scripts = (
      JSON.parse(readFileSync(path.join(PROJECT_DIR, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      }
    ).scripts;
    const packTimeHook = scripts?.prepack ?? scripts?.prepare ?? '<no prepack/prepare script>';
    expect(packTimeHook, 'package.json needs a `prepack` (or `prepare`) hook that builds').toMatch(
      /build/
    );
  });
});
