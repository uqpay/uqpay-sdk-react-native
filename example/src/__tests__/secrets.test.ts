/**
 * The sample app must never touch the merchant API key and must never call the UQPAY API host directly.
 *
 * The scanning logic lives in `example/scripts/scan-secrets.mjs` and is shared
 * with the Node suite (`example/backend/test/tripwire.test.mjs`), so the same
 * gate holds whichever runner executes.
 *
 * Runner note: `example/` has no Jest of its own — yarn's
 * `nmHoistingLimits: workspaces` keeps the root's copy out of reach — so today
 * this gate runs through its twin under
 * `node --test 'example/backend/test/*.test.mjs'`. Add `'<rootDir>/example/src'`
 * to `roots` in the root `jest.config.js` to run it here as well.
 */

import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';

import {
  scanAppSources,
  formatViolations,
} from '../../scripts/scan-secrets.mjs';
import { APP_VARIABLES } from '../../scripts/gen-env.mjs';

const EXAMPLE_DIR = resolve(__dirname, '..', '..');

describe('sample app secrets tripwire', () => {
  it('never references UQPAY_API_KEY under example/src or example/scripts', () => {
    const violations = scanAppSources(EXAMPLE_DIR).filter((v) =>
      v.rule.includes('RN-SEC3')
    );
    // The formatted list is asserted first so a failure names the file and line.
    expect(formatViolations(violations)).toBe('');
    expect(violations).toHaveLength(0);
  });

  it('never names the UQPAY API host (RN-FLOW4: no direct calls, no polling)', () => {
    const violations = scanAppSources(EXAMPLE_DIR).filter((v) =>
      v.rule.includes('RN-FLOW4')
    );
    expect(formatViolations(violations)).toBe('');
    expect(violations).toHaveLength(0);
  });

  it('generates exactly three variables into the app bundle', () => {
    // If this list ever grows, the reviewer has to justify it in the diff.
    expect([...APP_VARIABLES]).toEqual([
      'UQPAY_ENVIRONMENT',
      'UQPAY_CLIENT_ID',
      'UQPAY_MERCHANT_BACKEND_URL',
    ]);
  });
});
