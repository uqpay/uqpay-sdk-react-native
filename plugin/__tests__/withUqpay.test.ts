/**
 * Expo config plugin tests (AC RN-INT8, RN-BR7, RN-BR9, RN-DEP1).
 *
 * `@expo/config-plugins` ships no public test helper, so the tests apply the
 * plugin to a fake `ExpoConfig` and then invoke the registered
 * `mods.ios.infoPlist` function directly with a fake `modResults` — exactly
 * what `expo prebuild` does, minus the file system.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConfigPlugin,
  ExportedConfig,
  ExportedConfigWithProps,
  InfoPlist,
} from '@expo/config-plugins';
import {
  UQPAY_URL_NAME,
  resetMissingSchemeWarning,
  resolveIosUrlScheme,
  withUqpay,
} from '../src/withUqpay';

type ExpoConfig = Parameters<ConfigPlugin>[0];
type UrlTypes = NonNullable<InfoPlist['CFBundleURLTypes']>;

const PROJECT_ROOT = join(__dirname, '..', '..');

/** Minimal Expo config; `name` and `slug` are the only required fields. */
function makeConfig(extra: Partial<ExpoConfig> = {}): ExpoConfig {
  return { name: 'fixture', slug: 'fixture', ...extra };
}

/**
 * Runs the plugin's iOS `Info.plist` mod over `infoPlist`, the way the prebuild
 * mod compiler would.
 *
 * @returns the resulting `Info.plist` object.
 */
async function runIosInfoPlistMod(
  config: ExportedConfig,
  infoPlist: InfoPlist = {}
): Promise<InfoPlist> {
  const mod = config.mods?.ios?.infoPlist;
  if (typeof mod !== 'function') {
    throw new Error('the plugin registered no ios.infoPlist mod');
  }

  const modConfig: ExportedConfigWithProps<InfoPlist> = {
    ...config,
    modResults: infoPlist,
    modRawConfig: config,
    modRequest: {
      projectRoot: PROJECT_ROOT,
      platformProjectRoot: join(PROJECT_ROOT, 'ios'),
      modName: 'infoPlist',
      platform: 'ios',
      introspect: false,
    },
  };

  const result = await mod(modConfig);
  return result.modResults;
}

/** The entries this plugin owns. */
function uqpayEntries(infoPlist: InfoPlist): UrlTypes {
  return (infoPlist.CFBundleURLTypes ?? []).filter(
    (entry) => entry.CFBundleURLName === UQPAY_URL_NAME
  );
}

describe('withUqpay — iOS 3DS return URL scheme (RN-INT8, RN-BR7)', () => {
  it('adds the return URL scheme to CFBundleURLTypes exactly once', async () => {
    const config = withUqpay(makeConfig({ scheme: 'fixtureapp' }));
    const infoPlist = await runIosInfoPlistMod(config);

    expect(infoPlist.CFBundleURLTypes).toEqual([
      { CFBundleURLName: UQPAY_URL_NAME, CFBundleURLSchemes: ['fixtureapp'] },
    ]);
  });

  it('does not duplicate the entry when prebuild runs a second time', async () => {
    const config = withUqpay(makeConfig({ scheme: 'fixtureapp' }));
    const firstRun = await runIosInfoPlistMod(config);
    const secondRun = await runIosInfoPlistMod(config, firstRun);

    expect(uqpayEntries(secondRun)).toHaveLength(1);
    expect(secondRun.CFBundleURLTypes).toHaveLength(1);
  });

  it('does not duplicate a scheme the app already registered under another name', async () => {
    const existing: UrlTypes = [
      {
        CFBundleURLName: 'com.example.app',
        CFBundleURLSchemes: ['fixtureapp'],
      },
    ];
    const config = withUqpay(makeConfig({ scheme: 'fixtureapp' }));
    const infoPlist = await runIosInfoPlistMod(config, {
      CFBundleURLTypes: existing,
    });

    expect(infoPlist.CFBundleURLTypes).toHaveLength(1);
    expect(uqpayEntries(infoPlist)).toHaveLength(0);
  });

  it('replaces its own entry when the scheme changes, leaving no stale scheme', async () => {
    const firstRun = await runIosInfoPlistMod(
      withUqpay(makeConfig({ scheme: 'oldscheme' }))
    );
    const secondRun = await runIosInfoPlistMod(
      withUqpay(makeConfig({ scheme: 'newscheme' })),
      firstRun
    );

    expect(secondRun.CFBundleURLTypes).toEqual([
      { CFBundleURLName: UQPAY_URL_NAME, CFBundleURLSchemes: ['newscheme'] },
    ]);
  });

  it('keeps unrelated CFBundleURLTypes entries', async () => {
    const config = withUqpay(makeConfig({ scheme: 'fixtureapp' }));
    const infoPlist = await runIosInfoPlistMod(config, {
      CFBundleURLTypes: [
        { CFBundleURLName: 'com.example.other', CFBundleURLSchemes: ['other'] },
      ],
    });

    expect(infoPlist.CFBundleURLTypes).toHaveLength(2);
    expect(uqpayEntries(infoPlist)).toHaveLength(1);
  });

  it('prefers the explicit iosUrlScheme prop over config.scheme', async () => {
    const config = withUqpay(makeConfig({ scheme: 'fixtureapp' }), {
      iosUrlScheme: 'myapp',
    });
    const infoPlist = await runIosInfoPlistMod(config);

    expect(infoPlist.CFBundleURLTypes).toEqual([
      { CFBundleURLName: UQPAY_URL_NAME, CFBundleURLSchemes: ['myapp'] },
    ]);
  });

  it('uses the first entry when config.scheme is an array', async () => {
    const config = withUqpay(
      makeConfig({ scheme: ['first-scheme', 'second-scheme'] })
    );
    const infoPlist = await runIosInfoPlistMod(config);

    expect(infoPlist.CFBundleURLTypes).toEqual([
      { CFBundleURLName: UQPAY_URL_NAME, CFBundleURLSchemes: ['first-scheme'] },
    ]);
  });

  it('falls back to ios.bundleIdentifier when no scheme is declared', async () => {
    const config = withUqpay(
      makeConfig({ ios: { bundleIdentifier: 'com.example.app' } })
    );
    const infoPlist = await runIosInfoPlistMod(config);

    expect(infoPlist.CFBundleURLTypes).toEqual([
      {
        CFBundleURLName: UQPAY_URL_NAME,
        CFBundleURLSchemes: ['com.example.app'],
      },
    ]);
  });

  it('registers nothing when neither a scheme nor a bundle identifier exists', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    resetMissingSchemeWarning();

    const config = withUqpay(makeConfig());
    const infoPlist = await runIosInfoPlistMod(config);

    expect(uqpayEntries(infoPlist)).toHaveLength(0);
    warn.mockRestore();
  });

  describe('warning when no scheme resolves (lead decision, builder-plugin)', () => {
    let warn: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
      resetMissingSchemeWarning();
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
      resetMissingSchemeWarning();
    });

    it('warns once, naming the iosUrlScheme prop', async () => {
      await runIosInfoPlistMod(withUqpay(makeConfig()));

      expect(warn.mock.calls).toHaveLength(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain('iosUrlScheme');
      expect(message).toContain('@uqpay/react-native');
      expect(message).toContain('3DS return URL');
    });

    it('does not warn a second time in the same prebuild process', async () => {
      await runIosInfoPlistMod(withUqpay(makeConfig()));
      await runIosInfoPlistMod(withUqpay(makeConfig()));

      expect(warn.mock.calls).toHaveLength(1);
    });

    it('does not warn when a scheme resolves', async () => {
      await runIosInfoPlistMod(withUqpay(makeConfig({ scheme: 'fixtureapp' })));

      expect(warn.mock.calls).toHaveLength(0);
    });
  });

  it('resolves the scheme in the documented precedence order', () => {
    expect(
      resolveIosUrlScheme(makeConfig({ scheme: 'fixtureapp' }), {
        iosUrlScheme: 'myapp',
      })
    ).toBe('myapp');
    expect(resolveIosUrlScheme(makeConfig({ scheme: 'fixtureapp' }))).toBe(
      'fixtureapp'
    );
    expect(resolveIosUrlScheme(makeConfig({ scheme: [] }))).toBeUndefined();
    expect(
      resolveIosUrlScheme(makeConfig({ scheme: '' }), { iosUrlScheme: '' })
    ).toBeUndefined();
  });
});

describe('withUqpay — Android is untouched (RN-INT8, RN-BR7)', () => {
  it('returns the Android config deep-equal to the input and adds no Android mod', () => {
    const android = {
      package: 'com.example.app',
      permissions: ['android.permission.INTERNET'],
    };
    const input = makeConfig({ scheme: 'fixtureapp', android });
    const expected = JSON.parse(JSON.stringify(android)) as typeof android;

    const config: ExportedConfig = withUqpay(input, { iosUrlScheme: 'myapp' });

    expect(config.android).toEqual(expected);
    expect(config.mods?.android).toBeUndefined();
    expect(Object.keys(config.mods ?? {})).toEqual(['ios']);
  });
});

describe('plugin packaging (RN-BR9, RN-DEP1)', () => {
  it('needs no Expo or SDK source import beyond @expo/config-plugins', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'withUqpay.ts'),
      'utf8'
    );
    const imports = [...source.matchAll(/from '([^']+)'|require\('([^']+)'\)/g)]
      .map((match) => match[1] ?? match[2])
      .filter((specifier): specifier is string => specifier !== undefined);

    expect(imports).toEqual([
      '@expo/config-plugins',
      '@expo/config-plugins',
      '../../package.json',
    ]);
    expect(imports.some((name) => name.includes('/src/'))).toBe(false);
    expect(imports).not.toContain('expo');
  });

  it('app.plugin.js resolves to the built plugin function', () => {
    const buildEntry = join(__dirname, '..', 'build', 'withUqpay.js');
    if (!existsSync(buildEntry)) {
      // `yarn plugin:build` has not run yet in this checkout.
      execFileSync(
        process.execPath,
        [
          join(PROJECT_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
          '-p',
          'plugin',
        ],
        { cwd: PROJECT_ROOT, stdio: 'inherit' }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugin = require(join(PROJECT_ROOT, 'app.plugin.js')) as {
      default?: unknown;
    };

    expect(typeof plugin.default).toBe('function');
  }, 120_000);
});
