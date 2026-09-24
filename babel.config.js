/**
 * Babel is used for two things here: `react-native-builder-bob`'s library
 * build, and `babel-jest` in the test run.
 *
 * The third override exists only for the sample app's plain-ESM helper scripts
 * (`example/scripts/*.mjs` and `example-expo/scripts/*.mjs`), which the two
 * `src/__tests__/secrets.test.ts` suites import. Jest runs as CommonJS, where
 * `import.meta` is a syntax error, so we rewrite it to the CommonJS equivalent
 * for those files — and only those.
 */

/** @returns a Babel plugin that rewrites `import.meta` for a CommonJS runtime. */
function transformImportMetaForCommonJs() {
  return {
    name: 'uqpay-transform-import-meta-url',
    visitor: {
      MetaProperty(path) {
        path.replaceWithSourceString(
          "({ url: require('node:url').pathToFileURL(__filename).href })"
        );
      },
    },
  };
}

module.exports = {
  overrides: [
    {
      exclude: /\/node_modules\//,
      presets: ['module:react-native-builder-bob/babel-preset'],
    },
    {
      include: /\/node_modules\//,
      presets: ['module:@react-native/babel-preset'],
    },
    {
      test: /[\\/]example(-expo)?[\\/]scripts[\\/][^\\/]+\.mjs$/,
      plugins: [transformImportMetaForCommonJs],
    },
  ],
};
