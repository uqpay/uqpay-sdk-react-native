/**
 * `yarn errors:sync` — write the machine-readable fixtures the native test
 * suites read (AC RN-PAR1, RN-PAR3).
 *
 * This is the one place the JS layer writes into `ios/` and `android/`: both
 * bridges assert against exactly these files, so the three implementations
 * cannot drift. Idempotent: a second run writes the same bytes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OUTPUT_PATHS,
  renderErrorTableJson,
  renderScenariosJson,
} from './render.ts';

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

const errorTable = renderErrorTableJson();
const scenarios = renderScenariosJson();

writeIfChanged(OUTPUT_PATHS.errorTableJson, errorTable);
for (const dir of [
  OUTPUT_PATHS.iosFixtureDir,
  OUTPUT_PATHS.androidFixtureDir,
]) {
  writeIfChanged(join(dir, OUTPUT_PATHS.errorTableFixture), errorTable);
  writeIfChanged(join(dir, OUTPUT_PATHS.scenariosFixture), scenarios);
}
