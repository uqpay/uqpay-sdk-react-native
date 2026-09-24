/**
 * The RN-TEST3 scenario matrix, as data.
 *
 * One entry per payload-driven cell, with the **native payload each platform
 * produces** and the **single expectation both must meet** (AC RN-PAR1). The
 * JS matrix test runs every scenario against both platforms through the mock
 * native module; `yarn errors:sync` exports this file as `scenarios.json` into
 * `ios/Tests/Fixtures/` and `android/src/test/resources/` so the Swift and
 * Kotlin suites assert the same table.
 *
 * Cells that are not payload-driven (double-present, `http` returnUrl, init
 * idempotency, token-provider behaviour, Metro reload, unsupported platform,
 * listener leaks) have dedicated tests instead — they cannot be expressed as a
 * native payload.
 */
import type { NativeError, NativePaymentResult } from '../../NativeUqpay';

/** What both platforms must produce for a scenario. */
export type ScenarioExpectation = {
  /** The result variant. */
  kind: 'completed' | 'failed' | 'canceled' | 'pending';
  /** For `completed`. */
  status?: 'SUCCEEDED' | 'REQUIRES_CAPTURE' | undefined;
  /** For `failed` (`error.code`) or `pending` (`cause.code`). */
  errorCode?: string | undefined;
  /** For `canceled`. */
  cancelReason?: string | undefined;
  /**
   * For `pending`. **Optional**: a native that has no last-known status omits
   * it, and the assertion then requires `lastKnownStatus` to be `undefined`
   * (lead decision OQ-A3). Leave it unset here and the matrix derives the
   * expectation from each platform's payload.
   */
  lastKnownStatus?: string | undefined;
  /** The exact wire string, or `null` to assert the field is absent. */
  amount?: string | null | undefined;
  /** Expected `isOutcomeUnknown` on the error/cause. */
  isOutcomeUnknown?: boolean | undefined;
  /** Expected `isRetryable` on the error/cause. */
  isRetryable?: boolean | undefined;
  /** Expected `isUnknownErrorCode(code)`. */
  isUnknownErrorCode?: boolean | undefined;
  /** Expected `error.raw`. */
  raw?: string | undefined;
};

/** One row of the matrix. */
export type Scenario = {
  /** Stable id, also used in the native suites. */
  id: string;
  /** The `it(...)` name used on both platforms. */
  title: string;
  /** AC rows this cell covers. */
  acRows: ReadonlyArray<string>;
  /** The payload each native produces for this condition. */
  native: {
    /** What the iOS bridge emits. */
    ios: NativePaymentResult;
    /** What the Android bridge emits. */
    android: NativePaymentResult;
  };
  /** What both platforms must marshal to. */
  expected: ScenarioExpectation;
};

const INTENT = 'pi_matrix_0001';

function err(
  code: string,
  developerMessage: string,
  extra: Partial<NativeError> = {}
): NativeError {
  return { code, developerMessage, isOutcomeUnknown: false, ...extra };
}

function completed(
  platform: 'ios' | 'android',
  extra: Partial<NativePaymentResult> = {}
): NativePaymentResult {
  return {
    kind: 'completed',
    paymentIntentId: INTENT,
    status: 'SUCCEEDED',
    amount: '10.00',
    currency: 'SGD',
    paymentMethodType: 'card',
    transactionId: 'pa_0001',
    merchantOrderId: 'order-7',
    // Millisecond-precision ISO-8601 UTC on both natives (§14 parity).
    completedAt: '2026-09-21T10:15:30.000Z',
    platform,
    resultId: `res-${platform}-completed`,
    ...extra,
  };
}

function failed(
  platform: 'ios' | 'android',
  error: NativeError,
  extra: Partial<NativePaymentResult> = {}
): NativePaymentResult {
  return {
    kind: 'failed',
    paymentIntentId: INTENT,
    error,
    platform,
    resultId: `res-${platform}-${error.code}`,
    ...extra,
  };
}

function canceled(
  platform: 'ios' | 'android',
  reason: string,
  extra: Partial<NativePaymentResult> = {}
): NativePaymentResult {
  return {
    kind: 'canceled',
    paymentIntentId: INTENT,
    reason,
    platform,
    resultId: `res-${platform}-${reason}`,
    ...extra,
  };
}

function pending(
  platform: 'ios' | 'android',
  extra: Partial<NativePaymentResult> = {}
): NativePaymentResult {
  return {
    kind: 'pending',
    paymentIntentId: INTENT,
    error: err('timeout', 'the confirm left the device without an answer', {
      isOutcomeUnknown: true,
    }),
    platform,
    resultId: `res-${platform}-pending`,
    ...extra,
  };
}

/** The scenario matrix. Order is the order of `docs/internal/progress/test-matrix.md`. */
export const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    id: 'success',
    title: 'success resolves completed with the wire amount untouched',
    acRows: ['RN-API5', 'RN-FLOW5', 'RN-PAR5'],
    native: { ios: completed('ios'), android: completed('android') },
    expected: { kind: 'completed', status: 'SUCCEEDED', amount: '10.00' },
  },
  {
    id: 'requires_capture',
    title:
      'a manual-capture intent paid through the sheet still reports completed/SUCCEEDED on both platforms',
    acRows: ['RN-FLOW10', 'lead OQ-A2'],
    native: {
      // Both natives collapse a manual-capture success to SUCCEEDED on the
      // delegate path; REQUIRES_CAPTURE only reaches JS through the
      // terminal-intent guard (see `terminal_guard_requires_capture`).
      ios: completed('ios'),
      android: completed('android'),
    },
    expected: {
      kind: 'completed',
      status: 'SUCCEEDED',
      amount: '10.00',
    },
  },
  {
    id: 'decline',
    title: 'a declined card resolves failed with card_declined',
    acRows: ['RN-API5', 'RN-ERR1'],
    native: {
      ios: failed(
        'ios',
        err('card_declined', 'issuer declined', { declineCode: 'do_not_honor' })
      ),
      android: failed(
        'android',
        err('card_declined', 'issuer declined', { declineCode: 'do_not_honor' })
      ),
    },
    expected: {
      kind: 'failed',
      errorCode: 'card_declined',
      isRetryable: false,
      isOutcomeUnknown: false,
      isUnknownErrorCode: false,
    },
  },
  {
    id: 'insufficient_funds',
    title: 'insufficient funds resolves failed with insufficient_funds',
    acRows: ['RN-ERR1'],
    native: {
      ios: failed(
        'ios',
        err('insufficient_funds', 'issuer declined for funds')
      ),
      android: failed(
        'android',
        err('insufficient_funds', 'issuer declined for funds')
      ),
    },
    expected: {
      kind: 'failed',
      errorCode: 'insufficient_funds',
      isRetryable: false,
    },
  },
  {
    id: 'three_ds_pass',
    title: 'a passed 3DS challenge resolves completed',
    acRows: ['RN-FLOW6'],
    native: {
      ios: completed('ios', { transactionId: 'pa_3ds_ok' }),
      android: completed('android', { transactionId: 'pa_3ds_ok' }),
    },
    expected: { kind: 'completed', status: 'SUCCEEDED' },
  },
  {
    id: 'three_ds_fail',
    title: 'a failed 3DS challenge resolves failed with 3ds_failed',
    acRows: ['RN-FLOW6', 'RN-ERR1'],
    native: {
      ios: failed('ios', err('3ds_failed', 'server rejected the 3DS outcome')),
      android: failed(
        'android',
        err('3ds_failed', 'server rejected the 3DS outcome')
      ),
    },
    expected: {
      kind: 'failed',
      errorCode: '3ds_failed',
      isUnknownErrorCode: false,
    },
  },
  {
    id: 'user_cancel',
    title: 'the customer cancelling resolves canceled with user_cancelled',
    acRows: ['RN-FLOW7'],
    native: {
      ios: canceled('ios', 'user_cancelled'),
      android: canceled('android', 'user_cancelled'),
    },
    expected: { kind: 'canceled', cancelReason: 'user_cancelled' },
  },
  {
    id: 'sheet_dismiss',
    title:
      'dismissing the sheet before any attempt resolves canceled with user_cancelled',
    acRows: ['RN-FLOW7', 'RN-UX9'],
    native: {
      ios: canceled('ios', 'user_cancelled'),
      android: canceled('android', 'user_cancelled'),
    },
    expected: { kind: 'canceled', cancelReason: 'user_cancelled' },
  },
  {
    id: 'merchant_cancel',
    title:
      'cancelPaymentSheet with nothing in flight resolves canceled with merchant_cancelled',
    acRows: ['RN-FLOW7', 'RN-UX6'],
    native: {
      ios: canceled('ios', 'merchant_cancelled'),
      android: canceled('android', 'merchant_cancelled'),
    },
    expected: { kind: 'canceled', cancelReason: 'merchant_cancelled' },
  },
  {
    id: 'dismiss_mid_confirm',
    title:
      'dismissing mid-confirm resolves pending with no amount, never canceled',
    acRows: ['RN-FLOW5', 'RN-FLOW7', 'RN-UX6'],
    native: {
      // iOS reports amount 0 / currency "" here; the bridge drops both.
      // Neither native reports a last-known status on this path (OQ-A3).
      ios: pending('ios'),
      android: pending('android'),
    },
    expected: {
      kind: 'pending',
      errorCode: 'timeout',
      amount: null,
      isOutcomeUnknown: true,
      isRetryable: false,
    },
  },
  {
    id: 'network_timeout',
    title:
      'a network timeout resolves pending with cause timeout and isOutcomeUnknown',
    acRows: ['RN-ERR4', 'RN-CB7'],
    native: { ios: pending('ios'), android: pending('android') },
    expected: {
      kind: 'pending',
      errorCode: 'timeout',
      isOutcomeUnknown: true,
      isRetryable: false,
    },
  },
  {
    id: 'network_error',
    title:
      'a transport failure before the request resolves failed with network_error',
    acRows: ['RN-ERR4'],
    native: {
      ios: failed('ios', err('network_error', 'could not reach the gateway')),
      android: failed(
        'android',
        err('network_error', 'could not reach the gateway')
      ),
    },
    expected: { kind: 'failed', errorCode: 'network_error', isRetryable: true },
  },
  {
    id: 'server_5xx_load',
    title: 'a 5xx while loading the intent resolves failed with server_error',
    acRows: ['RN-ERR4', 'spikes S2-2'],
    native: {
      ios: failed(
        'ios',
        err('server_error', 'GET intent returned 503', { httpStatus: 503 })
      ),
      android: failed(
        'android',
        err('server_error', 'GET intent returned 503', { httpStatus: 503 })
      ),
    },
    expected: {
      kind: 'failed',
      errorCode: 'server_error',
      isRetryable: true,
      isOutcomeUnknown: false,
    },
  },
  {
    id: 'server_5xx_confirm',
    title: 'a 5xx on the confirm path resolves pending with cause timeout',
    acRows: ['RN-ERR4', 'spikes S2-2'],
    native: {
      ios: pending('ios'),
      android: pending('android'),
    },
    expected: {
      kind: 'pending',
      errorCode: 'timeout',
      isOutcomeUnknown: true,
      isRetryable: false,
    },
  },
  {
    id: 'invalid_request_400',
    title: 'a 400/404/422 resolves failed with invalid_request',
    acRows: ['RN-ERR1', 'spikes S2-1'],
    native: {
      ios: failed(
        'ios',
        err('invalid_request', 'gateway rejected the intent', {
          httpStatus: 422,
        })
      ),
      android: failed(
        'android',
        err('invalid_request', 'gateway rejected the intent', {
          httpStatus: 422,
        })
      ),
    },
    expected: {
      kind: 'failed',
      errorCode: 'invalid_request',
      isRetryable: false,
    },
  },
  {
    id: 'malformed_payload',
    title:
      'a malformed native payload resolves failed with unknown, never completed',
    acRows: ['RN-ERR5', 'RN-API3'],
    native: {
      ios: { ...completed('ios'), kind: 'not-a-kind' },
      android: { ...completed('android'), kind: 'not-a-kind' },
    },
    expected: {
      kind: 'failed',
      errorCode: 'unknown',
      isUnknownErrorCode: true,
      raw: 'not-a-kind',
    },
  },
  {
    id: 'unknown_error_code',
    title: 'an unrecognised error code round-trips with raw preserved',
    acRows: ['RN-API3', 'RN-ERR5'],
    native: {
      ios: failed(
        'ios',
        err('quantum_flux', 'native SDK reported quantum_flux')
      ),
      android: failed(
        'android',
        err('quantum_flux', 'native SDK reported quantum_flux')
      ),
    },
    expected: {
      kind: 'failed',
      errorCode: 'quantum_flux',
      isUnknownErrorCode: true,
      isRetryable: false,
      raw: 'quantum_flux',
    },
  },
  {
    id: 'no_activity_or_vc',
    title:
      'no foreground Activity / presenting VC resolves failed with invalid_configuration',
    acRows: ['RN-CB8'],
    native: {
      ios: failed(
        'ios',
        err('invalid_configuration', 'no presenting view controller')
      ),
      android: failed(
        'android',
        err('invalid_configuration', 'no foreground Activity')
      ),
    },
    expected: {
      kind: 'failed',
      errorCode: 'invalid_configuration',
      isRetryable: false,
      isUnknownErrorCode: false,
    },
  },
  {
    id: 'token_provider_failure',
    title:
      'a token-provider failure resolves failed with authentication_failed',
    acRows: ['RN-ERR8'],
    native: {
      ios: failed(
        'ios',
        err('authentication_failed', 'tokenProvider did not supply a token')
      ),
      android: failed(
        'android',
        err('authentication_failed', 'tokenProvider did not supply a token')
      ),
    },
    expected: {
      kind: 'failed',
      errorCode: 'authentication_failed',
      isRetryable: true,
    },
  },
  {
    id: 'terminal_succeeded',
    title:
      'the terminal-intent guard resolves completed for an already SUCCEEDED intent',
    acRows: ['RN-FLOW2'],
    native: {
      ios: {
        kind: 'completed',
        paymentIntentId: INTENT,
        status: 'SUCCEEDED',
        platform: 'ios',
        resultId: 'res-ios-terminal-succeeded',
      },
      android: {
        kind: 'completed',
        paymentIntentId: INTENT,
        status: 'SUCCEEDED',
        platform: 'android',
        resultId: 'res-android-terminal-succeeded',
      },
    },
    expected: { kind: 'completed', status: 'SUCCEEDED', amount: null },
  },
  {
    id: 'terminal_guard_requires_capture',
    title:
      'the terminal-intent guard resolves completed with REQUIRES_CAPTURE and nothing else',
    acRows: ['RN-FLOW2', 'RN-FLOW10', 'lead OQ-A2'],
    native: {
      // The iOS pre-read (and Android's isPayable guard) refuses before any
      // form is shown, so the result carries the id and the status only.
      ios: {
        kind: 'completed',
        paymentIntentId: INTENT,
        status: 'REQUIRES_CAPTURE',
        platform: 'ios',
        resultId: 'res-ios-terminal-requires-capture',
      },
      android: {
        kind: 'completed',
        paymentIntentId: INTENT,
        status: 'REQUIRES_CAPTURE',
        platform: 'android',
        resultId: 'res-android-terminal-requires-capture',
      },
    },
    expected: { kind: 'completed', status: 'REQUIRES_CAPTURE', amount: null },
  },
  {
    id: 'terminal_failed',
    title:
      'the terminal-intent guard resolves failed with intent_not_payable for a FAILED intent',
    acRows: ['RN-FLOW2'],
    native: {
      ios: failed('ios', err('intent_not_payable', 'intent status FAILED')),
      android: failed(
        'android',
        err('intent_not_payable', 'intent status FAILED')
      ),
    },
    expected: {
      kind: 'failed',
      errorCode: 'intent_not_payable',
      isRetryable: false,
    },
  },
  {
    id: 'terminal_cancelled',
    title:
      'the terminal-intent guard resolves canceled with intent_cancelled for a CANCELLED intent',
    acRows: ['RN-FLOW2', 'RN-PAR1'],
    native: {
      ios: canceled('ios', 'intent_cancelled'),
      android: canceled('android', 'intent_cancelled'),
    },
    expected: { kind: 'canceled', cancelReason: 'intent_cancelled' },
  },
  {
    id: 'qr_expiry',
    title: 'QR expiry resolves pending with cause timeout',
    acRows: ['RN-FLOW9'],
    native: {
      // The Android wallet path reports no last-known status either (OQ-A3).
      ios: pending('ios', { paymentMethodType: 'grabpay' }),
      android: pending('android', { paymentMethodType: 'grabpay' }),
    },
    expected: { kind: 'pending', errorCode: 'timeout', isOutcomeUnknown: true },
  },
  {
    id: 'wallet_success',
    title: 'a wallet payment resolves completed with the confirmed method',
    acRows: ['RN-FLOW8', 'RN-PAR2'],
    native: {
      ios: completed('ios', {
        paymentMethodType: 'grabpay',
        amount: '1000',
        currency: 'JPY',
      }),
      android: completed('android', {
        paymentMethodType: 'grabpay',
        amount: '1000',
        currency: 'JPY',
      }),
    },
    expected: { kind: 'completed', status: 'SUCCEEDED', amount: '1000' },
  },
];
