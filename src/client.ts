/**
 * The public implementation: module state, the token bridge, presentation, the
 * pending buffer and the event surface.
 *
 * Nothing in here reads the clock or sets a timer — every deadline in the
 * payment path belongs to the natives.
 *
 * @internal
 */
import {
  NativeEventEmitter,
  TurboModuleRegistry,
  type EmitterSubscription,
} from 'react-native';
import NativeUqpayAtLoad, {
  type NativeAppearance,
  type NativeInitConfig,
  type NativePaymentResult,
  type NativePresentOptions,
  type NativeRequiresAction,
  type NativeTokenRequest,
  type Spec,
} from './NativeUqpay';
import {
  UQPAY_EVENT_PAYMENT_RECONCILED,
  UQPAY_EVENT_REQUIRES_ACTION,
  UQPAY_EVENT_TOKEN_REQUESTED,
} from './nativeEvents';
import { UqpayConfigurationError } from './errors/configurationError';
import { localError } from './errors/mapper';
import { resetWarnings, warnOnce } from './log';
import { marshalResult, type MarshalContext } from './marshal';
import { assertSupportedPlatform } from './platform';
import type {
  InitOptions,
  PaymentEvent,
  PresentOptions,
  UqpayPaymentResult,
} from './types';
import { validateInitOptions, validatePresentOptions } from './validation';

/** Merchant token provider, as given to {@link init}. */
type TokenProvider = InitOptions['tokenProvider'];

/** `expiresAtEpochMs` sentinel for "the merchant did not say". */
const EXPIRES_AT_UNKNOWN = -1;

// ---------------------------------------------------------------------------
// Module state. A Metro reload throws all of this away, which is exactly why
// the native side buffers results.
// ---------------------------------------------------------------------------

let initialized = false;
let currentConfigId: string | null = null;
let tokenProvider: TokenProvider | null = null;
let presenting = false;
let lastPendingIntentId: string | null = null;

let emitter: NativeEventEmitter | null = null;
let internalSubscriptions: EmitterSubscription[] = [];
let nativeModule: Spec | null | undefined = NativeUqpayAtLoad;

/**
 * `presentPaymentSheet` options for intents that resolved `pending`, so
 * `pending.reconcile()` can re-present. Billing details are dropped before an
 * entry is stored: customer data is not kept in memory after the sheet closes.
 */
const presentOptionsByIntent = new Map<string, PresentOptions>();
/** Late `paymentReconciled` outcomes, so `reconcile()` can answer without a sheet. */
const reconciledByIntent = new Map<string, UqpayPaymentResult>();

/**
 * The native module, looked up on first use rather than at import time, so an
 * import never throws (Expo Go and Jest then reach their own clear messages).
 * A miss is retried on every call: the Jest helper may register the mock after
 * the SDK was imported.
 */
function requireNative(): Spec {
  nativeModule ??= TurboModuleRegistry.get<Spec>('Uqpay');
  if (nativeModule == null) {
    throw new UqpayConfigurationError(
      'invalid_configuration',
      'The UQPAY native module is not in this app binary. Rebuild the app after installing ' +
        '@uqpay/react-native (iOS: `pod install`, then rebuild; Expo: `npx expo prebuild` or an EAS build). ' +
        "In Jest, import '@uqpay/react-native/jest' from your setup file."
    );
  }
  return nativeModule;
}

/**
 * Native rejections are programmer error too, so they surface as the one
 * documented error class. A native code outside the three known ones becomes
 * `invalid_configuration`; the native message (already free of tokens and card
 * data) is kept.
 */
function toConfigurationError(thrown: unknown): UqpayConfigurationError {
  const code = (thrown as { code?: unknown } | null)?.code;
  const message =
    thrown instanceof Error && thrown.message.length > 0
      ? thrown.message
      : 'The UQPAY native module rejected the call.';
  return new UqpayConfigurationError(
    code === 'not_initialized' || code === 'unsupported_platform'
      ? code
      : 'invalid_configuration',
    message
  );
}

async function callNative<T>(call: (native: Spec) => Promise<T>): Promise<T> {
  const native = requireNative();
  try {
    return await call(native);
  } catch (thrown: unknown) {
    throw toConfigurationError(thrown);
  }
}

function getEmitter(): NativeEventEmitter {
  emitter ??= new NativeEventEmitter(requireNative());
  return emitter;
}

/**
 * `NativeEventEmitter.addListener` is typed as `(...args: readonly Object[])`,
 * which no bridge payload type satisfies. One helper does the single cast, so
 * the rest of the file stays typed against the Codegen structs.
 */
function onNativeEvent<TPayload>(
  eventName: string,
  handler: (payload: TPayload) => void
): EmitterSubscription {
  return getEmitter().addListener(eventName, (...args: readonly unknown[]) => {
    handler(args[0] as TPayload);
  });
}

// ---------------------------------------------------------------------------
// Config identity
// ---------------------------------------------------------------------------

/**
 * A stable string for the non-secret part of the config: JSON with object keys
 * sorted, `undefined` dropped. No hashing library, and the `tokenProvider` is
 * never part of it — re-registering a provider after a Metro reload must not
 * look like a different configuration.
 *
 * Exported for the SDK's own tests only.
 *
 * @internal
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

function computeConfigId(options: InitOptions): string {
  return stableStringify({
    environment: options.environment,
    clientId: options.clientId,
    appearance: options.appearance,
    debugLogging: options.debugLogging ?? false,
  });
}

// ---------------------------------------------------------------------------
// JS → native option mapping
// ---------------------------------------------------------------------------

function toNativeAppearance(
  options: InitOptions
): NativeAppearance | undefined {
  const appearance = options.appearance;
  if (appearance === undefined) return undefined;
  return {
    ...(appearance.colorMode === undefined
      ? {}
      : { colorMode: appearance.colorMode }),
    ...(appearance.primaryColor === undefined
      ? {}
      : { primaryColor: appearance.primaryColor }),
    ...(appearance.backgroundColor === undefined
      ? {}
      : { backgroundColor: appearance.backgroundColor }),
    ...(appearance.surfaceColor === undefined
      ? {}
      : { surfaceColor: appearance.surfaceColor }),
    ...(appearance.textColor === undefined
      ? {}
      : { textColor: appearance.textColor }),
    ...(appearance.secondaryTextColor === undefined
      ? {}
      : { secondaryTextColor: appearance.secondaryTextColor }),
    ...(appearance.errorColor === undefined
      ? {}
      : { errorColor: appearance.errorColor }),
    ...(appearance.cornerRadius === undefined
      ? {}
      : { cornerRadius: appearance.cornerRadius }),
    ...(appearance.ios === undefined
      ? {}
      : { iosExtras: JSON.stringify(appearance.ios) }),
    ...(appearance.android === undefined
      ? {}
      : { androidExtras: JSON.stringify(appearance.android) }),
  };
}

function toNativeInitConfig(
  options: InitOptions,
  configId: string
): NativeInitConfig {
  const appearance = toNativeAppearance(options);
  return {
    environment: options.environment,
    clientId: options.clientId,
    debugLogging: options.debugLogging ?? false,
    configId,
    // `onBehalfOf` stays in the Codegen spec but is never sent: neither
    // native's *sheet* path applies `x-on-behalf-of`.
    // Connect sub-account payments are configured when the backend creates
    // the intent.
    ...(appearance === undefined ? {} : { appearance }),
  };
}

function toNativePresentOptions(options: PresentOptions): NativePresentOptions {
  const presentation = options.presentation ?? 'methodList';
  const singleWallet =
    typeof presentation === 'object' ? presentation.singleWallet : undefined;
  return {
    paymentIntentId: options.paymentIntentId,
    returnUrl: options.returnUrl,
    presentationMode:
      singleWallet === undefined ? presentation : 'singleWallet',
    ...(singleWallet === undefined ? {} : { singleWalletMethod: singleWallet }),
    ...(options.allowedPaymentMethods === undefined
      ? {}
      : { allowedPaymentMethods: options.allowedPaymentMethods }),
    ...(options.billingDetails === undefined
      ? {}
      : { billingDetails: options.billingDetails }),
    ...(options.merchantDisplayName === undefined
      ? {}
      : { merchantDisplayName: options.merchantDisplayName }),
  } as NativePresentOptions;
}

// ---------------------------------------------------------------------------
// Token bridge
// ---------------------------------------------------------------------------

/** The options `reconcile()` needs, without the customer's billing details. */
function withoutCustomerData(options: PresentOptions): PresentOptions {
  const kept = { ...options };
  delete kept.billingDetails;
  return kept;
}

/** Longest slice of a merchant error message forwarded to native. */
const MAX_THROWN_DESCRIPTION = 200;

/**
 * A short, single-line description of what the merchant's provider threw. The
 * text is the merchant's own, so it is flattened (no control characters, which
 * could forge extra log lines) and capped in length before it crosses the bridge.
 */
function describeThrown(thrown: unknown): string {
  const raw =
    thrown instanceof Error
      ? `${thrown.name}: ${thrown.message}`
      : typeof thrown === 'string'
        ? thrown
        : 'a non-Error value';
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const flat = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return flat.length > MAX_THROWN_DESCRIPTION
    ? `${flat.slice(0, MAX_THROWN_DESCRIPTION)}…`
    : flat;
}

/**
 * Answer a `uqpay_tokenRequested` event. The token value is read from the
 * provider's result, handed to native once, and never stored, logged or put
 * into a message. The SDK adds no timeout: the 10 s budget is the native's.
 *
 * Exported for the SDK's own tests only; it is not part of the package entry
 * point.
 *
 * @internal
 */
export async function handleTokenRequest(
  request: NativeTokenRequest
): Promise<void> {
  const requestId = request.requestId;
  const provider = tokenProvider;

  const native = requireNative();

  if (provider === null) {
    native.failToken(
      requestId,
      'No tokenProvider is registered. Call init({ tokenProvider }) before presenting the payment sheet.'
    );
    return;
  }

  try {
    const answer = await provider();
    const token =
      typeof answer?.authToken === 'string' ? answer.authToken.trim() : '';
    if (token.length === 0) {
      native.failToken(
        requestId,
        'The merchant tokenProvider resolved without a usable authToken (blank or missing).'
      );
      return;
    }
    const expiresAt = answer.expiresAt;
    const known = typeof expiresAt === 'number' && Number.isFinite(expiresAt);
    if (!known) {
      warnOnce(
        'token-expiry-unknown',
        'tokenProvider returned no expiresAt. Return the expiry UQPAY gave your server (epoch ms) so the ' +
          'native SDK knows how long it may reuse the token; without it the token is treated as short-lived.'
      );
    }
    native.provideToken(
      requestId,
      token,
      known ? expiresAt : EXPIRES_AT_UNKNOWN
    );
  } catch (thrown: unknown) {
    native.failToken(
      requestId,
      `The merchant tokenProvider threw (${describeThrown(thrown)}).`
    );
  }
}

function subscribeInternalListeners(): void {
  if (internalSubscriptions.length > 0) return;
  internalSubscriptions = [
    onNativeEvent<NativeTokenRequest>(
      UQPAY_EVENT_TOKEN_REQUESTED,
      (request) => {
        // eslint-disable-next-line no-void -- deliberate fire-and-forget: `handleTokenRequest` answers native on every path and never rejects, and the native event has nothing to await it.
        void handleTokenRequest(request);
      }
    ),
    onNativeEvent<NativePaymentResult>(
      UQPAY_EVENT_PAYMENT_RECONCILED,
      (payload) => {
        // The payload carries its own intent id; `marshalResult` falls back to
        // the empty string only if the bridge sent a malformed one.
        const result = marshalResult(payload, marshalContextFor(''));
        reconciledByIntent.set(result.paymentIntentId, result);
      }
    ),
  ];
}

// ---------------------------------------------------------------------------
// Marshalling context
// ---------------------------------------------------------------------------

function marshalContextFor(intentId: string): MarshalContext {
  return {
    fallbackIntentId: intentId,
    fallbackPlatform: assertSupportedPlatform(),
    makeReconcile: (paymentIntentId: string) => () =>
      reconcile(paymentIntentId),
  };
}

/**
 * `pending.reconcile()`: answer from a late `paymentReconciled` event when one
 * has already arrived, otherwise re-present the same intent so the natives'
 * terminal-intent guard can settle it without showing a form.
 */
async function reconcile(paymentIntentId: string): Promise<UqpayPaymentResult> {
  const buffered = reconciledByIntent.get(paymentIntentId);
  if (buffered !== undefined) {
    reconciledByIntent.delete(paymentIntentId);
    return buffered;
  }
  const options = presentOptionsByIntent.get(paymentIntentId);
  if (options === undefined) {
    throw new UqpayConfigurationError(
      'invalid_configuration',
      `reconcile() no longer has the presentPaymentSheet options for ${paymentIntentId}: a Metro reload or a process ` +
        'restart cleared them. After a reload call presentPaymentSheet again with the same paymentIntentId; the ' +
        'terminal-intent guard returns the settled result without showing a form.'
    );
  }
  return presentPaymentSheet(options);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the SDK. Idempotent: calling it again with the **same** non-secret
 * configuration is a no-op that only re-registers your `tokenProvider`, which
 * is what makes a Metro reload or Fast Refresh safe.
 * Calling it with a **different** configuration while a sheet is open rejects,
 * because the Android native would rebuild its token manager mid-payment.
 *
 * Rejects with an error carrying `code: 'invalid_configuration'` for a bad
 * field (the message names it) or `code: 'unsupported_platform'` on web,
 * macOS, Windows or Expo Go.
 *
 * @example
 * ```ts
 * import { init } from '@uqpay/react-native';
 *
 * await init({
 *   environment: 'sandbox',
 *   clientId: 'ck_test_123',
 *   tokenProvider: async () => {
 *     // Your server mints the token; protect this route with your own user auth.
 *     const res = await fetch('https://your-server.example/uqpay/token', {
 *       headers: { Authorization: `Bearer ${sessionToken}` },
 *     });
 *     const { authToken, expiresAt } = await res.json();
 *     return { authToken, expiresAt };
 *   },
 * });
 * ```
 *
 * @param options - environment, credentials, token provider and theming
 * @returns a promise that resolves once the natives are configured
 */
export async function init(options: InitOptions): Promise<void> {
  assertSupportedPlatform();
  validateInitOptions(options);

  const configId = computeConfigId(options);

  if (initialized && configId === currentConfigId) {
    // Same configuration: keep native state (and Android's token cache) and
    // simply adopt the new provider closure.
    tokenProvider = options.tokenProvider;
    subscribeInternalListeners();
    return;
  }

  if (initialized && presenting) {
    throw new UqpayConfigurationError(
      'invalid_configuration',
      'init() was called with a different environment/clientId/appearance while a payment sheet is presented. ' +
        'Finish or cancel the payment first: re-configuring mid-payment would rebuild the native token manager.'
    );
  }

  tokenProvider = options.tokenProvider;
  subscribeInternalListeners();

  await callNative((native) =>
    native.initialize(toNativeInitConfig(options, configId))
  );

  initialized = true;
  currentConfigId = configId;
}

function assertInitialized(): void {
  if (!initialized) {
    throw new UqpayConfigurationError(
      'not_initialized',
      'The UQPAY SDK is not initialised. Await init({ environment, clientId, tokenProvider }) first.'
    );
  }
}

/**
 * Present the native payment sheet and wait for the outcome.
 *
 * Expected outcomes **resolve**: a decline, a cancel, a timeout and a pending
 * payment all come back as a {@link UqpayPaymentResult}. The
 * promise rejects only for programmer error — no `init`, a bad field, a
 * plain-HTTP `returnUrl`, an unsupported platform.
 *
 * Presenting while a sheet is already open resolves (it does not reject)
 * `failed` / `invalid_configuration`, so a double tap cannot open two sheets.
 *
 * @example
 * ```ts
 * const result = await presentPaymentSheet({
 *   paymentIntentId: 'pi_123',
 *   returnUrl: 'myapp://pay/return',
 * });
 * if (result.kind === 'pending') {
 *   await persist(result.paymentIntentId);
 * }
 * ```
 *
 * @param options - the intent, the return URL and how to present
 * @returns exactly one of the four {@link UqpayPaymentResult} variants
 */
export async function presentPaymentSheet(
  options: PresentOptions
): Promise<UqpayPaymentResult> {
  const platform = assertSupportedPlatform();
  assertInitialized();
  validatePresentOptions(options, platform);

  if (presenting) {
    return {
      kind: 'failed',
      paymentIntentId: options.paymentIntentId,
      error: localError(
        'invalid_configuration',
        'a payment sheet is already presented; only one sheet can be open per process.',
        platform
      ),
    };
  }

  presenting = true;
  try {
    const native = await callNative((module) =>
      module.presentPaymentSheet(toNativePresentOptions(options))
    );
    const result = marshalResult(
      native,
      marshalContextFor(options.paymentIntentId)
    );
    if (result.kind === 'pending') {
      presentOptionsByIntent.set(
        options.paymentIntentId,
        withoutCustomerData(options)
      );
    } else {
      presentOptionsByIntent.delete(options.paymentIntentId);
    }
    lastPendingIntentId =
      result.kind === 'pending' ? result.paymentIntentId : null;
    return result;
  } finally {
    presenting = false;
  }
}

/**
 * Ask the native to dismiss the sheet. With nothing in flight the pending
 * `presentPaymentSheet` promise resolves `canceled` / `merchant_cancelled`;
 * with a confirm already on its way to the server it resolves `pending`, never
 * `canceled`. A cancel that arrives while the SDK is still fetching the token,
 * before the sheet is on screen, stops the sheet from appearing.
 *
 * @example
 * ```ts
 * useEffect(() => () => { void cancelPaymentSheet(); }, []);
 * ```
 *
 * @returns a promise that resolves once the native has accepted the request
 */
export async function cancelPaymentSheet(): Promise<void> {
  assertSupportedPlatform();
  assertInitialized();
  await callNative((native) => native.cancelPaymentSheet());
}

/**
 * Tell the SDK your app was reopened by the bank's return URL. Only needed on
 * iOS, and only if your app handles the deep link itself with `Linking`; it is
 * a no-op on Android.
 *
 * It never throws, so it is safe inside a `Linking` listener: before `init()`
 * has resolved there is no sheet to notify and the call does nothing.
 *
 * @example
 * ```ts
 * Linking.addEventListener('url', ({ url }) => {
 *   if (url.startsWith('myapp://pay/return')) notifyReturnedFromBank();
 * });
 * ```
 */
export function notifyReturnedFromBank(): void {
  // `initialized` is only ever true on a supported platform with the native
  // module present, so nothing below can throw.
  if (!initialized) return;
  requireNative().notifyReturnedFromBank();
}

/**
 * Collect a result that arrived while no JS promise was attached — after a
 * Metro reload, a Fast Refresh, or an Android process death mid-3DS.
 * Exactly once: the native clears its buffer as it hands the
 * result over, so a second call returns `null`.
 *
 * A `pending` result that comes back from here belongs to a JS context that no
 * longer exists, so its `reconcile()` rejects. Persist `paymentIntentId` on
 * your side and, after a reload, call {@link presentPaymentSheet} again with
 * the same `paymentIntentId`: the natives' terminal-intent guard returns the
 * settled result without showing a form.
 *
 * @example
 * ```ts
 * useEffect(() => {
 *   void getPendingResult().then(async (r) => {
 *     if (!r) return;
 *     if (r.kind === 'pending') {
 *       // The reload cleared reconcile()'s context: re-present the same intent.
 *       return showOutcome(await presentPaymentSheet({ paymentIntentId: r.paymentIntentId, returnUrl }));
 *     }
 *     showOutcome(r);
 *   });
 * }, []);
 * ```
 *
 * @returns the buffered result, or `null` when there is none
 */
export async function getPendingResult(): Promise<UqpayPaymentResult | null> {
  assertSupportedPlatform();
  const native = await callNative((module) => module.getPendingResult());
  if (native == null) return null;
  const result = marshalResult(native, marshalContextFor(''));
  lastPendingIntentId =
    result.kind === 'pending' ? result.paymentIntentId : lastPendingIntentId;
  return result;
}

/**
 * Subscribe to out-of-band payment events. Both are **iOS-only** today:
 * `paymentReconciled` fires when a late server read settles an intent that
 * previously resolved `pending`, and `requiresAction` when the sheet shows a
 * customer action. On Android, settle a `pending` result with
 * `result.reconcile()` or, better, from your server.
 *
 * The returned handle removes both underlying native subscriptions, leaving no
 * listener behind.
 *
 * @example
 * ```ts
 * useEffect(() => {
 *   const sub = addPaymentListener((e) => {
 *     if (e.type === 'paymentReconciled') void refreshOrder(e.result.paymentIntentId);
 *   });
 *   return () => { sub.remove(); };
 * }, []);
 * ```
 *
 * @param listener - called for every event; exceptions it throws are not swallowed
 * @returns a handle with a `remove()` method
 */
export function addPaymentListener(listener: (event: PaymentEvent) => void): {
  remove: () => void;
} {
  const subscriptions: EmitterSubscription[] = [
    onNativeEvent<NativePaymentResult>(
      UQPAY_EVENT_PAYMENT_RECONCILED,
      (payload) => {
        listener({
          type: 'paymentReconciled',
          result: marshalResult(payload, marshalContextFor('')),
        });
      }
    ),
    onNativeEvent<NativeRequiresAction>(
      UQPAY_EVENT_REQUIRES_ACTION,
      (payload) => {
        listener({
          type: 'requiresAction',
          action: {
            type: payload?.type ?? 'custom',
            ...(payload?.url == null ? {} : { url: payload.url }),
          },
        });
      }
    ),
  ];

  return {
    remove(): void {
      for (const subscription of subscriptions) subscription.remove();
      subscriptions.length = 0;
    },
  };
}

/** The object {@link useUqpay} returns. Frozen, so its identity is stable. */
const HOOK_VALUE: {
  presentPaymentSheet: typeof presentPaymentSheet;
  cancelPaymentSheet: typeof cancelPaymentSheet;
  getPendingResult: typeof getPendingResult;
} = Object.freeze({
  presentPaymentSheet,
  cancelPaymentSheet,
  getPendingResult,
});

/**
 * A React-friendly handle on the imperative API. It adds **no capability** the
 * module functions lack — it exists so the callbacks can go into
 * a dependency array without being re-created: the returned object and every
 * callback on it have a stable identity for the life of the JS context, so
 * `useUqpay()` never causes a re-render or a stale-closure bug.
 *
 * @example
 * ```tsx
 * function PayButton({ paymentIntentId }: { paymentIntentId: string }) {
 *   const { presentPaymentSheet } = useUqpay();
 *   const pay = useCallback(
 *     () => presentPaymentSheet({ paymentIntentId, returnUrl: 'myapp://pay/return' }),
 *     [presentPaymentSheet, paymentIntentId]
 *   );
 *   return <Button title="Pay" onPress={pay} />;
 * }
 * ```
 *
 * @returns the three payment entry points, with stable identities
 */
export function useUqpay(): {
  presentPaymentSheet: typeof presentPaymentSheet;
  cancelPaymentSheet: typeof cancelPaymentSheet;
  getPendingResult: typeof getPendingResult;
} {
  return HOOK_VALUE;
}

// ---------------------------------------------------------------------------
// Test hooks — not exported from the package entry point.
// ---------------------------------------------------------------------------

/**
 * Throw away every piece of module state, the way a Metro reload would.
 *
 * @internal
 */
export function resetForTests(): void {
  initialized = false;
  currentConfigId = null;
  tokenProvider = null;
  presenting = false;
  lastPendingIntentId = null;
  for (const subscription of internalSubscriptions) subscription.remove();
  internalSubscriptions = [];
  emitter = null;
  presentOptionsByIntent.clear();
  reconciledByIntent.clear();
  resetWarnings();
}

/**
 * Replace the cached native module, as if the Codegen lookup at import time had
 * returned `module`. For the SDK's own tests only.
 *
 * @internal
 */
export function setNativeModuleForTests(module: Spec | null): void {
  nativeModule = module;
}

/**
 * Read-only view of the module state, for the SDK's own tests.
 *
 * @internal
 */
export function inspectStateForTests(): {
  initialized: boolean;
  currentConfigId: string | null;
  presenting: boolean;
  lastPendingIntentId: string | null;
  hasTokenProvider: boolean;
  reconciledCount: number;
} {
  return {
    initialized,
    currentConfigId,
    presenting,
    lastPendingIntentId,
    hasTokenProvider: tokenProvider !== null,
    reconciledCount: reconciledByIntent.size,
  };
}
