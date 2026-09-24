/**
 * Sample-app configuration.
 *
 * The app reads **three** variables, and only three:
 *
 *   UQPAY_ENVIRONMENT · UQPAY_CLIENT_ID · UQPAY_MERCHANT_BACKEND_URL
 *
 * They arrive through `env.generated.ts`, written by
 * `node example/scripts/gen-env.mjs` from `example/.env`. The merchant API key
 * is in the same `.env` file and is read **only** by `example/backend/` — a
 * test fails if any file under `example/src` even names it (AC RN-SEC3, D7).
 */

import { Platform } from 'react-native';

import {
  UQPAY_ENVIRONMENT,
  UQPAY_CLIENT_ID,
  UQPAY_MERCHANT_BACKEND_URL,
} from './env.generated';

/**
 * The 3DS / wallet return target. It must match the URL scheme registered by
 * the host app:
 *   iOS  — `example/ios/UqpayExample/Info.plist` → `CFBundleURLTypes`
 *   Expo — added automatically by the config plugin
 *   Android — nothing to configure
 */
export const RETURN_URL = 'uqpayexample://return';

export const environment: 'sandbox' | 'production' =
  UQPAY_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

export const clientId: string = UQPAY_CLIENT_ID;

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/**
 * An Android emulator cannot reach the host machine's `localhost` — that is
 * the emulator itself. `10.0.2.2` is the host loopback alias. This rewrite is
 * the single most common reason a first run "can't reach the backend".
 */
export function resolveBackendUrl(
  raw: string,
  os: string = Platform.OS
): { url: string; rewritten: boolean } {
  const trimmed = raw.replace(/\/$/, '');
  // Matched on the string rather than through `URL`, whose `hostname` is
  // read-only in React Native's URL polyfill types.
  const match = /^(https?:\/\/)([^/:]+)(.*)$/.exec(trimmed);
  if (match === undefined || match === null)
    return { url: trimmed, rewritten: false };

  const [, scheme = '', host = '', rest = ''] = match;
  if (os === 'android' && LOOPBACK.test(host)) {
    return { url: `${scheme}10.0.2.2${rest}`, rewritten: true };
  }
  return { url: trimmed, rewritten: false };
}

const resolved = resolveBackendUrl(UQPAY_MERCHANT_BACKEND_URL);

/** The merchant backend base URL, already corrected for the Android emulator. */
export const backendUrl: string = resolved.url;

/** True when we rewrote `localhost` → `10.0.2.2`; the Home screen says so. */
export const backendUrlRewritten: boolean = resolved.rewritten;

/** The value as written in `example/.env`, for the "before → after" hint. */
export const backendUrlConfigured: string = UQPAY_MERCHANT_BACKEND_URL;

/** True when `gen-env.mjs` has not seen a filled-in `.env` yet. */
export const isConfigured: boolean = clientId.trim() !== '';

/** Shown in the header. Production gets a loud red badge. */
export const isProduction: boolean = environment === 'production';
