/**
 * Tripwire scanner shared by the Node test suite and the example Jest test.
 *
 * Two rules the sample app must never break:
 *
 *  1. **RN-SEC3 / KICKOFF §7** — the app never reads `UQPAY_API_KEY`. The key
 *     lives only in `example/backend/`. A merchant who copies this app must
 *     not find a pattern that puts their merchant credential on a phone.
 *  2. **RN-FLOW4** — the app never calls the UQPAY API host directly. Every
 *     network call goes to the merchant backend, so "the wrapper performs no
 *     polling of its own" stays true and observable.
 *
 * Plus a logging rule for the backend: no `console.log` of an `apiKey` /
 * `authToken` / `x-api-key` expression.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'Pods', '__snapshots__', 'coverage']);
const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/;

/**
 * Lists candidate source files under `root`.
 *
 * @param {string} root
 * @param {(relativePath: string) => boolean} [accept]
 * @returns {string[]} absolute paths
 */
export function listSourceFiles(root, accept = () => true) {
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && TEXT_EXTENSIONS.test(entry.name)) {
        const rel = relative(root, full).split(sep).join('/');
        if (accept(rel)) out.push(full);
      }
    }
  };
  if (statSync(root, { throwIfNoEntry: false })) walk(root);
  return out;
}

/**
 * @typedef {{ file: string, line: number, text: string, rule: string }} Violation
 */

/**
 * @param {string[]} files
 * @param {{ pattern: RegExp, rule: string }[]} rules
 * @param {string} root
 * @returns {Violation[]}
 */
export function scanFiles(files, rules, root) {
  /** @type {Violation[]} */
  const violations = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
      // A line may opt out with an explicit, searchable justification.
      if (text.includes('uqpay-tripwire-allow')) return;
      for (const { pattern, rule } of rules) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          violations.push({
            file: relative(root, file).split(sep).join('/'),
            line: index + 1,
            text: text.trim().slice(0, 160),
            rule,
          });
        }
      }
    });
  }
  return violations;
}

/** Rules for the app side: `example/src` + `example/scripts`. */
export const APP_RULES = [
  { pattern: /UQPAY_API_KEY/, rule: 'RN-SEC3: the app must never reference UQPAY_API_KEY' },
  { pattern: /\bx-api-key\b/i, rule: 'RN-SEC3: the app must never send x-api-key' },
  {
    pattern: /api-sandbox\.uqpaytech\.com|\bapi\.uqpay\.com\b/,
    rule: 'RN-FLOW4: the app must only call the merchant backend, never the UQPAY API host',
  },
];

/** Rules for the backend side: it holds the key, but must never print it. */
export const BACKEND_RULES = [
  {
    pattern: /console\.(log|info|warn|error|debug)\s*\([^)]*\b(apiKey|authToken|auth_token|x-api-key|API_KEY)\b/i,
    rule: 'the backend must never console.log an api key or auth token',
  },
];

/**
 * Scans the example app sources: everything under `example/src` plus the
 * build-time scripts (`example/scripts`).
 *
 * This file is excluded from its own scan — it is where the forbidden strings
 * are *defined*, and it never ships in the app bundle.
 *
 * @param {string} exampleDir absolute path to `example/`
 * @returns {Violation[]}
 */
export function scanAppSources(exampleDir) {
  const files = [
    ...listSourceFiles(join(exampleDir, 'src'), (rel) => !rel.includes('__tests__')),
    ...listSourceFiles(join(exampleDir, 'scripts'), (rel) => rel !== 'scan-secrets.mjs'),
  ];
  return scanFiles(files, APP_RULES, exampleDir);
}

/**
 * Scans the reference backend sources (`example/backend`), tests excluded.
 *
 * @param {string} exampleDir absolute path to `example/`
 * @returns {Violation[]}
 */
export function scanBackendSources(exampleDir) {
  const files = listSourceFiles(join(exampleDir, 'backend'), (rel) => !rel.startsWith('test/'));
  return scanFiles(files, BACKEND_RULES, exampleDir);
}

/** @param {Violation[]} violations */
export function formatViolations(violations) {
  return violations.map((v) => `  ${v.file}:${v.line}  ${v.rule}\n      ${v.text}`).join('\n');
}
