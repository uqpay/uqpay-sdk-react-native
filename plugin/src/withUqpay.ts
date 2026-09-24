/**
 * Expo config plugin for `@uqpay/react-native`.
 *
 * The only native configuration the SDK needs is the iOS URL scheme the 3DS
 * (ACS) hand-off returns to. The plugin registers that scheme in
 * `CFBundleURLTypes` so `Linking` delivers the return URL and the app can call
 * `notifyReturnedFromBank()`.
 *
 * Android needs nothing: the Android native SDK handles the bank return inside
 * its own Activity, so the plugin leaves the Android config untouched.
 *
 * This file must not import anything from `src/` — it runs under Node during
 * `expo prebuild`, never in the app bundle — and `@expo/config-plugins` is an
 * optional peer dependency reached only through `app.plugin.js`, so bare React
 * Native apps never need Expo installed.
 *
 * @packageDocumentation
 */
import { createRunOncePlugin, withInfoPlist } from '@expo/config-plugins';
import type { ConfigPlugin, InfoPlist } from '@expo/config-plugins';

/**
 * `ExpoConfig` without importing `@expo/config-types` directly: the plugin
 * depends on exactly one package, `@expo/config-plugins`.
 */
type ExpoConfig = Parameters<ConfigPlugin>[0];

/** Options accepted from `app.json` / `app.config.js`. */
export interface UqpayPluginProps {
  /**
   * URL scheme registered for the 3DS return URL. Defaults to the app's own
   * `scheme` (the first entry when it is an array), then to
   * `ios.bundleIdentifier`.
   */
  iosUrlScheme?: string;
}

/**
 * `CFBundleURLName` of the entry this plugin owns. It is the idempotency key:
 * a second run finds this name and leaves the plist alone.
 */
export const UQPAY_URL_NAME = 'com.uqpay.return';

/** One `CFBundleURLTypes` entry, as `@expo/config-plugins` models it. */
type UrlTypeEntry = NonNullable<InfoPlist['CFBundleURLTypes']>[number];

/**
 * Resolves the scheme to register, in the documented precedence order.
 *
 * @returns the scheme, or `undefined` when the app declares none.
 */
export function resolveIosUrlScheme(
  config: ExpoConfig,
  props?: UqpayPluginProps
): string | undefined {
  const explicit = props?.iosUrlScheme;
  if (typeof explicit === 'string' && explicit.length > 0) {
    return explicit;
  }

  const scheme = config.scheme;
  if (typeof scheme === 'string' && scheme.length > 0) {
    return scheme;
  }
  if (Array.isArray(scheme)) {
    const first = scheme.find(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0
    );
    if (first !== undefined) {
      return first;
    }
  }

  const bundleIdentifier = config.ios?.bundleIdentifier;
  if (typeof bundleIdentifier === 'string' && bundleIdentifier.length > 0) {
    return bundleIdentifier;
  }

  return undefined;
}

/**
 * Adds the return-URL scheme to an `Info.plist` object, once. The entry this
 * plugin owns (named `UQPAY_URL_NAME`) is rewritten to the current scheme, so
 * changing `iosUrlScheme` never leaves a stale scheme registered.
 *
 * Exported for the unit tests; the plugin below is the public surface.
 *
 * @returns the same object, mutated in place (the plist mod contract).
 */
export function addUqpayUrlScheme(
  infoPlist: InfoPlist,
  scheme: string
): InfoPlist {
  const urlTypes: UrlTypeEntry[] = Array.isArray(infoPlist.CFBundleURLTypes)
    ? (infoPlist.CFBundleURLTypes as UrlTypeEntry[])
    : [];

  const registeredElsewhere = urlTypes.some(
    (entry) =>
      entry?.CFBundleURLName !== UQPAY_URL_NAME &&
      Array.isArray(entry?.CFBundleURLSchemes) &&
      entry.CFBundleURLSchemes.includes(scheme)
  );
  // Drop our own entry and add it back fresh: a renamed scheme replaces the
  // old one instead of sitting next to it.
  const others = urlTypes.filter(
    (entry) => entry?.CFBundleURLName !== UQPAY_URL_NAME
  );
  if (!registeredElsewhere) {
    others.push({
      CFBundleURLName: UQPAY_URL_NAME,
      CFBundleURLSchemes: [scheme],
    });
  }

  infoPlist.CFBundleURLTypes = others;
  return infoPlist;
}

/**
 * Whether the "no scheme" warning has already been printed in this
 * `expo prebuild` process. Exported so the unit tests can run the plugin twice
 * and still observe the once-only behaviour.
 *
 * @returns nothing; it resets the module-level latch.
 */
export function resetMissingSchemeWarning(): void {
  warnedAboutMissingScheme = false;
}

let warnedAboutMissingScheme = false;

/**
 * The plugin body: one iOS `Info.plist` mod, nothing on Android.
 *
 * @param config - the Expo config being built.
 * @param props - optional `{@link UqpayPluginProps}` from `app.json`.
 * @returns the config with the iOS `infoPlist` mod appended.
 */
export function withUqpay(
  config: ExpoConfig,
  props?: UqpayPluginProps
): ExpoConfig {
  return withInfoPlist(config, (modConfig) => {
    const scheme = resolveIosUrlScheme(modConfig, props);

    // No scheme anywhere: prebuild has nothing to register. Leave the plist as
    // it is rather than inventing a scheme, but say so once — a silent no-op
    // here surfaces much later as a 3DS challenge that never returns.
    if (scheme === undefined) {
      if (!warnedAboutMissingScheme) {
        warnedAboutMissingScheme = true;
        console.warn(
          '[@uqpay/react-native] No iOS URL scheme could be resolved, so no 3DS return URL was ' +
            'registered in Info.plist. Set `scheme` or `ios.bundleIdentifier` in your app config, ' +
            'or pass the `iosUrlScheme` prop to this plugin: ' +
            '["@uqpay/react-native", { "iosUrlScheme": "myapp" }].'
        );
      }
      return modConfig;
    }

    addUqpayUrlScheme(modConfig.modResults, scheme);
    return modConfig;
  });
}

// The plugin is emitted as CommonJS and runs under Node, so the package
// metadata `createRunOncePlugin` needs is read with `require` rather than an
// import (keeping `package.json` out of the plugin's `rootDir`).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../../package.json') as {
  name: string;
  version: string;
};

export default createRunOncePlugin(withUqpay, pkg.name, pkg.version);
