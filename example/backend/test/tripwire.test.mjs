/**
 * Tripwires. These fail the build rather than a code review.
 *
 * AC rows: RN-SEC3 (no API key in the app), RN-FLOW4 (no direct UQPAY call
 * from the app), plus the "never log a credential" rule for the backend.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  scanAppSources,
  scanBackendSources,
  scanFiles,
  listSourceFiles,
  formatViolations,
  APP_RULES,
} from '../../scripts/scan-secrets.mjs';

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('tripwires', () => {
  test('RN-SEC3: no file under example/src or example/scripts mentions UQPAY_API_KEY', () => {
    const violations = scanAppSources(EXAMPLE_DIR);
    assert.equal(
      violations.length,
      0,
      `the sample app must never touch the API key or the UQPAY host:\n${formatViolations(violations)}`
    );
  });

  test('RN-FLOW4: the app never names the UQPAY API host', () => {
    const files = listSourceFiles(join(EXAMPLE_DIR, 'src'), (rel) => !rel.includes('__tests__'));
    assert.ok(files.length > 0, 'the scanner actually found the app sources');
    const violations = scanFiles(files, APP_RULES.slice(2), EXAMPLE_DIR);
    assert.equal(violations.length, 0, formatViolations(violations));
  });

  test('the backend never console.logs an api key or auth token', () => {
    const violations = scanBackendSources(EXAMPLE_DIR);
    assert.equal(violations.length, 0, formatViolations(violations));
  });

  test('the scanner actually catches a violation (meta-test)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uqpay-tripwire-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'bad.ts'),
      ['export const key = process.env.UQPAY_API_KEY;', "fetch('https://api.uqpay.com/x');"].join('\n')
    );
    const violations = scanAppSources(dir);
    assert.ok(violations.length >= 2, 'both the key rule and the host rule fire');
    assert.ok(violations.some((v) => v.rule.includes('RN-SEC3')));
    assert.ok(violations.some((v) => v.rule.includes('RN-FLOW4')));
  });
});
