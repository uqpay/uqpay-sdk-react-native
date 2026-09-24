/**
 * AC RN-PAR5, RN-FLOW5, RN-ERR5 — the marshalling rules, exhaustively.
 * `marshal.ts` is one of the 100 %-coverage files (RN-TEST2).
 */
import { describe, expect, it } from '@jest/globals';
import type { NativePaymentResult } from '../NativeUqpay';
import { marshalResult, type MarshalContext } from '../marshal';
import type { UqpayPaymentResult } from '../types';

const RECONCILED: UqpayPaymentResult = {
  kind: 'completed',
  paymentIntentId: 'pi_1',
  status: 'SUCCEEDED',
};

function ctx(overrides: Partial<MarshalContext> = {}): MarshalContext {
  return {
    fallbackIntentId: 'pi_fallback',
    fallbackPlatform: 'android',
    makeReconcile: () => () => Promise.resolve(RECONCILED),
    ...overrides,
  };
}

describe('marshalResult', () => {
  it('passes the wire amount and currency through untouched (RN-FLOW5)', () => {
    const result = marshalResult(
      {
        kind: 'completed',
        paymentIntentId: 'pi_1',
        status: 'SUCCEEDED',
        amount: '10.00',
        currency: 'SGD',
        platform: 'ios',
        resultId: 'r1',
      },
      ctx()
    );

    expect(result).toMatchObject({
      kind: 'completed',
      amount: '10.00',
      currency: 'SGD',
    });
  });

  it.each([
    ['0-decimal', '1000', 'JPY'],
    ['2-decimal', '10.00', 'SGD'],
    ['3-decimal', '10.000', 'KWD'],
    ['trailing zeros', '0.10', 'USD'],
  ])('preserves a %s amount byte for byte', (_label, amount, currency) => {
    const result = marshalResult(
      {
        kind: 'completed',
        paymentIntentId: 'pi_1',
        status: 'SUCCEEDED',
        amount,
        currency,
        platform: 'android',
        resultId: 'r1',
      },
      ctx()
    );

    expect(result.kind === 'completed' && result.amount).toBe(amount);
  });

  it('passes completedAt through untouched, whatever its precision', () => {
    // The bridges agree on millisecond ISO-8601 UTC, but JS never parses or
    // re-formats the value — it is informational and crosses as a wire string.
    for (const completedAt of [
      '2026-09-21T10:15:30.000Z',
      '2026-09-21T10:15:30Z',
      '2026-09-21T18:15:30.123+08:00',
    ]) {
      const result = marshalResult(
        {
          kind: 'completed',
          paymentIntentId: 'pi_1',
          status: 'SUCCEEDED',
          completedAt,
          platform: 'android',
          resultId: 'r1',
        },
        ctx()
      );

      expect(result.kind === 'completed' && result.completedAt).toBe(
        completedAt
      );
    }
  });

  it('keeps REQUIRES_CAPTURE and normalises anything else to SUCCEEDED', () => {
    const capture = marshalResult(
      {
        kind: 'completed',
        paymentIntentId: 'pi_1',
        status: 'REQUIRES_CAPTURE',
        platform: 'ios',
        resultId: 'r1',
      },
      ctx()
    );
    const missing = marshalResult(
      {
        kind: 'completed',
        paymentIntentId: 'pi_1',
        platform: 'ios',
        resultId: 'r2',
      },
      ctx()
    );

    expect(capture.kind === 'completed' && capture.status).toBe(
      'REQUIRES_CAPTURE'
    );
    expect(missing.kind === 'completed' && missing.status).toBe('SUCCEEDED');
  });

  it('turns null, empty-string and absent fields into undefined (RN-PAR5)', () => {
    const result = marshalResult(
      {
        kind: 'completed',
        paymentIntentId: 'pi_1',
        status: 'SUCCEEDED',
        amount: null as unknown as string,
        currency: '',
        paymentMethodType: null as unknown as string,
        transactionId: '',
        platform: 'ios',
        resultId: 'r1',
      },
      ctx()
    );

    expect(result).toMatchObject({ kind: 'completed' });
    if (result.kind !== 'completed') return;
    expect(result.amount).toBeUndefined();
    expect(result.currency).toBeUndefined();
    expect(result.paymentMethodType).toBeUndefined();
    expect(result.transactionId).toBeUndefined();
    expect(result.merchantOrderId).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
  });

  it('marshals a failure and keeps the native platform', () => {
    const result = marshalResult(
      {
        kind: 'failed',
        paymentIntentId: 'pi_1',
        error: {
          code: 'card_declined',
          developerMessage: 'declined',
          isOutcomeUnknown: false,
        },
        platform: 'ios',
        resultId: 'r1',
      },
      ctx()
    );

    expect(result.kind === 'failed' && result.error.code).toBe('card_declined');
    expect(result.kind === 'failed' && result.error.platform).toBe('ios');
  });

  it('synthesises an unknown error when a failure carries none', () => {
    const result = marshalResult(
      {
        kind: 'failed',
        paymentIntentId: 'pi_1',
        platform: 'android',
        resultId: 'r1',
      },
      ctx()
    );

    expect(result.kind === 'failed' && result.error.code).toBe('unknown');
    expect(result.kind === 'failed' && result.error.developerMessage).toContain(
      'bridge bug'
    );
  });

  it('defaults a cancel with no reason to user_cancelled', () => {
    const result = marshalResult(
      {
        kind: 'canceled',
        paymentIntentId: 'pi_1',
        platform: 'ios',
        resultId: 'r1',
      },
      ctx()
    );

    expect(result.kind === 'canceled' && result.reason).toBe('user_cancelled');
  });

  it('marshals pending with lastKnownStatus, cause and a working reconcile()', async () => {
    const result = marshalResult(
      {
        kind: 'pending',
        paymentIntentId: 'pi_1',
        status: 'REQUIRES_CUSTOMER_ACTION',
        error: {
          code: 'timeout',
          developerMessage: 'no answer',
          isOutcomeUnknown: true,
        },
        platform: 'android',
        resultId: 'r1',
      },
      ctx()
    );

    expect(result.kind).toBe('pending');
    if (result.kind !== 'pending') return;
    expect(result.lastKnownStatus).toBe('REQUIRES_CUSTOMER_ACTION');
    expect(result.cause?.code).toBe('timeout');
    expect(result.cause?.isOutcomeUnknown).toBe(true);
    await expect(result.reconcile()).resolves.toBe(RECONCILED);
  });

  it('marshals pending without a cause', () => {
    const result = marshalResult(
      {
        kind: 'pending',
        paymentIntentId: 'pi_1',
        platform: 'ios',
        resultId: 'r1',
      },
      ctx()
    );

    expect(result.kind === 'pending' && result.cause).toBeUndefined();
    expect(result.kind === 'pending' && result.lastKnownStatus).toBeUndefined();
  });

  it('degrades an unrecognised kind to failed/unknown, never completed (RN-ERR5)', () => {
    const result = marshalResult(
      {
        kind: 'teleported',
        paymentIntentId: 'pi_1',
        platform: 'ios',
        resultId: 'r1',
      },
      ctx()
    );

    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.error.code).toBe('unknown');
    expect(result.kind === 'failed' && result.error.raw).toBe('teleported');
  });

  it('degrades a blank kind to failed/unknown with a stringified raw', () => {
    const result = marshalResult(
      {
        paymentIntentId: 'pi_1',
        platform: 'ios',
        resultId: 'r1',
      } as NativePaymentResult,
      ctx()
    );

    expect(result.kind === 'failed' && result.error.raw).toBe('undefined');
  });

  it('degrades a non-object payload to failed/unknown with the fallback intent id', () => {
    const result = marshalResult(null as unknown as NativePaymentResult, ctx());

    expect(result.kind).toBe('failed');
    expect(result.paymentIntentId).toBe('pi_fallback');
    expect(result.kind === 'failed' && result.error.raw).toBe('null');
    expect(result.kind === 'failed' && result.error.platform).toBe('android');
  });

  it('degrades a primitive payload to failed/unknown', () => {
    const result = marshalResult(42 as unknown as NativePaymentResult, ctx());

    expect(result.kind === 'failed' && result.error.raw).toBe('42');
  });

  it('falls back to the requested intent id when the payload has none', () => {
    const result = marshalResult(
      {
        kind: 'completed',
        paymentIntentId: '',
        platform: 'ios',
        resultId: 'r1',
      },
      ctx()
    );

    expect(result.paymentIntentId).toBe('pi_fallback');
  });

  it('falls back to the context platform when the payload lies about it', () => {
    const result = marshalResult(
      {
        kind: 'failed',
        paymentIntentId: 'pi_1',
        error: {
          code: 'network_error',
          developerMessage: 'offline',
          isOutcomeUnknown: false,
        },
        platform: 'windows',
        resultId: 'r1',
      },
      ctx({ fallbackPlatform: 'ios' })
    );

    expect(result.kind === 'failed' && result.error.platform).toBe('ios');
  });
});
