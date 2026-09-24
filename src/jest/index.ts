/**
 * `@uqpay/react-native/jest` — a scripted stand-in for the `Uqpay` Turbo Module.
 *
 * It implements the whole Codegen `Spec`, records every call, and lets a test
 * decide what the "native" does next, so payment flows can be tested on CI
 * without a simulator. The SDK's own suite uses the very same mock, which is
 * what keeps it honest.
 *
 * See `jest/README.md` for the merchant-facing guide.
 *
 * @example
 * ```ts
 * // jest.setup.ts — importing the helper registers the mock as the native module.
 * import { uqpayNativeMock } from '@uqpay/react-native/jest';
 *
 * beforeEach(() => uqpayNativeMock.__reset());
 *
 * // in a test
 * uqpayNativeMock.__setPlatform('android');
 * uqpayNativeMock.__nextResult({
 *   kind: 'completed', paymentIntentId: 'pi_1', status: 'SUCCEEDED',
 *   amount: '10.00', currency: 'SGD', platform: 'android', resultId: 'r1',
 * });
 * ```
 *
 * @packageDocumentation
 */
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import type {
  NativeInfo,
  NativeInitConfig,
  NativePaymentResult,
  NativePresentOptions,
  Spec,
} from '../NativeUqpay';
import { UQPAY_EVENT_TOKEN_REQUESTED } from '../nativeEvents';

/**
 * How the mock's ready-made {@link UqpayNativeMock.tokenProvider} behaves.
 *
 * - `resolve` — hands back a usable token,
 * - `throw` — rejects,
 * - `blank` — resolves with an empty `authToken`,
 * - `hang` — never settles, so a test can prove the JS layer adds no timeout
 *   of its own (the 10 s budget belongs to native).
 */
export type TokenBehaviour = 'resolve' | 'throw' | 'blank' | 'hang';

/** A recorded `provideToken` call. The token value is stored so tests can assert it never leaked elsewhere. */
export type ProvideTokenCall = {
  /** The request the SDK was answering. */
  requestId: string;
  /** The token the SDK handed over. */
  authToken: string;
  /** Epoch milliseconds, or `-1` when the merchant did not say. */
  expiresAtEpochMs: number;
};

/** A recorded `failToken` call. */
export type FailTokenCall = {
  /** The request the SDK was answering. */
  requestId: string;
  /** The developer message the SDK sent. Asserted never to contain a token. */
  developerMessage: string;
};

/** Everything the mock recorded. */
export type MockCallLog = {
  /** Every `initialize` config, in order. */
  initialize: NativeInitConfig[];
  /** Every `presentPaymentSheet` option object, in order. */
  presentPaymentSheet: NativePresentOptions[];
  /** One entry per `cancelPaymentSheet` call. */
  cancelPaymentSheet: number[];
  /** One entry per `notifyReturnedFromBank` call. */
  notifyReturnedFromBank: number[];
  /** One entry per `getPendingResult` call. */
  getPendingResult: number[];
  /** Answers to `uqpay_tokenRequested`. */
  provideToken: ProvideTokenCall[];
  /** Failures reported for `uqpay_tokenRequested`. */
  failToken: FailTokenCall[];
  /** Event names passed to `addListener`. */
  addListener: string[];
  /** Counts passed to `removeListeners`. */
  removeListeners: number[];
};

/** The mock module: the Codegen `Spec` plus the `__`-prefixed scripting hooks. */
export type UqpayNativeMock = Spec & {
  /** Everything the mock has recorded since the last `__reset()`. */
  readonly __calls: MockCallLog;
  /** Pretend to be this platform: drives `Platform.OS` and the `platform` field of generated results. */
  __setPlatform: (os: 'ios' | 'android') => void;
  /** The platform the mock is currently pretending to be. */
  __platform: () => 'ios' | 'android';
  /** Queue the payload the next `presentPaymentSheet` resolves with. */
  __nextResult: (result: NativePaymentResult) => void;
  /** Queue an error the next `presentPaymentSheet` rejects with (programmer error only). */
  __nextReject: (error: unknown) => void;
  /** Set what the next `getPendingResult` returns. Cleared once consumed, like the native buffer. */
  __pending: (result: NativePaymentResult | null) => void;
  /** Emit a native event to whatever `NativeEventEmitter` listeners exist. */
  __emit: (eventName: string, payload: unknown) => void;
  /** Choose how {@link UqpayNativeMock.tokenProvider} behaves. */
  __tokenBehaviour: (behaviour: TokenBehaviour) => void;
  /** Whether `presentPaymentSheet` first emits `uqpay_tokenRequested`. Default `true`. */
  __emitTokenRequestOnPresent: (enabled: boolean) => void;
  /** Live native listener count: `addListener` calls minus `removeListeners` counts. */
  __listenerCount: () => number;
  /** Forget every recorded call and queued answer. */
  __reset: () => void;
  /**
   * A ready-made `InitOptions['tokenProvider']` whose behaviour follows
   * {@link UqpayNativeMock.__tokenBehaviour}. The token it resolves is the
   * sentinel below, so a test can assert it never reaches a log.
   */
  tokenProvider: () => Promise<{ authToken: string; expiresAt?: number }>;
  /** The token value {@link UqpayNativeMock.tokenProvider} resolves with. */
  readonly __sentinelToken: string;
};

/** The token the mock's provider hands out. Distinctive on purpose, so a test can assert it never reaches a log. */
const SENTINEL_TOKEN = 'uqpay-sentinel-token-DO-NOT-LOG-8f2c1d';

function emptyLog(): MockCallLog {
  return {
    initialize: [],
    presentPaymentSheet: [],
    cancelPaymentSheet: [],
    notifyReturnedFromBank: [],
    getPendingResult: [],
    provideToken: [],
    failToken: [],
    addListener: [],
    removeListeners: [],
  };
}

/**
 * Build a fresh mock. Most suites want the shared {@link uqpayNativeMock}
 * instead; create your own when you need two independent modules in one file.
 *
 * @returns a mock implementing the Codegen `Spec`
 */
export function createUqpayNativeMock(): UqpayNativeMock {
  let calls = emptyLog();
  let platform: 'ios' | 'android' = 'ios';
  let nextResults: NativePaymentResult[] = [];
  let nextRejections: unknown[] = [];
  let pendingResult: NativePaymentResult | null = null;
  let tokenBehaviour: TokenBehaviour = 'resolve';
  let emitTokenRequestOnPresent = true;
  let requestSeq = 0;

  function applyPlatform(os: 'ios' | 'android'): void {
    platform = os;
    // `Platform.OS` is a plain property on the RN jest mock, but it is typed
    // readonly; redefining it is how a jest mock switches platform.
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => os,
    });
  }

  function defaultResult(paymentIntentId: string): NativePaymentResult {
    return {
      kind: 'completed',
      paymentIntentId,
      status: 'SUCCEEDED',
      platform,
      resultId: `mock-result-${String(++requestSeq)}`,
    };
  }

  const mock: UqpayNativeMock = {
    // ---- Codegen Spec -----------------------------------------------------
    initialize(config: NativeInitConfig): Promise<void> {
      calls.initialize.push(config);
      return Promise.resolve();
    },

    presentPaymentSheet(
      options: NativePresentOptions
    ): Promise<NativePaymentResult> {
      calls.presentPaymentSheet.push(options);
      if (emitTokenRequestOnPresent) {
        mock.__emit(UQPAY_EVENT_TOKEN_REQUESTED, {
          requestId: `mock-token-${String(++requestSeq)}`,
          reason: 'present',
        });
      }
      const rejection = nextRejections.shift();
      if (rejection !== undefined) return Promise.reject(rejection);
      const result =
        nextResults.shift() ?? defaultResult(options.paymentIntentId);
      return Promise.resolve(result);
    },

    cancelPaymentSheet(): Promise<void> {
      calls.cancelPaymentSheet.push(calls.cancelPaymentSheet.length + 1);
      return Promise.resolve();
    },

    notifyReturnedFromBank(): void {
      calls.notifyReturnedFromBank.push(
        calls.notifyReturnedFromBank.length + 1
      );
    },

    getPendingResult(): Promise<NativePaymentResult | null> {
      calls.getPendingResult.push(calls.getPendingResult.length + 1);
      // Exactly-once, like the native buffer.
      const buffered = pendingResult;
      pendingResult = null;
      return Promise.resolve(buffered);
    },

    provideToken(
      requestId: string,
      authToken: string,
      expiresAtEpochMs: number
    ): void {
      calls.provideToken.push({ requestId, authToken, expiresAtEpochMs });
    },

    failToken(requestId: string, developerMessage: string): void {
      calls.failToken.push({ requestId, developerMessage });
    },

    getNativeInfo(): Promise<NativeInfo> {
      return Promise.resolve({
        platform,
        nativeSdkVersion: platform === 'ios' ? '1.1.0' : '0.1.0',
        isInitialized: calls.initialize.length > 0,
        isPresenting: false,
      });
    },

    addListener(eventName: string): void {
      calls.addListener.push(eventName);
    },

    removeListeners(count: number): void {
      calls.removeListeners.push(count);
    },

    // ---- Scripting hooks --------------------------------------------------
    get __calls(): MockCallLog {
      return calls;
    },

    __setPlatform: applyPlatform,

    __platform: (): 'ios' | 'android' => platform,

    __nextResult(result: NativePaymentResult): void {
      nextResults.push(result);
    },

    __nextReject(error: unknown): void {
      nextRejections.push(error);
    },

    __pending(result: NativePaymentResult | null): void {
      pendingResult = result;
    },

    __emit(eventName: string, payload: unknown): void {
      DeviceEventEmitter.emit(eventName, payload);
    },

    __tokenBehaviour(behaviour: TokenBehaviour): void {
      tokenBehaviour = behaviour;
    },

    __emitTokenRequestOnPresent(enabled: boolean): void {
      emitTokenRequestOnPresent = enabled;
    },

    __listenerCount(): number {
      const removed = calls.removeListeners.reduce(
        (total, count) => total + count,
        0
      );
      return calls.addListener.length - removed;
    },

    __reset(): void {
      calls = emptyLog();
      nextResults = [];
      nextRejections = [];
      pendingResult = null;
      tokenBehaviour = 'resolve';
      emitTokenRequestOnPresent = true;
      requestSeq = 0;
      applyPlatform('ios');
    },

    tokenProvider(): Promise<{ authToken: string; expiresAt?: number }> {
      switch (tokenBehaviour) {
        case 'throw':
          return Promise.reject(new Error('mock tokenProvider failure'));
        case 'blank':
          return Promise.resolve({ authToken: '   ' });
        case 'hang':
          // Deliberately never settles: the native owns the 10 s budget, the
          // JS layer must not add a timer of its own.
          return new Promise<{ authToken: string; expiresAt?: number }>(
            () => undefined
          );
        case 'resolve':
        default:
          return Promise.resolve({
            authToken: SENTINEL_TOKEN,
            expiresAt: 1_800_000,
          });
      }
    },

    __sentinelToken: SENTINEL_TOKEN,
  };

  return mock;
}

/**
 * The shared mock instance. Importing this module registers it as the `Uqpay`
 * native module, so the SDK finds it exactly as it would find the real one;
 * the SDK's own suite resolves to the same object. A test scripts it and the
 * SDK sees the script.
 *
 * Do **not** call `jest.mock('@uqpay/react-native/jest')`: that replaces this
 * helper with an automock and the SDK then finds no native module.
 */
export const uqpayNativeMock: UqpayNativeMock = createUqpayNativeMock();

// `NativeModules` is a plain object under the React Native Jest preset, and
// `TurboModuleRegistry.get` falls back to it when there is no Turbo Module proxy.
// Never overwrite a module that is already there.
const registry = NativeModules as Record<string, unknown>;
registry.Uqpay ??= uqpayNativeMock;

export default uqpayNativeMock;
