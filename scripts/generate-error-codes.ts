/**
 * `yarn errors:generate` — render `ERROR_CODES.md` from `src/errors/table.ts`.
 * Idempotent: a second run writes the same bytes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTPUT_PATHS, renderErrorCodesDoc } from './render.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function writeIfChanged(relativePath: string, contents: string): boolean {
  const target = join(ROOT, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  let current: string | null = null;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = null;
  }
  if (current === contents) {
    process.stdout.write(`unchanged  ${relativePath}\n`);
    return false;
  }
  writeFileSync(target, contents, 'utf8');
  process.stdout.write(`written    ${relativePath}\n`);
  return true;
}

writeIfChanged(OUTPUT_PATHS.errorCodesDoc, renderErrorCodesDoc());
