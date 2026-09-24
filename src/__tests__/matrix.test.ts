/**
 * AC RN-TEST3 / RN-PAR1 — the mandated scenario matrix, one named test per
 * cell **per platform**, driven by the fixtures in `fixtures/scenarios.ts`
 * (the same table `yarn errors:sync` exports for the Swift and Kotlin suites).
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import mock from '../jest';
import { presentPaymentSheet } from '../client';
import { SCENARIOS } from './fixtures/scenarios';
import {
  ISO_8601_UTC_MS,
  PLATFORMS,
  assertScenario,
  freshSdk,
  presentOptions,
  type TestPlatform,
} from './helpers';

describe.each(PLATFORMS)('RN-TEST3 matrix on %s', (platform: TestPlatform) => {
  beforeEach(async () => {
    await freshSdk(platform);
  });

  it.each(SCENARIOS.map((scenario) => [scenario.title, scenario] as const))(
    '%s',
    async (_title, scenario) => {
      mock.__nextResult(scenario.native[platform]);

      const result = await presentPaymentSheet(presentOptions());

      assertScenario(result, scenario, platform);
      // AC RN-ERR6: exactly one native present per JS present, never a retry.
      expect(mock.__calls.presentPaymentSheet).toHaveLength(1);
    }
  );

  it('never reports an unrecognised payload as completed (RN-ERR5)', async () => {
    mock.__nextResult({
      kind: 'definitely-not-a-kind',
      paymentIntentId: 'pi_matrix_0001',
      platform,
      resultId: 'res-weird',
    });

    const result = await presentPaymentSheet(presentOptions());

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.error.code).toBe('unknown');
  });

  it('resolves every scenario rather than rejecting (RN-API5)', async () => {
    for (const scenario of SCENARIOS) {
      await freshSdk(platform);
      mock.__nextResult(scenario.native[platform]);
      await expect(
        presentPaymentSheet(presentOptions())
      ).resolves.toBeDefined();
    }
  });
});

describe('fixture hygiene (§14 parity, lead OQ-A2/A3)', () => {
  it.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
    '%s uses millisecond ISO-8601 UTC for completedAt on both platforms',
    (_id, scenario) => {
      for (const platform of PLATFORMS) {
        const completedAt = scenario.native[platform].completedAt;
        if (completedAt === undefined) continue;
        expect(completedAt).toMatch(ISO_8601_UTC_MS);
      }
    }
  );

  it('carries the same completedAt shape on both platforms', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.native.ios.completedAt === undefined).toBe(
        scenario.native.android.completedAt === undefined
      );
    }
  });

  it('never claims REQUIRES_CAPTURE on the delegate path (OQ-A2)', () => {
    // Only the terminal-intent guard may report REQUIRES_CAPTURE, and it
    // reports the intent id and the status and nothing else.
    for (const scenario of SCENARIOS) {
      for (const platform of PLATFORMS) {
        const native = scenario.native[platform];
        if (native.status !== 'REQUIRES_CAPTURE') continue;
        expect(scenario.id).toBe('terminal_guard_requires_capture');
        expect(native.amount).toBeUndefined();
        expect(native.currency).toBeUndefined();
      }
    }
  });

  it('gives a pending payload a status only where that native produces one (OQ-A3)', () => {
    // Android reports no last-known status on the pending path today.
    for (const scenario of SCENARIOS) {
      if (scenario.native.android.kind !== 'pending') continue;
      expect(scenario.native.android.status).toBeUndefined();
    }
  });
});

describe('RN-PAR1 cross-platform parity', () => {
  it.each(SCENARIOS.map((scenario) => [scenario.title, scenario] as const))(
    'iOS and Android agree on: %s',
    async (_title, scenario) => {
      const kinds: string[] = [];
      const codes: Array<string | undefined> = [];
      const reasons: Array<string | undefined> = [];

      for (const platform of PLATFORMS) {
        await freshSdk(platform);
        mock.__nextResult(scenario.native[platform]);
        const result = await presentPaymentSheet(presentOptions());
        kinds.push(result.kind);
        codes.push(
          result.kind === 'failed'
            ? result.error.code
            : result.kind === 'pending'
              ? result.cause?.code
              : undefined
        );
        reasons.push(result.kind === 'canceled' ? result.reason : undefined);
      }

      expect(kinds[0]).toBe(kinds[1]);
      expect(codes[0]).toBe(codes[1]);
      expect(reasons[0]).toBe(reasons[1]);
    }
  );
});
