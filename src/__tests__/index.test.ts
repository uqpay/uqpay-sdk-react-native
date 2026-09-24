/**
 * AC RN-API1, RN-API11 — the package entry point exports exactly the §2.1
 * surface, the same on both platforms, and nothing from the Turbo Module spec
 * or the internals.
 */
import { describe, expect, it } from '@jest/globals';
import * as publicApi from '../index';

const EXPECTED_RUNTIME_EXPORTS = [
  'UqpayConfigurationError',
  'addPaymentListener',
  'cancelPaymentSheet',
  'getPendingResult',
  'init',
  'isUnknownErrorCode',
  'notifyReturnedFromBank',
  'presentPaymentSheet',
  'useUqpay',
];

describe('the public API surface', () => {
  it('exports exactly the §2.1 surface plus UqpayConfigurationError', () => {
    expect(Object.keys(publicApi).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it.each(EXPECTED_RUNTIME_EXPORTS)('exports %s as a function', (name) => {
    expect(typeof (publicApi as Record<string, unknown>)[name]).toBe(
      'function'
    );
  });

  it('leaks nothing from the Codegen spec or the internals', () => {
    const names = Object.keys(publicApi);
    for (const forbidden of [
      'default',
      'Spec',
      'NativeUqpay',
      'marshalResult',
      'toUqpayError',
      'validateInitOptions',
      'resetForTests',
      'UQPAY_EVENT_TOKEN_REQUESTED',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
