/**
 * The single source of truth for UQPAY error codes.
 *
 * Everything downstream is generated from this array:
 *
 * - `toUqpayError()` reads `userMessage` and `isRetryable` from it,
 * - `yarn errors:generate` renders `ERROR_CODES.md` from it,
 * - `yarn errors:sync` writes `src/errors/error-table.json` and copies it into
 *   `ios/Tests/Fixtures/` and `android/src/test/resources/`, where the Swift
 *   and Kotlin mapper tests assert every row they can reach.
 *
 * A Jest drift test fails the build if the generated files are stale, so the
 * three implementations cannot disagree.
 *
 * @internal
 */
import type { UqpayErrorCode, UqpayPlatform } from '../types';

/**
 * One documented error code.
 *
 * @internal
 */
export type ErrorTableRow = {
  /** The canonical code as it crosses the bridge. */
  code: UqpayErrorCode;
  /** What actually happened, in one sentence, for the docs table. */
  meaning: string;
  /** Safe to show the customer verbatim. */
  userMessage: string;
  /** What the merchant's engineer should do about it. */
  developerHint: string;
  /** `true` when retrying the same action can plausibly succeed. */
  isRetryable: boolean;
  /** The value the natives set for this code; `true` means "may have succeeded". */
  isOutcomeUnknown: boolean;
  /** Which natives can emit this code. */
  platforms: ReadonlyArray<UqpayPlatform>;
};

const BOTH: ReadonlyArray<UqpayPlatform> = ['ios', 'android'];

/**
 * The fallback row for a code no bridge documents, and the canonical
 * `unknown` code itself.
 *
 * @internal
 */
export const UNKNOWN_ROW: ErrorTableRow = {
  code: 'unknown',
  meaning:
    'A code neither bridge recognises. The raw native value is preserved in error.raw.',
  userMessage:
    'Something went wrong with this payment. Please try again or use a different method.',
  developerHint:
    'Report error.raw and error.httpStatus (iOS only; Android does not expose it) to UQPAY. Never report the payment as completed. This is the definitive no-failure-code fallback on both natives, so the outcome is known unless the per-occurrence isOutcomeUnknown flag says otherwise.',
  isRetryable: false,
  isOutcomeUnknown: false,
  platforms: BOTH,
};

/**
 * The canonical fourteen. `unknown` is both a canonical code and
 * the fallback row `toUqpayError()` uses for a code it has never seen.
 *
 * @internal
 */
export const ERROR_TABLE: ReadonlyArray<ErrorTableRow> = [
  {
    code: 'card_declined',
    meaning: 'The issuer refused the card.',
    userMessage:
      'Your card was declined. Please try a different card or contact your bank.',
    developerHint:
      'Read declineCode for the issuer reason. Do not retry the same card automatically; offer another method.',
    isRetryable: false,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: 'insufficient_funds',
    meaning: 'The issuer refused the card for lack of funds.',
    userMessage:
      'Your card does not have enough funds for this payment. Please try a different card.',
    developerHint:
      'A decline sub-case. Offer another payment method rather than retrying.',
    isRetryable: false,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: 'invalid_payment_method',
    meaning:
      'The card or wallet details were rejected as invalid before authorisation.',
    userMessage:
      'Those payment details could not be used. Please check them and try again.',
    developerHint:
      'The customer can correct this in the sheet. If it repeats for every customer, check the intent and the enabled methods.',
    isRetryable: false,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: '3ds_failed',
    meaning: 'The 3-D Secure challenge was not passed.',
    userMessage:
      'We could not verify this payment with your bank. Please try again or use a different card.',
    developerHint:
      'The challenge ran and the server rejected the outcome. Never infer this from the WebView URL; the server is the source of truth.',
    isRetryable: false,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: 'cancelled',
    meaning:
      'The payment was cancelled — surfaced as an error only when the native reports it as one.',
    userMessage: 'This payment was cancelled.',
    developerHint:
      'Most cancellations arrive as kind "canceled" with a reason. Treat this code the same way: nothing was charged.',
    isRetryable: true,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: 'authentication_failed',
    meaning:
      'The merchant auth token was missing, blank, rejected, or your tokenProvider did not answer in time.',
    userMessage:
      'We could not start this payment. Please try again in a moment.',
    developerHint:
      'Your tokenProvider threw, returned a blank authToken, or did not settle within the native 10 s budget. Check your token endpoint and clientId.',
    isRetryable: true,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: 'invalid_configuration',
    meaning:
      'The SDK was asked to do something it cannot do with the given configuration.',
    userMessage:
      'We could not start this payment. Please try again in a moment.',
    developerHint:
      'A programmer error: a bad field, a sheet already presented, no foreground Activity / presenting view controller, or an option the platform does not support yet. The developer message names the field.',
    isRetryable: false,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: 'not_initialized',
    meaning: 'A payment was requested before init() completed.',
    userMessage:
      'We could not start this payment. Please try again in a moment.',
    developerHint:
      'Await init() before presentPaymentSheet(). On iOS this code is derived by the bridge; the Android native emits it directly.',
    isRetryable: false,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: 'invalid_request',
    meaning:
      'The gateway rejected the request as malformed or unknown (HTTP 400, 404 or 422).',
    userMessage:
      'We could not start this payment. Please try again in a moment.',
    developerHint:
      'Strictly 400/404/422. Usually a bad paymentIntentId, an intent that belongs to another merchant, or a method the intent does not allow. Other definitive 4xx arrive as "unknown"; on iOS httpStatus carries the status, on Android it is absent.',
    isRetryable: false,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: 'network_error',
    meaning: 'The device could not reach the gateway.',
    userMessage:
      'We could not reach the payment service. Please check your connection and try again.',
    developerHint:
      'Transport-level failure before the request was accepted. Safe to offer a retry; the natives replay with the same idempotency key.',
    isRetryable: true,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: 'timeout',
    meaning:
      'The native exhausted its attempt budget, or the confirm left the device and no answer came back.',
    userMessage:
      'This payment is taking longer than expected. We will confirm it shortly — please do not pay again.',
    developerHint:
      'Outcome unknown: the payment may still succeed. Arrives as the cause of a pending result. Reconcile from your server or via pending.reconcile(); never present again as a new payment.',
    isRetryable: false,
    isOutcomeUnknown: true,
    platforms: BOTH,
  },
  {
    code: 'server_error',
    meaning:
      'The gateway answered 5xx or 429 while the intent was being loaded.',
    userMessage:
      'The payment service is having trouble right now. Please try again in a moment.',
    developerHint:
      'Load-path only. A 5xx on the confirm path is reported as pending + timeout instead, because the outcome is unknown there. On iOS this code is derived from the message when a status can be recovered.',
    isRetryable: true,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  {
    code: 'intent_not_payable',
    meaning:
      'The intent is already in a terminal state and can no longer be paid.',
    userMessage: 'This payment can no longer be completed.',
    developerHint:
      'The terminal-intent guard refused before any form was shown. A SUCCEEDED / REQUIRES_CAPTURE intent resolves completed and a CANCELLED one resolves canceled, so this code means FAILED. Create a new intent.',
    isRetryable: false,
    isOutcomeUnknown: false,
    platforms: BOTH,
  },
  UNKNOWN_ROW,
];

/**
 * Look a code up in the canonical table.
 *
 * @internal
 */
export function findErrorRow(code: string): ErrorTableRow | undefined {
  return ERROR_TABLE.find((row) => row.code === code);
}
