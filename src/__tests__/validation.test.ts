/**
 * AC RN-ERR7, RN-SEC4, RN-UX11, §14 — call-time validation. Every message must
 * name the exact field, and every rejection must happen before anything
 * crosses the bridge.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import mock from '../jest';
import { init, presentPaymentSheet } from '../client';
import { UqpayConfigurationError } from '../errors/configurationError';
import { validateInitOptions, validatePresentOptions } from '../validation';
import type { Appearance, InitOptions, PresentOptions } from '../types';
import {
  PLATFORMS,
  initOptions,
  presentOptions,
  resetSdk,
  type TestPlatform,
} from './helpers';

function expectConfigError(run: () => void, field: RegExp): void {
  expect(run).toThrow(UqpayConfigurationError);
  expect(run).toThrow(field);
}

describe('init validation (RN-ERR7)', () => {
  beforeEach(() => {
    resetSdk('android');
  });

  it('rejects a non-object options argument', () => {
    expectConfigError(() => {
      validateInitOptions(null as unknown as InitOptions);
    }, /options object/);
  });

  it.each([
    [
      'environment',
      { environment: 'staging' } as unknown as Partial<InitOptions>,
      /environment/,
    ],
    ['clientId', { clientId: '   ' }, /clientId/],
    [
      'tokenProvider',
      { tokenProvider: undefined } as unknown as Partial<InitOptions>,
      /tokenProvider/,
    ],
    [
      'debugLogging',
      { debugLogging: 'yes' } as unknown as Partial<InitOptions>,
      /debugLogging/,
    ],
  ])('names %s in the message', (_field, overrides, matcher) => {
    expectConfigError(() => {
      validateInitOptions(initOptions(overrides as Partial<InitOptions>));
    }, matcher as RegExp);
  });

  it.each([
    ['a line break (header injection)', 'ck_test\r\nx-evil: 1'],
    ['a space', 'ck test'],
    ['a tab', 'ck\ttest'],
    ['a non-ASCII character', 'ck_tést'],
  ])('rejects a clientId containing %s', (_why, clientId) => {
    expectConfigError(() => {
      validateInitOptions(initOptions({ clientId }));
    }, /clientId must be your UQPAY client id/);
  });

  it('accepts a realistic clientId', () => {
    expect(() => {
      validateInitOptions(initOptions({ clientId: 'ck_live_AbC-123.x' }));
    }).not.toThrow();
  });

  it('rejects init before anything reaches native', async () => {
    await expect(init(initOptions({ clientId: '' }))).rejects.toMatchObject({
      code: 'invalid_configuration',
    });
    expect(mock.__calls.initialize).toHaveLength(0);
  });

  describe('appearance (RN-UX11)', () => {
    it('accepts 6- and 8-digit hex colours and a zero corner radius', () => {
      expect(() => {
        validateInitOptions(
          initOptions({
            appearance: {
              colorMode: 'light',
              primaryColor: '#0A84FF',
              backgroundColor: '#0A84FFCC',
              cornerRadius: 0,
              ios: {},
              android: {},
            },
          })
        );
      }).not.toThrow();
    });

    it.each([
      [
        'appearance itself',
        'not-an-object' as unknown as Appearance,
        /appearance must be an object/,
      ],
      [
        'appearance.colorMode',
        { colorMode: 'neon' } as unknown as Appearance,
        /colorMode/,
      ],
      [
        'appearance.primaryColor',
        { primaryColor: 'red' } as Appearance,
        /primaryColor/,
      ],
      [
        'appearance.primaryColor short hex',
        { primaryColor: '#fff' } as Appearance,
        /primaryColor/,
      ],
      [
        'appearance.backgroundColor',
        { backgroundColor: '#12345' } as Appearance,
        /backgroundColor/,
      ],
      [
        'appearance.surfaceColor',
        { surfaceColor: '' } as Appearance,
        /surfaceColor/,
      ],
      [
        'appearance.textColor',
        { textColor: '#GGGGGG' } as Appearance,
        /textColor/,
      ],
      [
        'appearance.secondaryTextColor',
        { secondaryTextColor: '#12' } as Appearance,
        /secondaryTextColor/,
      ],
      [
        'appearance.errorColor',
        { errorColor: '#1234567' } as Appearance,
        /errorColor/,
      ],
      [
        'appearance.cornerRadius',
        { cornerRadius: -1 } as Appearance,
        /cornerRadius/,
      ],
      [
        'appearance.cornerRadius type',
        { cornerRadius: '12' } as unknown as Appearance,
        /cornerRadius/,
      ],
      [
        'appearance.ios',
        { ios: ['#000000'] } as unknown as Appearance,
        /appearance\.ios/,
      ],
      [
        'appearance.ios value',
        { ios: { primary: 'blue' } } as Appearance,
        /appearance\.ios\.primary/,
      ],
      [
        'appearance.android.light',
        { android: { light: { primary: 'blue' } } } as Appearance,
        /appearance\.android\.light\.primary/,
      ],
      [
        'appearance.android.dark',
        { android: { dark: { primary: 'blue' } } } as Appearance,
        /appearance\.android\.dark\.primary/,
      ],
    ])('names %s', (_label, appearance, matcher) => {
      expectConfigError(() => {
        validateInitOptions(
          initOptions({ appearance: appearance as Appearance })
        );
      }, matcher as RegExp);
    });

    it('rejects a NaN corner radius', () => {
      expectConfigError(() => {
        validateInitOptions(initOptions({ appearance: { cornerRadius: NaN } }));
      }, /cornerRadius/);
    });
  });
});

describe.each(PLATFORMS)(
  'present validation on %s (RN-ERR7, RN-SEC4)',
  (platform: TestPlatform) => {
    beforeEach(() => {
      resetSdk(platform);
    });

    it('rejects a non-object options argument', () => {
      expectConfigError(() => {
        validatePresentOptions(null as unknown as PresentOptions, platform);
      }, /options object/);
    });

    it.each([
      ['paymentIntentId', { paymentIntentId: '' }, /paymentIntentId/],
      [
        'paymentIntentId (path traversal)',
        { paymentIntentId: '../../refunds' },
        /paymentIntentId must be the id/,
      ],
      [
        'paymentIntentId (query string)',
        { paymentIntentId: 'PI1?expand=all' },
        /paymentIntentId must be the id/,
      ],
      [
        'paymentIntentId (encoded slash)',
        { paymentIntentId: 'PI1%2Frefunds' },
        /paymentIntentId must be the id/,
      ],
      [
        'paymentIntentId (too long)',
        { paymentIntentId: 'P'.repeat(129) },
        /paymentIntentId must be the id/,
      ],
      ['returnUrl', { returnUrl: '  ' }, /returnUrl/],
      [
        'merchantDisplayName',
        { merchantDisplayName: '' },
        /merchantDisplayName/,
      ],
    ])('names %s in the message', (_field, overrides, matcher) => {
      expectConfigError(() => {
        validatePresentOptions(presentOptions(overrides), platform);
      }, matcher as RegExp);
    });

    it('rejects a plain-HTTP returnUrl (RN-SEC4)', () => {
      expectConfigError(() => {
        validatePresentOptions(
          presentOptions({
            returnUrl: ['ht', 'tp://merchant.example/return'].join(''),
          }),
          platform
        );
      }, /plain, unencrypted HTTP/);
    });

    it('accepts an https returnUrl and a custom scheme', () => {
      for (const returnUrl of [
        'https://merchant.example/return',
        'myapp://pay',
      ]) {
        expect(() => {
          validatePresentOptions(presentOptions({ returnUrl }), platform);
        }).not.toThrow();
      }
    });

    it('rejects an empty allowedPaymentMethods array (§14)', () => {
      expectConfigError(() => {
        validatePresentOptions(
          presentOptions({ allowedPaymentMethods: [] }),
          platform
        );
      }, /allowedPaymentMethods must not be empty/);
    });

    it('rejects a non-array allowedPaymentMethods', () => {
      expectConfigError(() => {
        validatePresentOptions(
          presentOptions({
            allowedPaymentMethods: 'grabpay' as unknown as string[],
          }),
          platform
        );
      }, /allowedPaymentMethods must be an array/);
    });

    it('rejects an unknown presentation value', () => {
      expectConfigError(() => {
        validatePresentOptions(
          presentOptions({
            presentation: 'fullscreen' as unknown as 'cardOnly',
          }),
          platform
        );
      }, /presentation must be/);
    });

    it('rejects singleWallet: "card"', () => {
      expectConfigError(() => {
        validatePresentOptions(
          presentOptions({ presentation: { singleWallet: 'card' } }),
          platform
        );
      }, /not "card"/);
    });

    it('rejects a blank singleWallet method', () => {
      expectConfigError(() => {
        validatePresentOptions(
          presentOptions({ presentation: { singleWallet: '' } }),
          platform
        );
      }, /presentation\.singleWallet/);
    });

    it('rejects a blank entry in allowedPaymentMethods', () => {
      expectConfigError(() => {
        validatePresentOptions(
          presentOptions({ allowedPaymentMethods: ['grabpay', ''] }),
          'android'
        );
      }, /allowedPaymentMethods\[1\]/);
    });

    it.each([
      [
        'a non-object',
        'nope' as unknown as PresentOptions['billingDetails'],
        /billingDetails must be an object/,
      ],
      [
        'a non-string field',
        { firstName: 7 } as unknown as PresentOptions['billingDetails'],
        /billingDetails\.firstName/,
      ],
    ])(
      'rejects billingDetails that is %s',
      (_label, billingDetails, matcher) => {
        expectConfigError(() => {
          validatePresentOptions(presentOptions({ billingDetails }), 'android');
        }, matcher as RegExp);
      }
    );

    it('accepts billingDetails with undefined fields', () => {
      expect(() => {
        validatePresentOptions(
          presentOptions({
            billingDetails: { firstName: 'Ada', lastName: undefined },
          }),
          'android'
        );
      }).not.toThrow();
    });

    it('rejects before anything reaches native', async () => {
      await init(initOptions());
      await expect(
        presentPaymentSheet(presentOptions({ paymentIntentId: '' }))
      ).rejects.toMatchObject({ code: 'invalid_configuration' });
      expect(mock.__calls.presentPaymentSheet).toHaveLength(0);
    });
  }
);

describe('iOS-only limitations (§14, §16-DEP7)', () => {
  beforeEach(() => {
    resetSdk('ios');
  });

  it('rejects presentation.singleWallet on iOS with invalid_configuration', () => {
    expectConfigError(() => {
      validatePresentOptions(
        presentOptions({ presentation: { singleWallet: 'grabpay' } }),
        'ios'
      );
    }, /singleWallet is not supported by the iOS native SDK/);
  });

  it('rejects allowedPaymentMethods on iOS with invalid_configuration', () => {
    expectConfigError(() => {
      validatePresentOptions(
        presentOptions({ allowedPaymentMethods: ['card'] }),
        'ios'
      );
    }, /allowedPaymentMethods is not supported by the iOS native SDK/);
  });

  it('warns once about billingDetails on iOS instead of rejecting', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    expect(() => {
      validatePresentOptions(
        presentOptions({ billingDetails: { firstName: 'Ada' } }),
        'ios'
      );
      validatePresentOptions(
        presentOptions({ billingDetails: { firstName: 'Ada' } }),
        'ios'
      );
    }).not.toThrow();

    expect(warn.mock.calls).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'billingDetails is ignored on iOS'
    );
    warn.mockRestore();
  });

  it('accepts singleWallet and allowedPaymentMethods on Android', () => {
    expect(() => {
      validatePresentOptions(
        presentOptions({
          presentation: { singleWallet: 'grabpay' },
          allowedPaymentMethods: ['grabpay'],
          billingDetails: { firstName: 'Ada' },
        }),
        'android'
      );
    }).not.toThrow();
  });
});
