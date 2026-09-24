#!/usr/bin/env node
/**
 * Regenerate the TypeDoc API reference into a scratch directory and diff it
 * against the checked-in `docs/api/` (AC RN-DOC2). Exits non-zero — printing
 * every path that differs — when the committed docs have drifted from what
 * `typedoc.json` would produce today, so a stale `docs/api/` fails CI instead
 * of silently shipping.
 *
 * Uses a fresh OS temp directory per run (never a path inside the repo), so
 * this is safe to run concurrently with other scripts and never touches
 * `docs/api/` itself.
 */

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const committedDir = join(root, 'docs', 'api');
const typedocBin = join(root, 'node_modules', '.bin', 'typedoc');

/** Every file path under `dir`, relative to `dir`, sorted, forward-slashed. */
function listFiles(dir) {
  const out = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push(relative(dir, full).split('\\').join('/'));
      }
    }
  }
  if (statSync(dir, { throwIfNoEntry: false }) !== undefined) walk(dir);
  return out.sort();
}

function main() {
  const scratchDir = mkdtempSync(join(tmpdir(), 'uqpay-docs-api-check-'));
  try {
    execFileSync(typedocBin, ['--out', scratchDir], {
      cwd: root,
      stdio: 'inherit',
    });

    const committedFiles = listFiles(committedDir);
    const freshFiles = listFiles(scratchDir);

    const drift = [];

    const committedSet = new Set(committedFiles);
    const freshSet = new Set(freshFiles);

    for (const path of freshFiles) {
      if (!committedSet.has(path)) drift.push(`only in fresh output: ${path}`);
    }
    for (const path of committedFiles) {
      if (!freshSet.has(path)) drift.push(`only in docs/api: ${path}`);
    }
    for (const path of committedFiles) {
      if (!freshSet.has(path)) continue;
      const committedContent = readFileSync(join(committedDir, path));
      const freshContent = readFileSync(join(scratchDir, path));
      if (!committedContent.equals(freshContent)) {
        drift.push(`content differs: ${path}`);
      }
    }

    if (drift.length > 0) {
      console.error(
        'docs/api is out of date. Run `yarn docs:api` and commit the result.\n'
      );
      for (const line of drift) console.error(`  - ${line}`);
      process.exitCode = 1;
      return;
    }

    console.log('docs/api matches a fresh `typedoc` run.');
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

main();
