/**
 * The Expo sample app must never touch the merchant API key and must never call the UQPAY API host directly.
 *
 * Same gate as `example/src/__tests__/secrets.test.ts`, pointed at this
 * workspace. It runs from the ROOT Jest project (`roots` in the root
 * `jest.config.js` lists `<rootDir>/example-expo/src`), because `example-expo/`
 * has no Jest of its own — yarn's `nmHoistingLimits: workspaces` keeps the
 * root's copy out of reach from inside the workspace.
 */

import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';

import {
  scanAppSources,
  formatViolations,
} from '../../scripts/scan-secrets.mjs';
import { APP_VARIABLES } from '../../scripts/gen-env.mjs';

const APP_DIR = resolve(__dirname, '..', '..');

describe('Expo sample app secrets tripwire', () => {
  it('never references UQPAY_API_KEY under example-expo/src or example-expo/scripts', () => {
    const violations = scanAppSources(APP_DIR).filter((v) =>
      v.rule.includes('RN-SEC3')
    );
    // The formatted list is asserted first so a failure names the file and line.
    expect(formatViolations(violations)).toBe('');
    expect(violations).toHaveLength(0);
  });

  it('never names the UQPAY API host (RN-FLOW4: no direct calls, no polling)', () => {
    const violations = scanAppSources(APP_DIR).filter((v) =>
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
