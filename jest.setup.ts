// Jest setup for the package's own unit tests.
//
// The Turbo Module is native-only, so `TurboModuleRegistry.getEnforcing` throws
// under Jest. Replace `src/NativeUqpay.ts` with the very mock we publish as
// `@uqpay/react-native/jest` (AC RN-TEST4) — if the mock ever drifts from the
// Codegen spec, the SDK's own suite is the first thing to notice.
import { jest } from '@jest/globals';

jest.mock('./src/NativeUqpay', () => jest.requireActual('./src/jest/index.ts'));
