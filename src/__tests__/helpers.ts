/**
 * Shared test plumbing. Not a suite (see `testMatch` in `jest.config.js`).
 */
import { expect } from '@jest/globals';
import mock from '../jest';
import { init, resetForTests } from '../client';
import { isUnknownErrorCode } from '../errors/mapper';
import type { InitOptions, PresentOptions, UqpayPaymentResult } from '../types';
import type { Scenario } from './fixtures/scenarios';

/** Both platforms the SDK supports, in a fixed order. */
export const PLATFORMS = ['ios', 'android'] as const;

/**
 * Millisecond-precision ISO-8601 UTC, which is what both bridges emit for
 * `completedAt` (§14 parity). Asserted as a **format**, never as a literal, so
 * a fixture date change cannot silently become a contract change.
 */
export const ISO_8601_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The platform a table-driven test is currently running as. */
export type TestPlatform = (typeof PLATFORMS)[number];

/** A valid, minimal init config that uses the mock's scripted token provider. */
export function initOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    environment: 'sandbox',
    clientId: 'ck_test_matrix',
    tokenProvider: mock.tokenProvider,
    ...overrides,
  };
}

/** Valid present options for the shared fixture intent. */
export function presentOptions(
  overrides: Partial<PresentOptions> = {}
): PresentOptions {
  return {
    paymentIntentId: 'pi_matrix_0001',
    returnUrl: 'myapp://pay/return',
    ...overrides,
  };
}

/** Throw away all SDK and mock state, then pretend to be `platform`. */
export function resetSdk(platform: TestPlatform = 'ios'): void {
  resetForTests();
  mock.__reset();
  mock.__setPlatform(platform);
}

/** Reset and `init()` as `platform`. */
export async function freshSdk(platform: TestPlatform): Promise<void> {
  resetSdk(platform);
  await init(initOptions());
}

/**
 * Assert a marshalled result against a scenario's single cross-platform
 * expectation (AC RN-PAR1).
 */
export function assertScenario(
  result: UqpayPaymentResult,
  scenario: Scenario,
  platform: TestPlatform
): void {
  const { expected } = scenario;
  expect(result.kind).toBe(expected.kind);
  expect(result.paymentIntentId).toBe(
    scenario.native[platform].paymentIntentId
  );

  if (result.kind === 'completed') {
    expect(result.status).toBe(expected.status);
    const nativeCompletedAt = scenario.native[platform].completedAt;
    if (nativeCompletedAt === undefined) {
      expect(result.completedAt).toBeUndefined();
    } else {
      // Passed through untouched (RN-PAR5) and in the agreed format.
      expect(result.completedAt).toBe(nativeCompletedAt);
      expect(result.completedAt).toMatch(ISO_8601_UTC_MS);
    }
    if (expected.amount === null) {
      expect(result.amount).toBeUndefined();
    } else if (expected.amount !== undefined) {
      // The wire string, byte for byte (AC RN-FLOW5).
      expect(result.amount).toBe(expected.amount);
    }
    return;
  }

  if (result.kind === 'canceled') {
    expect(result.reason).toBe(expected.cancelReason);
    return;
  }

  const error = result.kind === 'failed' ? result.error : result.cause;
  expect(error).toBeDefined();
  if (error === undefined) return;

  expect(error.code).toBe(expected.errorCode);
  expect(error.platform).toBe(platform);
  expect(error.userMessage.length).toBeGreaterThan(0);
  if (expected.isRetryable !== undefined) {
    expect(error.isRetryable).toBe(expected.isRetryable);
  }
  if (expected.isOutcomeUnknown !== undefined) {
    expect(error.isOutcomeUnknown).toBe(expected.isOutcomeUnknown);
  }
  if (expected.isUnknownErrorCode !== undefined) {
    expect(isUnknownErrorCode(error.code)).toBe(expected.isUnknownErrorCode);
  }
  if (expected.raw !== undefined) {
    expect(error.raw).toBe(expected.raw);
  }
  if (result.kind === 'pending') {
    expect('amount' in result).toBe(false);
    // OQ-A3: `status` is optional on a pending payload. Assert it when the
    // platform's fixture carries one, and assert its absence when it does not.
    const nativeStatus =
      expected.lastKnownStatus ?? scenario.native[platform].status;
    expect(result.lastKnownStatus).toBe(
      nativeStatus === undefined || nativeStatus === ''
        ? undefined
        : nativeStatus
    );
  }
}
