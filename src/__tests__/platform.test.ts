/**
 * AC RN-COMPAT6, RN-INT9 — the only platform branch in the SDK.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import { Platform } from 'react-native';
import { init } from '../client';
import {
  assertSupportedPlatform,
  currentPlatformOS,
  detectExpoGo,
} from '../platform';
import { initOptions, resetSdk } from './helpers';

type MutableGlobal = Record<string, unknown>;

function setPlatformOS(os: string): void {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

afterEach(() => {
  resetSdk('ios');
  const g = globalThis as MutableGlobal;
  delete g.expo;
  delete g.__expo;
  delete g.__expo_go__;
  delete g.ExpoGo;
});

describe('supported platforms (RN-COMPAT6)', () => {
  it.each(['ios', 'android'])('accepts %s', (os) => {
    setPlatformOS(os);
    expect(assertSupportedPlatform()).toBe(os);
    expect(currentPlatformOS()).toBe(os);
  });

  it.each(['web', 'macos', 'windows'])('rejects %s by name', (os) => {
    setPlatformOS(os);
    expect(() => assertSupportedPlatform()).toThrow(new RegExp(`"${os}"`));
    expect(() => assertSupportedPlatform()).toThrow(/iOS and Android only/);
  });

  it('rejects init on an unsupported platform', async () => {
    setPlatformOS('web');
    resetSdk('ios');
    setPlatformOS('web');
    await expect(init(initOptions())).rejects.toMatchObject({
      code: 'unsupported_platform',
    });
  });
});

describe('Expo Go detection (RN-INT9)', () => {
  it('returns null on a bare app', () => {
    expect(detectExpoGo()).toBeNull();
  });

  it.each([
    [
      'globalThis.expo.modules.ExpoGo',
      () => {
        (globalThis as MutableGlobal).expo = { modules: { ExpoGo: {} } };
      },
    ],
    [
      'globalThis.__expo.modules.ExpoGo',
      () => {
        (globalThis as MutableGlobal).__expo = { modules: { ExpoGo: {} } };
      },
    ],
    [
      'executionEnvironment storeClient',
      () => {
        (globalThis as MutableGlobal).expo = {
          modules: {
            ExponentConstants: { executionEnvironment: 'storeClient' },
          },
        };
      },
    ],
    [
      'appOwnership expo',
      () => {
        (globalThis as MutableGlobal).expo = {
          modules: { ExponentConstants: { appOwnership: 'expo' } },
        };
      },
    ],
    [
      'globalThis.__expo_go__',
      () => {
        (globalThis as MutableGlobal).__expo_go__ = true;
      },
    ],
    [
      'globalThis.ExpoGo',
      () => {
        (globalThis as MutableGlobal).ExpoGo = true;
      },
    ],
  ])('detects Expo Go via %s', (_marker, install) => {
    install();
    expect(detectExpoGo()).not.toBeNull();
    expect(() => assertSupportedPlatform()).toThrow(/Expo Go/);
  });

  it('ignores an Expo dev client (executionEnvironment "standalone")', () => {
    (globalThis as MutableGlobal).expo = {
      modules: { ExponentConstants: { executionEnvironment: 'standalone' } },
    };
    expect(detectExpoGo()).toBeNull();
  });

  it('rejects init inside Expo Go, naming Expo Go', async () => {
    resetSdk('ios');
    (globalThis as MutableGlobal).expo = { modules: { ExpoGo: {} } };
    await expect(init(initOptions())).rejects.toMatchObject({
      code: 'unsupported_platform',
    });
    await expect(init(initOptions())).rejects.toThrow(/Expo Go/);
  });
});
