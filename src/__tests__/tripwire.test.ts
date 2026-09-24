/**
 * Source tripwire (AC RN-FLOW3, RN-FLOW5, RN-TEST7, RN-SEC4, RN-SEC6).
 *
 * The JS layer must never do arithmetic on amounts, read the wall clock, set
 * timers, point at plain-HTTP endpoints or log to the console. Rather than
 * relying on reviewers, this test scans every file under `src/` (excluding
 * `__tests__`) and fails on the first forbidden token it finds.
 */
import { describe, expect, it } from '@jest/globals';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const SRC_DIR = join(__dirname, '..');
const REPO_ROOT = join(SRC_DIR, '..');

/** Forbidden tokens and the AC row each one protects. */
const FORBIDDEN: ReadonlyArray<{ token: string; reason: string }> = [
  {
    token: 'parseFloat',
    reason: 'RN-FLOW5: amounts are strings, never parsed',
  },
  { token: 'Number(', reason: 'RN-FLOW5: amounts are strings, never coerced' },
  { token: '* 100', reason: 'RN-FLOW5: no minor-unit scaling in JS' },
  { token: '/ 100', reason: 'RN-FLOW5: no minor-unit scaling in JS' },
  { token: 'Date.now', reason: 'RN-TEST7 / RN-FLOW3: no wall-clock reads' },
  { token: 'setTimeout', reason: 'RN-TEST7 / RN-FLOW3: no JS timers' },
  { token: 'setInterval', reason: 'RN-TEST7 / RN-FLOW3: no JS timers' },
  { token: 'http://', reason: 'RN-SEC4: HTTPS only' },
  { token: 'console.log', reason: 'RN-SEC6: no console logging in the SDK' },
];

/**
 * `Platform.OS` is allowed in exactly two places: `platform.ts`, which is the
 * SDK's single platform branch, and the published Jest mock, which has to
 * pretend to be one platform or the other. Anywhere else it would mean a
 * platform-specific public API, which AC RN-API11 forbids.
 */
const PLATFORM_OS_ALLOWED = new Set(['platform.ts', 'jest/index.ts']);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') {
        out.push(...listSourceFiles(full));
      }
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('source tripwire', () => {
  const files = listSourceFiles(SRC_DIR);

  it('scans at least one source file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [relative(SRC_DIR, file), file]))(
    '%s contains no forbidden token',
    (_label, file) => {
      const text = readFileSync(file, 'utf8');
      const hits = FORBIDDEN.filter(({ token }) => text.includes(token)).map(
        ({ token, reason }) => `${token} (${reason})`
      );
      expect(hits).toEqual([]);
    }
  );

  it.each(files.map((file) => [relative(SRC_DIR, file), file]))(
    '%s reads Platform.OS only where AC RN-API11 allows it',
    (label, file) => {
      const normalised = label.split(sep).join('/');
      if (PLATFORM_OS_ALLOWED.has(normalised)) return;
      expect(readFileSync(file, 'utf8')).not.toContain('Platform.OS');
    }
  );

  it('keeps the allow-list honest: every allowed file exists and uses Platform.OS', () => {
    const labels = files.map((file) =>
      relative(SRC_DIR, file).split(sep).join('/')
    );
    for (const allowed of PLATFORM_OS_ALLOWED) {
      expect(labels).toContain(allowed);
    }
  });
});

// ---------------------------------------------------------------------------
// Metro vs. TypeScript module resolution (P0 issues.md #7).
//
// Metro's default `resolver.sourceExts` is `js, jsx, json, ts, tsx`
// (`metro-config/src/defaults/defaults.js`): **json sorts before ts**.
// TypeScript, api-extractor and Jest (`moduleFileExtensions`) all try `.ts`
// first. So an extensionless relative import next to a generated `*.json` of
// the same basename type-checks and unit-tests against the `.ts` module while
// the device bundles the JSON — every exported function silently becomes
// `undefined`, and the first call is a bare `TypeError: undefined is not a
// function` with no `.code`.
//
// That is exactly what `src/errors/mapper.ts`'s `from './table'` did against
// the generated `src/errors/table.json` (now `error-table.json`). This scan
// fails on any recurrence, in the package and in both sample apps.
// ---------------------------------------------------------------------------

/** Metro's default resolution order. */
const METRO_EXTS = ['js', 'jsx', 'json', 'ts', 'tsx'] as const;
/** TypeScript's / Jest's order — what `yarn typecheck` and `yarn test` see. */
const TS_EXTS = ['ts', 'tsx', 'js', 'jsx', 'json'] as const;

/** Every relative specifier a module imports or requires, extension or not. */
function relativeSpecifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s+['"](\.[^'"]*)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g,
    /\brequire\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g,
    /\bjest\.mock\s*\(\s*['"](\.[^'"]*)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) out.push(specifier);
    }
  }
  return out;
}

/** The file an extension list resolves `base` to, trying `base/index` too. */
function resolveWith(
  base: string,
  exts: ReadonlyArray<string>
): string | undefined {
  for (const ext of exts) {
    const candidate = `${base}.${ext}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  if (existsSync(base) && statSync(base).isDirectory()) {
    return resolveWith(join(base, 'index'), exts);
  }
  return undefined;
}

const SCANNED_ROOTS = [
  SRC_DIR,
  join(REPO_ROOT, 'example', 'src'),
  join(REPO_ROOT, 'example-expo', 'src'),
].filter((dir) => existsSync(dir));

describe('Metro and TypeScript resolve every relative import to the same file', () => {
  const files = SCANNED_ROOTS.flatMap((root) => listSourceFiles(root));

  it('scans the package and both sample apps', () => {
    expect(SCANNED_ROOTS.length).toBeGreaterThan(1);
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [relative(REPO_ROOT, file), file]))(
    '%s has no shadowed import',
    (_label, file) => {
      const disagreements: string[] = [];
      for (const specifier of relativeSpecifiers(readFileSync(file, 'utf8'))) {
        // An explicit extension is unambiguous for both resolvers.
        if (/\.(ts|tsx|js|jsx|json|mjs|cjs|node)$/.test(specifier)) continue;
        const base = join(dirname(file), specifier);
        const metro = resolveWith(base, METRO_EXTS);
        const typescript = resolveWith(base, TS_EXTS);
        if (metro === undefined || typescript === undefined) continue;
        if (metro !== typescript) {
          disagreements.push(
            `"${specifier}" -> Metro picks ${relative(REPO_ROOT, metro)}, ` +
              `TypeScript/Jest pick ${relative(REPO_ROOT, typescript)}`
          );
        }
      }
      expect(disagreements).toEqual([]);
    }
  );
});
