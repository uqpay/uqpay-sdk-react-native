/**
 * AC RN-API2, RN-API3, RN-API4 — type-level tests. These assertions are checked
 * by `tsc` (and therefore by `yarn typecheck`); the runtime body only exists so
 * Jest reports the cells.
 */
import { describe, expect, it } from '@jest/globals';
import { expectTypeOf } from 'expect-type';
import type {
  Appearance,
  BillingDetails,
  CancelReason,
  InitOptions,
  IntentStatus,
  PaymentEvent,
  PaymentMethodType,
  PresentOptions,
  UqpayError,
  UqpayErrorCode,
  UqpayPaymentResult,
} from '../types';

describe('UqpayPaymentResult is a frozen four-variant union (RN-API2)', () => {
  it('has exactly the four kinds', () => {
    expectTypeOf<UqpayPaymentResult['kind']>().toEqualTypeOf<
      'completed' | 'failed' | 'canceled' | 'pending'
    >();
    expect(true).toBe(true);
  });

  it('discriminates on kind so a switch is exhaustive', () => {
    expectTypeOf<
      Extract<UqpayPaymentResult, { kind: 'completed' }>
    >().toHaveProperty('status');
    expectTypeOf<
      Extract<UqpayPaymentResult, { kind: 'failed' }>
    >().toHaveProperty('error');
    expectTypeOf<
      Extract<UqpayPaymentResult, { kind: 'canceled' }>
    >().toHaveProperty('reason');
    expectTypeOf<
      Extract<UqpayPaymentResult, { kind: 'pending' }>
    >().toHaveProperty('reconcile');
    expect(true).toBe(true);
  });

  it('keeps completed.status closed to the two payable terminal statuses', () => {
    expectTypeOf<
      Extract<UqpayPaymentResult, { kind: 'completed' }>['status']
    >().toEqualTypeOf<'SUCCEEDED' | 'REQUIRES_CAPTURE'>();
    expect(true).toBe(true);
  });

  it('types amount as a string, never a number (RN-FLOW5)', () => {
    expectTypeOf<
      Extract<UqpayPaymentResult, { kind: 'completed' }>['amount']
    >().toEqualTypeOf<string | undefined>();
    expect(true).toBe(true);
  });

  it('returns a promise of the same union from reconcile()', () => {
    expectTypeOf<
      ReturnType<Extract<UqpayPaymentResult, { kind: 'pending' }>['reconcile']>
    >().toEqualTypeOf<Promise<UqpayPaymentResult>>();
    expect(true).toBe(true);
  });
});

describe('open unions accept unseen values (RN-API3)', () => {
  it('accepts an unknown error code without widening to plain string', () => {
    expectTypeOf<'quantum_flux'>().toExtend<UqpayErrorCode>();
    expectTypeOf<'card_declined'>().toExtend<UqpayErrorCode>();
    expectTypeOf<UqpayErrorCode>().toExtend<string>();
    expect(true).toBe(true);
  });

  it.each(['PaymentMethodType', 'CancelReason', 'IntentStatus'])(
    'keeps %s open',
    (name) => {
      expectTypeOf<'brand_new_value'>().toExtend<PaymentMethodType>();
      expectTypeOf<'brand_new_value'>().toExtend<CancelReason>();
      expectTypeOf<'BRAND_NEW_STATUS'>().toExtend<IntentStatus>();
      expect(name.length).toBeGreaterThan(0);
    }
  );

  it('keeps the requiresAction type open too', () => {
    type Action = Extract<
      PaymentEvent,
      { type: 'requiresAction' }
    >['action']['type'];
    expectTypeOf<'brand_new_action'>().toExtend<Action>();
    expect(true).toBe(true);
  });
});

describe('no any / unknown in the public surface (RN-API4)', () => {
  it('types the error object end to end', () => {
    expectTypeOf<UqpayError['code']>().toEqualTypeOf<UqpayErrorCode>();
    expectTypeOf<UqpayError['platform']>().toEqualTypeOf<'ios' | 'android'>();
    expectTypeOf<UqpayError['isRetryable']>().toEqualTypeOf<boolean>();
    expectTypeOf<UqpayError['isOutcomeUnknown']>().toEqualTypeOf<boolean>();
    expect(true).toBe(true);
  });

  it('types the escape hatches as string maps, never unknown', () => {
    expectTypeOf<Appearance['ios']>().toEqualTypeOf<
      Record<string, string> | undefined
    >();
    expectTypeOf<BillingDetails['email']>().toEqualTypeOf<string | undefined>();
    expect(true).toBe(true);
  });

  it('types the token provider result', () => {
    expectTypeOf<ReturnType<InitOptions['tokenProvider']>>().toEqualTypeOf<
      Promise<{ authToken: string; expiresAt?: number | undefined }>
    >();
    expect(true).toBe(true);
  });

  it('lets a provider return an expiresAt that may be undefined', () => {
    // Under `exactOptionalPropertyTypes` a plain `expiresAt?: number` would
    // reject the natural shape of a parsed JSON body.
    const provider: InitOptions['tokenProvider'] = async () => {
      const body = {
        authToken: 't',
        expiresAt: undefined as number | undefined,
      };
      return { authToken: body.authToken, expiresAt: body.expiresAt };
    };

    expectTypeOf(provider).toEqualTypeOf<InitOptions['tokenProvider']>();
    expect(typeof provider).toBe('function');
  });

  it('types presentation as the three documented shapes', () => {
    expectTypeOf<PresentOptions['presentation']>().toEqualTypeOf<
      | 'methodList'
      | 'cardOnly'
      | { singleWallet: PaymentMethodType }
      | undefined
    >();
    expect(true).toBe(true);
  });
});
