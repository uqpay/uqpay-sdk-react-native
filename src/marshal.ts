/**
 * `NativePaymentResult` → {@link UqpayPaymentResult}.
 *
 * The rules this file exists to guarantee:
 *
 * - `amount` and `currency` pass through as the wire strings, untouched — no
 *   parsing, no scaling, no rounding.
 * - Statuses and codes keep their casing.
 * - `null` and an absent field both become `undefined`, so merchants have one
 *   thing to check.
 * - An unrecognised `kind` becomes `failed` with the `unknown` code and the raw
 *   value preserved — **never** `completed`.
 *
 * @internal
 */
import type { NativePaymentResult } from './NativeUqpay';
import { localError, toUqpayError } from './errors/mapper';
import type {
  CancelReason,
  IntentStatus,
  PaymentMethodType,
  UqpayPaymentResult,
  UqpayPlatform,
} from './types';

/**
 * What `marshalResult` needs that the native payload does not carry.
 *
 * @internal
 */
export type MarshalContext = {
  /** Used when the payload carries no usable `paymentIntentId`. */
  fallbackIntentId: string;
  /** Used when the payload cannot say which native produced it. */
  fallbackPlatform: UqpayPlatform;
  /** Builds the `reconcile()` closure for a `pending` result. */
  makeReconcile: (paymentIntentId: string) => () => Promise<UqpayPaymentResult>;
};

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function platformOf(value: unknown, fallback: UqpayPlatform): UqpayPlatform {
  return value === 'ios' || value === 'android' ? value : fallback;
}

/**
 * Marshal one native payload. Total: every input produces exactly one of the
 * four variants.
 *
 * @internal
 */
export function marshalResult(
  native: NativePaymentResult,
  ctx: MarshalContext
): UqpayPaymentResult {
  if (typeof native !== 'object' || native === null) {
    return {
      kind: 'failed',
      paymentIntentId: ctx.fallbackIntentId,
      error: localError(
        'unknown',
        'The native module returned a payload that is not an object. This is a bridge bug; report it with the raw value.',
        ctx.fallbackPlatform,
        String(native)
      ),
    };
  }

  const platform = platformOf(native.platform, ctx.fallbackPlatform);
  const paymentIntentId = str(native.paymentIntentId) ?? ctx.fallbackIntentId;

  switch (native.kind) {
    case 'completed': {
      const status =
        native.status === 'REQUIRES_CAPTURE' ? 'REQUIRES_CAPTURE' : 'SUCCEEDED';
      return {
        kind: 'completed',
        paymentIntentId,
        status,
        amount: str(native.amount),
        currency: str(native.currency),
        paymentMethodType: str(native.paymentMethodType) as
          PaymentMethodType | undefined,
        transactionId: str(native.transactionId),
        merchantOrderId: str(native.merchantOrderId),
        completedAt: str(native.completedAt),
      };
    }

    case 'failed':
      return {
        kind: 'failed',
        paymentIntentId,
        error:
          native.error == null
            ? localError(
                'unknown',
                'The native module reported a failure without an error object. This is a bridge bug.',
                platform
              )
            : toUqpayError(native.error, platform),
      };

    case 'canceled':
      return {
        kind: 'canceled',
        paymentIntentId,
        reason: (str(native.reason) ?? 'user_cancelled') as CancelReason,
      };

    case 'pending':
      return {
        kind: 'pending',
        paymentIntentId,
        lastKnownStatus: str(native.status) as IntentStatus | undefined,
        cause:
          native.error == null
            ? undefined
            : toUqpayError(native.error, platform),
        reconcile: ctx.makeReconcile(paymentIntentId),
      };

    default:
      return {
        kind: 'failed',
        paymentIntentId,
        error: localError(
          'unknown',
          `The native module returned an unrecognised result kind ${JSON.stringify(native.kind)}. Treat the outcome as unknown and reconcile server-side.`,
          platform,
          str(native.kind) ?? String(native.kind)
        ),
      };
  }
}
