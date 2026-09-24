/**
 * The one JS-side error mapper. It never invents or re-maps a **code** — the
 * canonical code is produced natively — it only
 * decorates a `NativeError` with the documented `userMessage` and
 * `isRetryable` from `ERROR_TABLE`.
 *
 * @internal
 */
import type { NativeError } from '../NativeUqpay';
import type { UqpayError, UqpayPlatform } from '../types';
import { ERROR_TABLE, UNKNOWN_ROW, findErrorRow } from './table';

/**
 * `true` when a code is not one of the fourteen canonical documented codes, or
 * is literally `'unknown'`.
 *
 * Merchants should branch on this rather than on a closed set, so a new code
 * from either native degrades to "something went wrong" instead of throwing.
 *
 * @example
 * ```ts
 * import { isUnknownErrorCode } from '@uqpay/react-native';
 *
 * if (result.kind === 'failed' && isUnknownErrorCode(result.error.code)) {
 *   reportToSentry(result.error.raw ?? result.error.code);
 * }
 * ```
 *
 * @param code - the `code` from a {@link UqpayError}
 * @returns `true` when the SDK has no documented handling for this code
 */
export function isUnknownErrorCode(code: string): boolean {
  if (code === UNKNOWN_ROW.code) return true;
  return !ERROR_TABLE.some((row) => row.code === code);
}

/** Blank-safe string read: `null`, `undefined` and `''` all become `undefined`. */
function optionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

/**
 * Turn a `NativeError` into the public {@link UqpayError}.
 *
 * An unrecognised code keeps its spelling, gets the generic-but-safe user
 * message, is flagged `isRetryable: false`, and keeps the native's raw value in
 * `raw` (falling back to the code itself when the native sent no `raw`).
 *
 * @internal
 */
export function toUqpayError(
  native: NativeError,
  platform: UqpayPlatform
): UqpayError {
  const code = optionalString(native.code) ?? UNKNOWN_ROW.code;
  const row = findErrorRow(code);
  const rawFallback = row === undefined ? code : undefined;

  return {
    code,
    userMessage: (row ?? UNKNOWN_ROW).userMessage,
    developerMessage:
      optionalString(native.developerMessage) ?? (row ?? UNKNOWN_ROW).meaning,
    isRetryable: (row ?? UNKNOWN_ROW).isRetryable,
    isOutcomeUnknown: native.isOutcomeUnknown === true,
    declineCode: optionalString(native.declineCode),
    httpStatus:
      typeof native.httpStatus === 'number' ? native.httpStatus : undefined,
    traceId: optionalString(native.traceId),
    raw: optionalString(native.raw) ?? rawFallback,
    platform,
  };
}

/**
 * Build a `UqpayError` for a condition JS itself detected (a double present, a
 * malformed native payload). `code` must still be a canonical code.
 *
 * @internal
 */
export function localError(
  code: string,
  developerMessage: string,
  platform: UqpayPlatform,
  raw?: string
): UqpayError {
  return toUqpayError(
    {
      code,
      developerMessage,
      isOutcomeUnknown: (findErrorRow(code) ?? UNKNOWN_ROW).isOutcomeUnknown,
      ...(raw === undefined ? {} : { raw }),
    },
    platform
  );
}
