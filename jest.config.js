/** @type {import('jest').Config} */
module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testEnvironmentOptions: {
    customExportConditions: [
      'require',
      'react-native',
      'uqpay-react-native-source',
    ],
  },
  roots: [
    '<rootDir>/src',
    '<rootDir>/plugin',
    '<rootDir>/example/src',
    '<rootDir>/example-expo/src',
  ],
  // Only `*.test.ts` files are suites: `__tests__/fixtures/` and
  // `__tests__/helpers.ts` are shared data, not tests.
  testMatch: ['<rootDir>/**/__tests__/**/*.test.{ts,tsx}'],
  // `example/src/__tests__/secrets.test.ts` imports the sample app's plain-ESM
  // scanner helpers, so Babel has to see `.mjs` too.
  moduleFileExtensions: [
    'ts',
    'tsx',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'json',
    'node',
  ],
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs|cjs)$': [
      'babel-jest',
      { configFile: require.resolve('./babel.config.js') },
    ],
  },
  modulePathIgnorePatterns: [
    '<rootDir>/example/node_modules',
    '<rootDir>/example-expo/node_modules',
    '<rootDir>/lib/',
    '<rootDir>/plugin/build/',
  ],
  // AC RN-TEST2: >= 90 % over the JS layer. The Codegen spec file only declares
  // types and a `TurboModuleRegistry.getEnforcing` call (it is replaced by the
  // mock in `jest.setup.ts`), and `src/jest/` is the shipped test double, whose
  // job is to be scripted by other people's tests rather than covered by ours.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/NativeUqpay.ts',
    '!src/jest/**',
  ],
  coverageThreshold: {
    'global': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    // AC RN-TEST2 names these as the 100 % files: result marshalling, the error
    // mapper, `init` validation, and the pending/buffer path of the client.
    './src/marshal.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './src/errors/mapper.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './src/validation.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './src/client.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  coverageReporters: ['text', 'lcov'],
};
