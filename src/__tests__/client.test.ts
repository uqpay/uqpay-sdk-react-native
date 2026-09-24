/**
 * The non-payload cells of the RN-TEST3 matrix, plus the client's own state
 * machine: init idempotency (RN-IDEM1, RN-API9), double-present (RN-UX7),
 * the pending buffer and Metro reload (RN-CB6), `reconcile()` (RN-CB3),
 * the token bridge (RN-ERR8) and listener hygiene (RN-TEST8).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { NativeModules } from 'react-native';
import mock, { createUqpayNativeMock } from '../jest';
import {
  addPaymentListener,
  cancelPaymentSheet,
  getPendingResult,
  handleTokenRequest,
  init,
  inspectStateForTests,
  notifyReturnedFromBank,
  presentPaymentSheet,
  resetForTests,
  setNativeModuleForTests,
  stableStringify,
  useUqpay,
} from '../client';
import {
  UQPAY_EVENT_PAYMENT_RECONCILED,
  UQPAY_EVENT_REQUIRES_ACTION,
} from '../nativeEvents';
import { UqpayConfigurationError } from '../errors/configurationError';
import type { NativePaymentResult } from '../NativeUqpay';
import type { PaymentEvent } from '../types';
import {
  PLATFORMS,
  initOptions,
  presentOptions,
  resetSdk,
  type TestPlatform,
} from './helpers';

const INTENT = 'pi_matrix_0001';

function completedPayload(platform: TestPlatform): NativePaymentResult {
  return {
    kind: 'completed',
    paymentIntentId: INTENT,
    status: 'SUCCEEDED',
    amount: '10.00',
    currency: 'SGD',
    platform,
    resultId: 'res-buffered',
  };
}

function pendingPayload(platform: TestPlatform): NativePaymentResult {
  return {
    kind: 'pending',
    paymentIntentId: INTENT,
    error: {
      code: 'timeout',
      developerMessage: 'no answer',
      isOutcomeUnknown: true,
    },
    platform,
    resultId: 'res-pending',
  };
}

describe.each(PLATFORMS)('client on %s', (platform: TestPlatform) => {
  beforeEach(() => {
    resetSdk(platform);
  });

  describe('init idempotency (RN-IDEM1, RN-API9)', () => {
    it('re-initialising with the same config is a no-op', async () => {
      await init(initOptions());
      await init(initOptions());

      expect(mock.__calls.initialize).toHaveLength(1);
      expect(inspectStateForTests().initialized).toBe(true);
    });

    it('re-registers the tokenProvider on a same-config re-init after a reload', async () => {
      await init(initOptions());
      resetSdkPreservingNative();
      await init(initOptions());

      expect(inspectStateForTests().hasTokenProvider).toBe(true);
    });

    it('rejects a different config while a sheet is presented', async () => {
      await init(initOptions());
      mock.__nextResult(completedPayload(platform));

      // Start a present but do not await it, so `presenting` is still true.
      const inFlight = presentPaymentSheet(presentOptions());
      await expect(
        init(initOptions({ clientId: 'ck_other' }))
      ).rejects.toMatchObject({
        code: 'invalid_configuration',
      });
      await inFlight;
    });

    it('re-initialises with a different config while idle', async () => {
      await init(initOptions());
      await init(initOptions({ clientId: 'ck_other' }));

      expect(mock.__calls.initialize).toHaveLength(2);
      expect(mock.__calls.initialize[0]?.configId).not.toBe(
        mock.__calls.initialize[1]?.configId
      );
    });

    it('computes the same configId regardless of key order', async () => {
      await init({
        clientId: 'ck_test_matrix',
        tokenProvider: mock.tokenProvider,
        environment: 'sandbox',
      });
      const first = mock.__calls.initialize[0]?.configId;

      await init(initOptions());

      expect(mock.__calls.initialize).toHaveLength(1);
      expect(first).toBeDefined();
    });

    it('stringifies nested values stably, including nulls and arrays', () => {
      expect(stableStringify({ b: 1, a: 'x' })).toBe('{"a":"x","b":1}');
      expect(stableStringify({ a: 'x', b: 1 })).toBe('{"a":"x","b":1}');
      expect(stableStringify({ a: null, b: [1, 'two'], c: undefined })).toBe(
        '{"a":null,"b":[1,"two"]}'
      );
      expect(stableStringify({ nested: { z: true, a: false } })).toBe(
        '{"nested":{"a":false,"z":true}}'
      );
    });

    it('treats a changed appearance as a different config', async () => {
      await init(initOptions());
      await init(initOptions({ appearance: { primaryColor: '#0A84FF' } }));
      await init(initOptions({ appearance: { cornerRadius: 4 } }));

      expect(mock.__calls.initialize).toHaveLength(3);
      expect(mock.__calls.initialize[1]?.appearance).toEqual({
        primaryColor: '#0A84FF',
      });
      expect(mock.__calls.initialize[2]?.appearance).toEqual({
        cornerRadius: 4,
      });
    });

    it('forwards appearance escape hatches as JSON strings', async () => {
      await init(
        initOptions({
          appearance: {
            colorMode: 'dark',
            primaryColor: '#0A84FF',
            backgroundColor: '#000000FF',
            surfaceColor: '#111111',
            textColor: '#FFFFFF',
            secondaryTextColor: '#AAAAAA',
            errorColor: '#FF3B30',
            cornerRadius: 12,
            ios: { sheetCornerRadius: '#0A84FF' },
            android: {
              light: { primary: '#FF0A84FF' },
              dark: { primary: '#FF64D2FF' },
            },
          },
          debugLogging: true,
        })
      );

      const config = mock.__calls.initialize[0];
      expect(config?.appearance?.iosExtras).toBe(
        '{"sheetCornerRadius":"#0A84FF"}'
      );
      expect(config?.appearance?.androidExtras).toContain('"light"');
      expect(config?.onBehalfOf).toBeUndefined();
      expect(config?.debugLogging).toBe(true);
    });
  });

  describe('presentation guards', () => {
    it('rejects presentPaymentSheet before init with not_initialized (RN-ERR7)', async () => {
      await expect(presentPaymentSheet(presentOptions())).rejects.toMatchObject(
        {
          code: 'not_initialized',
        }
      );
    });

    it('rejects cancelPaymentSheet before init with not_initialized', async () => {
      await expect(cancelPaymentSheet()).rejects.toMatchObject({
        code: 'not_initialized',
      });
    });

    it('makes notifyReturnedFromBank a silent no-op before init (safe in a Linking listener)', () => {
      expect(() => {
        notifyReturnedFromBank();
      }).not.toThrow();
      expect(mock.__calls.notifyReturnedFromBank).toHaveLength(0);
    });

    it('resolves the second of two concurrent presents with invalid_configuration (RN-UX7)', async () => {
      await init(initOptions());
      mock.__nextResult(completedPayload(platform));

      const [first, second] = await Promise.all([
        presentPaymentSheet(presentOptions()),
        presentPaymentSheet(presentOptions()),
      ]);

      const outcomes = [first, second];
      expect(outcomes.filter((r) => r.kind === 'completed')).toHaveLength(1);
      const rejected = outcomes.find((r) => r.kind === 'failed');
      expect(rejected?.kind === 'failed' && rejected.error.code).toBe(
        'invalid_configuration'
      );
      expect(
        rejected?.kind === 'failed' && rejected.error.developerMessage
      ).toContain('already presented');
      // Exactly one native sheet.
      expect(mock.__calls.presentPaymentSheet).toHaveLength(1);
    });

    it('clears the presenting flag when the native rejects', async () => {
      await init(initOptions());
      mock.__nextReject(new Error('native exploded'));

      await expect(presentPaymentSheet(presentOptions())).rejects.toThrow(
        'native exploded'
      );
      expect(inspectStateForTests().presenting).toBe(false);
    });

    it('surfaces every native rejection as a UqpayConfigurationError', async () => {
      await init(initOptions());

      mock.__nextReject(new Error('native exploded'));
      await expect(
        presentPaymentSheet(presentOptions())
      ).rejects.toBeInstanceOf(UqpayConfigurationError);

      mock.__nextReject(
        Object.assign(new Error('not ready'), { code: 'not_initialized' })
      );
      await expect(presentPaymentSheet(presentOptions())).rejects.toMatchObject(
        {
          name: 'UqpayConfigurationError',
          code: 'not_initialized',
          message: 'not ready',
        }
      );

      mock.__nextReject(
        Object.assign(new Error('wrong os'), { code: 'unsupported_platform' })
      );
      await expect(presentPaymentSheet(presentOptions())).rejects.toMatchObject(
        { code: 'unsupported_platform' }
      );

      mock.__nextReject({ code: 'E_WEIRD' });
      await expect(presentPaymentSheet(presentOptions())).rejects.toMatchObject(
        {
          code: 'invalid_configuration',
          message: 'The UQPAY native module rejected the call.',
        }
      );

      mock.__nextReject(null);
      await expect(presentPaymentSheet(presentOptions())).rejects.toMatchObject(
        { code: 'invalid_configuration' }
      );
    });

    it('does not keep billing details once the sheet has settled', async () => {
      await init(initOptions());
      mock.__nextResult(pendingPayload(platform));
      const pending = await presentPaymentSheet({
        ...presentOptions(),
        ...(platform === 'android'
          ? { billingDetails: { firstName: 'Ada', email: 'ada@example.com' } }
          : {}),
      });

      mock.__nextResult(completedPayload(platform));
      if (pending.kind === 'pending') await pending.reconcile();

      // The re-present for reconcile() carries no customer data.
      expect(
        mock.__calls.presentPaymentSheet[1]?.billingDetails
      ).toBeUndefined();

      // A settled intent keeps nothing: reconcile() on it has nothing to re-present.
      mock.__nextResult(pendingPayload(platform));
      const again = await presentPaymentSheet(presentOptions());
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      await expect(
        again.kind === 'pending' ? again.reconcile() : Promise.resolve(null)
      ).rejects.toMatchObject({ code: 'invalid_configuration' });
    });

    it('passes cancelPaymentSheet and notifyReturnedFromBank through to native', async () => {
      await init(initOptions());
      await cancelPaymentSheet();
      notifyReturnedFromBank();

      expect(mock.__calls.cancelPaymentSheet).toHaveLength(1);
      expect(mock.__calls.notifyReturnedFromBank).toHaveLength(1);
    });

    it('maps presentation and options onto the native struct', async () => {
      await init(initOptions());
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(
        presentOptions(
          platform === 'android'
            ? {
                presentation: { singleWallet: 'grabpay' },
                allowedPaymentMethods: ['grabpay', 'card'],
                billingDetails: { firstName: 'Ada' },
                merchantDisplayName: 'Acme',
              }
            : { presentation: 'cardOnly', merchantDisplayName: 'Acme' }
        )
      );

      const sent = mock.__calls.presentPaymentSheet[0];
      expect(sent?.merchantDisplayName).toBe('Acme');
      if (platform === 'android') {
        expect(sent?.presentationMode).toBe('singleWallet');
        expect(sent?.singleWalletMethod).toBe('grabpay');
        expect(sent?.allowedPaymentMethods).toEqual(['grabpay', 'card']);
        expect(sent?.billingDetails).toEqual({ firstName: 'Ada' });
      } else {
        expect(sent?.presentationMode).toBe('cardOnly');
      }
    });

    it('defaults presentationMode to methodList', async () => {
      await init(initOptions());
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());

      expect(mock.__calls.presentPaymentSheet[0]?.presentationMode).toBe(
        'methodList'
      );
    });
  });

  describe('pending buffer and Metro reload (RN-CB6, RN-API9)', () => {
    it('getPendingResult returns the buffered result once, then null', async () => {
      await init(initOptions());
      mock.__pending(completedPayload(platform));

      const first = await getPendingResult();
      const second = await getPendingResult();

      expect(first?.kind).toBe('completed');
      expect(second).toBeNull();
    });

    it('getPendingResult returns null when nothing is buffered', async () => {
      await init(initOptions());
      await expect(getPendingResult()).resolves.toBeNull();
    });

    it('survives a Metro reload: reset JS state, re-init, collect the buffered result', async () => {
      await init(initOptions());
      mock.__pending(pendingPayload(platform));

      resetSdkPreservingNative();
      await init(initOptions());
      const result = await getPendingResult();

      expect(result?.kind).toBe('pending');
      expect(inspectStateForTests().lastPendingIntentId).toBe(INTENT);
    });

    it('records lastPendingIntentId only while the outcome is pending', async () => {
      await init(initOptions());
      mock.__nextResult(pendingPayload(platform));
      await presentPaymentSheet(presentOptions());
      expect(inspectStateForTests().lastPendingIntentId).toBe(INTENT);

      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      expect(inspectStateForTests().lastPendingIntentId).toBeNull();
    });
  });

  describe('pending.reconcile() (RN-CB3)', () => {
    it('answers from a paymentReconciled event that already arrived', async () => {
      await init(initOptions());
      mock.__nextResult(pendingPayload(platform));
      const pending = await presentPaymentSheet(presentOptions());
      expect(pending.kind).toBe('pending');

      mock.__emit(UQPAY_EVENT_PAYMENT_RECONCILED, completedPayload(platform));
      expect(inspectStateForTests().reconciledCount).toBe(1);

      const settled =
        pending.kind === 'pending' ? await pending.reconcile() : null;

      expect(settled?.kind).toBe('completed');
      // Answered from the buffer: no second sheet.
      expect(mock.__calls.presentPaymentSheet).toHaveLength(1);
      expect(inspectStateForTests().reconciledCount).toBe(0);
    });

    it('re-presents the same intent when no event has arrived', async () => {
      await init(initOptions());
      mock.__nextResult(pendingPayload(platform));
      const pending = await presentPaymentSheet(presentOptions());

      mock.__nextResult(completedPayload(platform));
      const settled =
        pending.kind === 'pending' ? await pending.reconcile() : null;

      expect(settled?.kind).toBe('completed');
      expect(mock.__calls.presentPaymentSheet).toHaveLength(2);
      expect(mock.__calls.presentPaymentSheet[1]?.paymentIntentId).toBe(INTENT);
    });

    it('explains itself when the original options are gone (post-reload)', async () => {
      await init(initOptions());
      mock.__pending(pendingPayload(platform));
      const pending = await getPendingResult();

      await expect(
        pending?.kind === 'pending'
          ? pending.reconcile()
          : Promise.resolve(null)
      ).rejects.toMatchObject({ code: 'invalid_configuration' });
    });
  });

  describe('token bridge (RN-ERR8, RN-SEC7)', () => {
    it('answers uqpay_tokenRequested with provideToken', async () => {
      await init(initOptions());
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      await flushMicrotasks();

      expect(mock.__calls.provideToken).toHaveLength(1);
      expect(mock.__calls.provideToken[0]?.authToken).toBe(
        mock.__sentinelToken
      );
      expect(mock.__calls.provideToken[0]?.expiresAtEpochMs).toBe(1_800_000);
      expect(mock.__calls.failToken).toHaveLength(0);
    });

    it('sends -1 when the merchant does not say when the token expires', async () => {
      await init(
        initOptions({
          tokenProvider: () => Promise.resolve({ authToken: 't0ken' }),
        })
      );
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      await flushMicrotasks();

      expect(mock.__calls.provideToken[0]?.expiresAtEpochMs).toBe(-1);
      // One developer warning, and it never carries the token.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('expiresAt');
      expect(String(warn.mock.calls[0]?.[0])).not.toContain('t0ken');
      warn.mockRestore();
    });

    it('calls the provider before every present (RN-PAR6)', async () => {
      await init(initOptions());
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      await flushMicrotasks();

      expect(mock.__calls.provideToken).toHaveLength(2);
    });

    it('fails the token request when the provider throws', async () => {
      mock.__tokenBehaviour('throw');
      await init(initOptions());
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      await flushMicrotasks();

      expect(mock.__calls.provideToken).toHaveLength(0);
      expect(mock.__calls.failToken[0]?.developerMessage).toContain(
        'tokenProvider threw'
      );
    });

    it('flattens and caps what a throwing provider said before it reaches native', async () => {
      await init(
        initOptions({
          tokenProvider: () =>
            Promise.reject(
              new Error(
                `boom\r\n[uqpay] FAKE: payment SUCCEEDED${'x'.repeat(500)}`
              )
            ),
        })
      );
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      await flushMicrotasks();

      const message = mock.__calls.failToken[0]?.developerMessage ?? '';
      expect(message).not.toMatch(/[\r\n]/);
      expect(message).toContain('boom [uqpay] FAKE');
      expect(message.length).toBeLessThan(300);
      expect(message).toContain('…');
    });

    it('fails the token request when the provider returns a blank token', async () => {
      mock.__tokenBehaviour('blank');
      await init(initOptions());
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      await flushMicrotasks();

      expect(mock.__calls.failToken[0]?.developerMessage).toContain(
        'blank or missing'
      );
    });

    it('fails the token request when the provider returns a non-object', async () => {
      await init(
        initOptions({
          tokenProvider: () =>
            Promise.resolve(
              null as unknown as { authToken: string; expiresAt?: number }
            ),
        })
      );
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      await flushMicrotasks();

      expect(mock.__calls.failToken).toHaveLength(1);
    });

    it('reports a non-Error throw without inventing a message', async () => {
      await init(
        initOptions({ tokenProvider: () => Promise.reject('plain string') })
      );
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      await flushMicrotasks();

      expect(mock.__calls.failToken[0]?.developerMessage).toContain(
        'plain string'
      );
    });

    it('reports a thrown non-Error, non-string value safely', async () => {
      await init(
        initOptions({ tokenProvider: () => Promise.reject({ nope: true }) })
      );
      mock.__nextResult(completedPayload(platform));
      await presentPaymentSheet(presentOptions());
      await flushMicrotasks();

      expect(mock.__calls.failToken[0]?.developerMessage).toContain(
        'non-Error value'
      );
    });

    it('does not time out a hanging provider itself — native owns the 10 s budget', async () => {
      mock.__tokenBehaviour('hang');
      await init(initOptions());
      mock.__nextResult({
        kind: 'failed',
        paymentIntentId: INTENT,
        error: {
          code: 'authentication_failed',
          developerMessage: 'native token broker timed out after 10 s',
          isOutcomeUnknown: false,
        },
        platform,
        resultId: 'res-token-timeout',
      });

      const result = await presentPaymentSheet(presentOptions());
      await flushMicrotasks();

      // JS never answered and never gave up; the native produced the outcome.
      expect(mock.__calls.provideToken).toHaveLength(0);
      expect(mock.__calls.failToken).toHaveLength(0);
      expect(result.kind === 'failed' && result.error.code).toBe(
        'authentication_failed'
      );
    });

    it('fails the token request when no provider is registered', async () => {
      // The defensive branch: native asked for a token but JS was reloaded and
      // has not re-registered a provider yet.
      resetSdkPreservingNative();
      await handleTokenRequest({ requestId: 'req-orphan', reason: 'present' });

      expect(mock.__calls.provideToken).toHaveLength(0);
      expect(mock.__calls.failToken[0]?.developerMessage).toContain(
        'No tokenProvider is registered'
      );
    });
  });

  describe('events (RN-API8, RN-TEST8)', () => {
    it('delivers paymentReconciled and requiresAction with typed payloads', async () => {
      await init(initOptions());
      const events: PaymentEvent[] = [];
      const subscription = addPaymentListener((event) => events.push(event));

      mock.__emit(UQPAY_EVENT_PAYMENT_RECONCILED, completedPayload(platform));
      mock.__emit(UQPAY_EVENT_REQUIRES_ACTION, {
        type: 'authenticate3DS',
        url: 'https://acs.example/challenge',
      });
      mock.__emit(UQPAY_EVENT_REQUIRES_ACTION, { type: 'scanQRCode' });

      subscription.remove();

      expect(events).toHaveLength(3);
      expect(events[0]?.type).toBe('paymentReconciled');
      expect(
        events[0]?.type === 'paymentReconciled' && events[0].result.kind
      ).toBe('completed');
      expect(events[1]?.type === 'requiresAction' && events[1].action.url).toBe(
        'https://acs.example/challenge'
      );
      expect(
        events[2]?.type === 'requiresAction' && events[2].action.url
      ).toBeUndefined();
    });

    it('falls back to a custom action type for a payload without one', async () => {
      await init(initOptions());
      const events: PaymentEvent[] = [];
      const subscription = addPaymentListener((event) => events.push(event));

      mock.__emit(UQPAY_EVENT_REQUIRES_ACTION, {});
      subscription.remove();

      expect(
        events[0]?.type === 'requiresAction' && events[0].action.type
      ).toBe('custom');
    });

    it('leaves no native subscriptions behind after remove() (RN-TEST8)', async () => {
      await init(initOptions());
      const baseline = mock.__listenerCount();

      const subscription = addPaymentListener(() => undefined);
      expect(mock.__listenerCount()).toBe(baseline + 2);

      subscription.remove();
      subscription.remove();

      expect(mock.__listenerCount()).toBe(baseline);
    });

    it('stops delivering events after remove()', async () => {
      await init(initOptions());
      const seen: PaymentEvent[] = [];
      const subscription = addPaymentListener((event) => seen.push(event));
      subscription.remove();

      mock.__emit(UQPAY_EVENT_PAYMENT_RECONCILED, completedPayload(platform));

      expect(seen).toHaveLength(0);
    });

    it('does not swallow a throwing listener (RN-CB4)', async () => {
      await init(initOptions());
      const subscription = addPaymentListener(() => {
        throw new Error('merchant listener blew up');
      });

      expect(() => {
        mock.__emit(UQPAY_EVENT_PAYMENT_RECONCILED, completedPayload(platform));
      }).toThrow('merchant listener blew up');

      subscription.remove();
    });
  });

  describe('useUqpay (RN-API8)', () => {
    it('returns the same stable callbacks on every call and adds no capability', () => {
      const first = useUqpay();
      const second = useUqpay();

      expect(first).toBe(second);
      expect(first.presentPaymentSheet).toBe(presentPaymentSheet);
      expect(first.cancelPaymentSheet).toBe(cancelPaymentSheet);
      expect(first.getPendingResult).toBe(getPendingResult);
      expect(Object.keys(first).sort()).toEqual([
        'cancelPaymentSheet',
        'getPendingResult',
        'presentPaymentSheet',
      ]);
    });
  });
});

/** Drop the JS-side state the way a Metro reload does, leaving the mock alone. */
function resetSdkPreservingNative(): void {
  resetForTests();
}

/** Let queued promise callbacks run. No timers: the SDK never uses them. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('native module lookup', () => {
  const registry = NativeModules as Record<string, unknown>;

  beforeEach(() => {
    resetSdk('ios');
    // As if the binary had no `Uqpay` module at import time.
    setNativeModuleForTests(null);
    delete registry.Uqpay;
  });

  afterEach(() => {
    setNativeModuleForTests(mock);
    registry.Uqpay = mock;
  });

  it('importing the SDK never throws, and a call explains what is missing', async () => {
    await expect(init(initOptions())).rejects.toMatchObject({
      name: 'UqpayConfigurationError',
      code: 'invalid_configuration',
      message: expect.stringContaining('not in this app binary'),
    });
    await expect(getPendingResult()).rejects.toMatchObject({
      code: 'invalid_configuration',
    });
    expect(mock.__calls.initialize).toHaveLength(0);
  });

  it('finds a module registered after import (the Jest helper path)', async () => {
    const late = createUqpayNativeMock();
    registry.Uqpay = late;

    await init(initOptions({ tokenProvider: late.tokenProvider }));

    expect(late.__calls.initialize).toHaveLength(1);
    expect(mock.__calls.initialize).toHaveLength(0);
  });
});
