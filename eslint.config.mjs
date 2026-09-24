import { fixupConfigRules } from '@eslint/compat';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import tsdoc from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

// `@react-native/eslint-config` already registers the `@typescript-eslint`
// plugin (through the eslintrc compat layer). Registering it a second time via
// `tseslint.configs.strict` makes ESLint 9 throw "Cannot redefine plugin", so
// we lift the *rules* of the strict preset and apply them against the plugin
// instance the RN config registered.
const typescriptStrictRules = Object.assign(
  {},
  ...tseslint.configs.strict.map((config) => config.rules ?? {})
);

export default defineConfig([
  {
    ignores: [
      'node_modules/',
      'lib/',
      'android/build/',
      'ios/build/',
      'plugin/build/',
      // Generated from the docs by `yarn docs:check`; type-checked, not linted.
      'docs-fixtures/*.ts',
      'docs-fixtures/*.tsx',
      'temp/',
      'coverage/',
      'etc/',
      'docs/',
      '.yarn/',
      'example/node_modules/',
      'example/android/',
      'example/ios/',
    ],
  },
  {
    extends: fixupConfigRules(compat.extends('@react-native', 'prettier')),
    plugins: { prettier },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'prettier/prettier': 'error',
    },
  },
  {
    // Package source: typescript-eslint strict + TSDoc syntax + no `any`
    // (AC RN-API4, RN-API6, RN-API7).
    files: ['src/**/*.{ts,tsx}', 'plugin/**/*.{ts,tsx}'],
    plugins: { tsdoc },
    rules: {
      ...typescriptStrictRules,
      '@typescript-eslint/no-explicit-any': 'error',
      'tsdoc/syntax': 'error',
    },
  },
]);
