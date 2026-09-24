// Metro configuration for the Expo sample app inside this Yarn workspace.
//
// Two things a plain `create-expo-app` config does not know about:
//
//  1. **The monorepo.** `@uqpay/react-native` is the repo root, so Metro has to
//     watch it and resolve modules from both `example-expo/node_modules` and
//     the root's. `disableHierarchicalLookup` keeps that list authoritative, so
//     exactly one copy of `react-native` is ever bundled.
//  2. **Source, not `lib/`.** The package's `exports` map declares a custom
//     `uqpay-react-native-source` condition pointing at `src/index.ts`, so the
//     sample runs against the TypeScript source without a build step — the same
//     trick `example/metro.config.js` uses through `react-native-monorepo-config`.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = [
  'uqpay-react-native-source',
  'require',
  'import',
  'react-native',
];

module.exports = config;
