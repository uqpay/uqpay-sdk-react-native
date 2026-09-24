/**
 * The only module in `src/` that reads `Platform.OS` (enforced by the source
 * tripwire test). Everything else asks this module, so there is exactly one
 * platform branch in the SDK.
 *
 * @internal
 */
import { Platform } from 'react-native';
import { UqpayConfigurationError } from './errors/configurationError';
import type { UqpayPlatform } from './types';

/**
 * The platform the SDK is running on, unvalidated.
 *
 * @internal
 */
export function currentPlatformOS(): string {
  return Platform.OS;
}

/**
 * Shape of the globals Expo installs. Declared locally so the SDK never
 * imports `expo` (which merchants on bare React Native do not have).
 */
type ExpoGlobal = {
  modules?: {
    ExpoGo?: unknown;
    ExponentConstants?: {
      executionEnvironment?: string;
      appOwnership?: string;
    };
  };
};

type MaybeExpoGlobalThis = {
  expo?: ExpoGlobal;
  __expo?: ExpoGlobal;
  __expo_go__?: unknown;
  ExpoGo?: unknown;
};

/**
 * Feature-detect Expo Go. We look, in order, at:
 *
 * 1. `globalThis.expo.modules.ExpoGo` — installed by the Expo Go client (SDK 50+),
 * 2. `globalThis.__expo.modules.ExpoGo` — the same object under its legacy name,
 * 3. `globalThis.expo.modules.ExponentConstants.executionEnvironment === 'storeClient'`
 *    and `appOwnership === 'expo'` — how Expo itself identifies the Go client,
 * 4. `globalThis.__expo_go__` / `globalThis.ExpoGo` — belt-and-braces flags.
 *
 * Nothing here imports `expo`, `expo-constants` or `NativeModules`, so the
 * check costs nothing on a bare app and cannot crash when Expo is absent.
 *
 * @returns the marker that matched, or `null` when this is not Expo Go
 * @internal
 */
export function detectExpoGo(): string | null {
  const g = globalThis as MaybeExpoGlobalThis;
  const expo = g.expo ?? g.__expo;

  if (expo?.modules?.ExpoGo != null) return 'globalThis.expo.modules.ExpoGo';

  const constants = expo?.modules?.ExponentConstants;
  if (constants?.executionEnvironment === 'storeClient') {
    return 'ExponentConstants.executionEnvironment === "storeClient"';
  }
  if (constants?.appOwnership === 'expo') {
    return 'ExponentConstants.appOwnership === "expo"';
  }
  if (g.__expo_go__ != null) return 'globalThis.__expo_go__';
  if (g.ExpoGo != null) return 'globalThis.ExpoGo';
  return null;
}

/**
 * Reject anything that is not a real iOS or Android app. Web, macOS, Windows and Expo Go all fail loudly here rather than
 * half-working later.
 *
 * @throws UqpayConfigurationError with `code: 'unsupported_platform'`
 * @internal
 */
export function assertSupportedPlatform(): UqpayPlatform {
  const os = currentPlatformOS();
  if (os !== 'ios' && os !== 'android') {
    throw new UqpayConfigurationError(
      'unsupported_platform',
      `@uqpay/react-native supports iOS and Android only; Platform.OS is "${os}". ` +
        'There is no web, macOS or Windows build.'
    );
  }

  const expoGo = detectExpoGo();
  if (expoGo !== null) {
    throw new UqpayConfigurationError(
      'unsupported_platform',
      'Expo Go cannot run @uqpay/react-native: it ships native code that Expo Go does not ' +
        `contain (detected via ${expoGo}). Use an Expo Dev Client or an EAS build ` +
        '(`npx expo run:ios` / `npx expo run:android`).'
    );
  }

  return os;
}
