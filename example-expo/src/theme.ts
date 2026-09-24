/**
 * App palette + the `Appearance` presets the theming toggle feeds to `init`.
 *
 * `appearance` is an **init-time** option, not a present-time one: the Android
 * native binds it to `UQPayConfiguration` when the SDK is initialised, so
 * changing the theme means calling `init` again (AC §2.1 note, RN-UX2). The
 * Home screen's toggle does exactly that and says so on screen — including
 * the side effect a merchant must know about: re-`init` with a *different*
 * config rebuilds Android's `TokenManager` and drops its cached token
 * (RN-IDEM1), so the next present asks the `tokenProvider` again.
 */

import type { Appearance } from './uqpay';

export const ui = {
  bg: '#0f1115',
  card: '#181b22',
  cardAlt: '#1f232c',
  border: '#2b303b',
  text: '#f2f4f8',
  textDim: '#9aa3b2',
  accent: '#4c8dff',
  success: '#3ecf8e',
  warning: '#f5b451',
  danger: '#ff5c5c',
  pending: '#a78bfa',
} as const;

export type ThemeName = 'system' | 'light' | 'dark' | 'brand';

/**
 * Four presets that exercise the documented `Appearance` fields. The
 * per-platform escape hatches (`iosExtras` / `androidExtras`) are left out on
 * purpose — the point of this screen is the cross-platform subset.
 */
export const APPEARANCE_PRESETS: Record<ThemeName, Appearance | undefined> = {
  // `undefined` = "don't send an appearance at all" — the native default.
  system: undefined,
  light: { colorMode: 'light' },
  dark: { colorMode: 'dark' },
  brand: {
    colorMode: 'system',
    primaryColor: '#4C8DFF',
    cornerRadius: 16,
  },
};

export const THEME_ORDER: ThemeName[] = ['system', 'light', 'dark', 'brand'];

export const THEME_LABELS: Record<ThemeName, string> = {
  system: 'System default',
  light: 'Force light',
  dark: 'Force dark',
  brand: 'Brand (blue, r16)',
};
