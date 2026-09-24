/**
 * The public type contract of `@uqpay/react-native`.
 *
 * Everything here is data: no class, no `any`, no `unknown`, no
 * `Record<string, unknown>`. Values that a native SDK or the gateway may extend
 * later (error codes, payment-method types, cancel reasons, intent statuses,
 * next-action types) are **open** string unions — a value we have never seen
 * round-trips into JS untouched instead of throwing.
 *
 * `metadata` is deliberately not modelled at 1.0.
 */

/**
 * Which platform produced a result or an error. Internal: the public
 * {@link UqpayError} spells the union inline so the exported surface stays
 * minimal.
 *
 * @internal
 */
export type UqpayPlatform = 'ios' | 'android';

/**
 * A canonical UQPAY error code, or any other string a native SDK may invent.
 *
 * The fourteen canonical codes are produced by exactly one mapper per platform,
 * so the same server condition yields the same code on iOS and Android
 * Anything else is passed through verbatim with `raw` preserved;
 * use {@link isUnknownErrorCode} rather than comparing against a closed set.
 *
 * @example
 * ```ts
 * import { isUnknownErrorCode, type UqpayErrorCode } from '@uqpay/react-native';
 *
 * function retryable(code: UqpayErrorCode): boolean {
 *   if (isUnknownErrorCode(code)) return false;
 *   return code === 'network_error';
 * }
 * ```
 */
export type UqpayErrorCode =
  | 'card_declined'
  | 'insufficient_funds'
  | 'invalid_payment_method'
  | '3ds_failed'
  | 'cancelled'
  | 'authentication_failed'
  | 'invalid_configuration'
  | 'not_initialized'
  | 'invalid_request'
  | 'network_error'
  | 'timeout'
  | 'server_error'
  | 'intent_not_payable'
  | 'unknown'
  | (string & Record<never, never>);

/**
 * A payment-method wire type. The fourteen values below are the methods both
 * native SDKs render today; the union stays open because the gateway can add
 * methods without a wrapper release. `paypal` is not offered by this SDK.
 *
 * @example
 * ```ts
 * await presentPaymentSheet({
 *   paymentIntentId: 'pi_123',
 *   returnUrl: 'myapp://pay/return',
 *   presentation: { singleWallet: 'grabpay' },
 * });
 * ```
 */
export type PaymentMethodType =
  | 'card'
  | 'wechatpay'
  | 'alipaycn'
  | 'alipayhk'
  | 'grabpay'
  | 'paynow'
  | 'unionpay'
  | 'truemoney'
  | 'tng'
  | 'gcash'
  | 'dana'
  | 'kakaopay'
  | 'tosspay'
  | 'naverpay'
  | (string & Record<never, never>);

/**
 * Why a payment sheet closed without an outcome.
 *
 * `user_cancelled` — the customer dismissed the sheet (neither native
 * distinguishes a swipe from the close button). `merchant_cancelled` — your app
 * called {@link cancelPaymentSheet} with nothing in flight. `intent_cancelled` —
 * the intent was cancelled server-side before it could be paid.
 *
 * @example
 * ```ts
 * if (r.kind === 'canceled' && r.reason === 'user_cancelled') {
 *   showTryAgain();
 * }
 * ```
 */
export type CancelReason =
  | 'user_cancelled'
  | 'merchant_cancelled'
  | 'intent_cancelled'
  | (string & Record<never, never>);

/**
 * A payment-intent status as the gateway spells it. Casing is never changed by
 * the bridge, and the union is open because the gateway owns it.
 *
 * @example
 * ```ts
 * if (r.kind === 'pending' && r.lastKnownStatus === 'REQUIRES_CUSTOMER_ACTION') {
 *   persistForLater(r.paymentIntentId);
 * }
 * ```
 */
export type IntentStatus =
  | 'REQUIRES_PAYMENT_METHOD'
  | 'REQUIRES_CUSTOMER_ACTION'
  | 'REQUIRES_CAPTURE'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'CANCELLED'
  | 'CANCELED'
  | 'FAILED'
  | (string & Record<never, never>);

/**
 * Billing information used to **prefill** the card form. Never card data.
 *
 * Android-only until the iOS native SDK adds billing prefill: on iOS the field
 * is ignored and the SDK emits one `console.warn` per JS context. The SDK does
 * not keep billing details after the sheet settles.
 *
 * @example
 * ```ts
 * await presentPaymentSheet({
 *   paymentIntentId: 'pi_123',
 *   returnUrl: 'myapp://pay/return',
 *   billingDetails: { firstName: 'Ada', email: 'ada@example.com', countryCode: 'SG' },
 * });
 * ```
 */
export type BillingDetails = {
  /** Given name. */
  firstName?: string | undefined;
  /** Family name. */
  lastName?: string | undefined;
  /** Contact email. */
  email?: string | undefined;
  /** Contact phone in E.164 if you have it. */
  phone?: string | undefined;
  /** Street address, first line. */
  addressLine1?: string | undefined;
  /** Street address, second line. */
  addressLine2?: string | undefined;
  /** City / locality. */
  city?: string | undefined;
  /** State / province / region. */
  state?: string | undefined;
  /** Postal or ZIP code. */
  postalCode?: string | undefined;
  /** ISO-3166 alpha-2 country code, e.g. `'SG'`. */
  countryCode?: string | undefined;
};

/**
 * Theming for the native sheet. Colours are hex strings (`'#RRGGBB'` or
 * `'#RRGGBBAA'`; Android also accepts `'#AARRGGBB'`), validated at `init` —
 * an invalid value rejects rather than rendering something unexpected.
 *
 * The common subset is mapped onto iOS `PaymentSheet.Appearance` and Android
 * `UQPayAppearance.Colors`. Anything outside it goes through the per-platform
 * escape hatches, which are passed to the native untouched.
 *
 * Appearance is an **`init`** option because the Android native binds it to its
 * configuration; changing it means re-`init`, which rebuilds Android's token
 * cache. The iOS 3DS screen is not themeable (native limitation).
 *
 * @example
 * ```ts
 * await init({
 *   environment: 'sandbox',
 *   clientId: 'ck_test_123',
 *   tokenProvider,
 *   appearance: {
 *     colorMode: 'system',
 *     primaryColor: '#0A84FF',
 *     cornerRadius: 12,
 *     ios: { payButtonColor: '#0A84FF', fieldBorderColor: '#D1D1D6' },
 *     android: { light: { primary: '#FF0A84FF' }, dark: { primary: '#FF64D2FF' } },
 *   },
 * });
 * ```
 */
export type Appearance = {
  /** Follow the host app (`'system'`, the default) or pin light / dark. */
  colorMode?: 'system' | 'light' | 'dark' | undefined;
  /** Accent / call-to-action colour. */
  primaryColor?: string | undefined;
  /** Sheet background. */
  backgroundColor?: string | undefined;
  /** Cards and fields drawn on top of the background. */
  surfaceColor?: string | undefined;
  /** Primary text. */
  textColor?: string | undefined;
  /** Secondary / helper text. */
  secondaryTextColor?: string | undefined;
  /** Error text and invalid field borders. */
  errorColor?: string | undefined;
  /** Corner radius in dp (Android) / pt (iOS). */
  cornerRadius?: number | undefined;
  /**
   * iOS-only escape hatch: `PaymentSheet.Appearance` colour property names to
   * hex colours, for example `primaryColorLight`, `titleColor`, `labelColor`,
   * `fieldBackgroundColor`, `fieldBorderColor`, `payButtonColor`,
   * `payButtonTextColor`, `closeButtonColor`, `cardBrand.visa` or
   * `system.separator`. An unknown key is ignored with a native debug warning.
   */
  ios?: Record<string, string> | undefined;
  /** Android-only escape hatch: `UQPayAppearance.Colors` keys to hex colours, per colour scheme. */
  android?:
    | {
        /** Colours used when the host is in light mode. */
        light?: Record<string, string> | undefined;
        /** Colours used when the host is in dark mode. */
        dark?: Record<string, string> | undefined;
      }
    | undefined;
};

/**
 * A normalised error. `userMessage` is safe to show a customer as-is;
 * `developerMessage` is for your logs and never contains a token, PAN, CVC or
 * expiry.
 *
 * `isOutcomeUnknown: true` means the payment may still have succeeded — never
 * treat it as a definitive failure; reconcile server-side.
 *
 * @example
 * ```ts
 * if (r.kind === 'failed') {
 *   toast(r.error.userMessage);
 *   log.error(r.error.developerMessage, { code: r.error.code, traceId: r.error.traceId });
 * }
 * ```
 */
export type UqpayError = {
  /** Canonical code, or an unrecognised one passed through verbatim. */
  code: UqpayErrorCode;
  /** Safe to display to the customer: no jargon, no stack, no platform name. */
  userMessage: string;
  /** For your logs. Never contains secrets. */
  developerMessage: string;
  /** `true` when retrying the same action can plausibly succeed. */
  isRetryable: boolean;
  /** `true` when the payment may still have gone through. Reconcile server-side. */
  isOutcomeUnknown: boolean;
  /** The gateway's decline code when it sent one. */
  declineCode?: string | undefined;
  /** HTTP status when the native SDK could recover one. */
  httpStatus?: number | undefined;
  /** Trace id when available — always `undefined` today (the gateway sends no trace header). */
  traceId?: string | undefined;
  /** The native code/string when `code` is not canonical. */
  raw?: string | undefined;
  /** Which native SDK produced this error. */
  platform: 'ios' | 'android';
};

/**
 * The outcome of one `presentPaymentSheet` call — a discriminated union on
 * `kind`, so a `switch` is exhaustive under `strict`. **This set of four is
 * frozen for the 1.x line**: new outcomes arrive as new error
 * codes or new fields, never as a fifth variant.
 *
 * The client result is a UX signal, not proof of payment. Before fulfilling an
 * order, confirm the payment on your server by retrieving the payment intent
 * from the UQPAY API.
 *
 * @example
 * ```ts
 * const result = await presentPaymentSheet({ paymentIntentId, returnUrl });
 * switch (result.kind) {
 *   case 'completed': return showReceipt(result.paymentIntentId);
 *   case 'failed':    return toast(result.error.userMessage);
 *   case 'canceled':  return showTryAgain();
 *   case 'pending':   return persistAndReconcileLater(result);
 * }
 * ```
 */
export type UqpayPaymentResult =
  | {
      /**
       * The gateway accepted the payment. For a manual-capture intent this may
       * mean authorised but not yet captured — see `status`.
       */
      kind: 'completed';
      /** The intent that was paid. */
      paymentIntentId: string;
      /**
       * Almost always `'SUCCEEDED'` — including for a manual-capture intent that
       * is authorised and awaiting capture: both native sheets report
       * `SUCCEEDED` in that case. `'REQUIRES_CAPTURE'` appears only when the iOS
       * bridge settled the result by re-reading the intent from the server. If
       * you use manual capture, read the capture state from your server; do not
       * infer it from this field.
       */
      status: 'SUCCEEDED' | 'REQUIRES_CAPTURE';
      /**
       * The wire amount in major units, as a string, never re-scaled
       * Absent when the native could not report one.
       */
      amount?: string | undefined;
      /** ISO-4217 currency, casing untouched. */
      currency?: string | undefined;
      /** The method the native actually confirmed. */
      paymentMethodType?: PaymentMethodType | undefined;
      /** The payment-attempt id. `undefined` on iOS when it fell back to the intent id. */
      transactionId?: string | undefined;
      /** Your order reference, when the intent carried one. */
      merchantOrderId?: string | undefined;
      /**
       * ISO-8601 timestamp. **Informational only** — iOS reports the gateway's
       * `completed_at`, Android reports the device's observation time, and
       * neither is a settlement time.
       */
      completedAt?: string | undefined;
    }
  | {
      /** The payment definitively did not go through (unless `error.isOutcomeUnknown`). */
      kind: 'failed';
      /** The intent that was attempted. */
      paymentIntentId: string;
      /** Why it failed. */
      error: UqpayError;
    }
  | {
      /** The sheet closed with no attempt, or the intent was already cancelled. */
      kind: 'canceled';
      /** The intent that was attempted. */
      paymentIntentId: string;
      /** Who or what cancelled. */
      reason: CancelReason;
    }
  | {
      /**
       * The outcome is not known on the device. **`pending` is final for this
       * promise on both platforms**; resolve it with `reconcile()`
       * or from your server.
       */
      kind: 'pending';
      /** The intent to reconcile. Persist it. */
      paymentIntentId: string;
      /** The last intent status the native saw, if it saw one. */
      lastKnownStatus?: IntentStatus | undefined;
      /** Why the outcome is unknown — usually `timeout` with `isOutcomeUnknown: true`. */
      cause?: UqpayError | undefined;
      /**
       * Ask the native to settle this intent. Implemented by re-presenting the
       * same intent: the natives' terminal-intent guard returns the settled
       * result without showing a form. On iOS it resolves immediately when a
       * `paymentReconciled` event for this intent has already arrived.
       *
       * It needs the JS context that produced this result. After a Metro
       * reload or a process restart that context is gone and `reconcile()`
       * rejects; call `presentPaymentSheet` again with the same
       * `paymentIntentId` instead — the terminal-intent guard returns the
       * settled result without showing a form. Persist `paymentIntentId` on
       * your side so you can do that at next launch.
       *
       * @example
       * ```ts
       * if (result.kind === 'pending') {
       *   await AsyncStorage.setItem('uqpay.pendingIntent', result.paymentIntentId);
       *   const settled = await result.reconcile();
       * }
       * // next launch, after a reload:
       * const id = await AsyncStorage.getItem('uqpay.pendingIntent');
       * if (id) await presentPaymentSheet({ paymentIntentId: id, returnUrl });
       * ```
       */
      reconcile: () => Promise<UqpayPaymentResult>;
    };

/**
 * An event delivered to {@link addPaymentListener}.
 *
 * Both events are **iOS-only** today. `paymentReconciled` fires when a late
 * server read settles an intent that earlier resolved `pending`; the Android
 * native never emits it, so on Android settle a `pending` result with
 * `result.reconcile()` or from your server. `requiresAction` fires when the iOS
 * sheet shows a customer action; Android's native callback is result-only, so
 * do not build UI that depends on it.
 *
 * @example
 * ```ts
 * const sub = addPaymentListener((e) => {
 *   if (e.type === 'paymentReconciled') void refreshOrder(e.result.paymentIntentId);
 * });
 * // later
 * sub.remove();
 * ```
 */
export type PaymentEvent =
  | {
      /** A late outcome for an intent that previously resolved `pending`. **iOS only.** */
      type: 'paymentReconciled';
      /** The settled result. */
      result: UqpayPaymentResult;
    }
  | {
      /** The native is showing a customer action. **iOS only.** */
      type: 'requiresAction';
      /** What the customer is being asked to do. */
      action: {
        /** The kind of action; open union — new action types are not breaking. */
        type:
          | 'authenticate3DS'
          | 'scanQRCode'
          | 'displayBankDetails'
          | 'verifyOTP'
          | 'custom'
          | (string & Record<never, never>);
        /** The ACS or QR URL. Never logged by the SDK. */
        url?: string | undefined;
      };
    };

/**
 * Options for {@link init}. Everything here except `tokenProvider` is
 * non-secret and forms the config identity used for idempotent re-`init`:
 * calling `init` again with the same values is a no-op.
 *
 * @example
 * ```ts
 * await init({
 *   environment: 'sandbox',
 *   clientId: 'ck_test_123',
 *   tokenProvider: async () => {
 *     // Your server mints the token; protect this route with your own user session.
 *     const r = await fetch('https://your-server.example/uqpay/client-token', { method: 'POST' });
 *     const { authToken, expiresAt } = await r.json();
 *     return { authToken, expiresAt };
 *   },
 * });
 * ```
 */
export type InitOptions = {
  /** Which UQPAY environment to talk to. */
  environment: 'sandbox' | 'production';
  /**
   * Returns a fresh merchant auth token. Called by the native bridge before
   * **every** present and whenever the native needs to refresh, so cache it on
   * your side. The SDK passes the value to native once and never logs, stores
   * or re-reads it. The token is a merchant credential: serve it only to your
   * own authenticated users.
   *
   * `expiresAt` is epoch milliseconds. **Always return it** (your server gets
   * the expiry from UQPAY). Without it the SDK prints one developer warning and
   * the natives treat the token as short-lived (Android assumes five minutes),
   * so it is re-requested more often than necessary.
   *
   * If it throws, returns a blank token, or does not settle within the
   * native's 10 s budget, the payment resolves `failed` with
   * `authentication_failed`. The SDK adds no timer of its own.
   */
  tokenProvider: () => Promise<{
    authToken: string;
    expiresAt?: number | undefined;
  }>;
  /**
   * Your UQPAY client id. Not a secret. Must be printable ASCII with no
   * whitespace, or `init` rejects with `invalid_configuration`.
   */
  clientId: string;
  /** Sheet theming. See {@link Appearance}. */
  appearance?: Appearance | undefined;
  /** Ask the natives for verbose logs. Ignored by both natives in release builds. */
  debugLogging?: boolean | undefined;
};

/**
 * Options for {@link presentPaymentSheet}.
 *
 * @example
 * ```ts
 * const result = await presentPaymentSheet({
 *   paymentIntentId: 'pi_123',
 *   returnUrl: 'myapp://pay/return',
 *   presentation: 'methodList',
 * });
 * ```
 */
export type PresentOptions = {
  /**
   * The intent to pay, created by your server. Must match
   * `/^[A-Za-z0-9_-]{1,128}$/`, or the call rejects with
   * `invalid_configuration`.
   */
  paymentIntentId: string;
  /**
   * Where the bank / 3DS challenge returns to: an `https://` URL or a custom
   * scheme. Plain HTTP is rejected at call time. Prefer an `https://`
   * Universal Link / App Link you own (another app can register the same custom
   * scheme), and put no secret or order data in it.
   */
  returnUrl: string;
  /**
   * `'methodList'` (default) shows every method the intent allows;
   * `'cardOnly'` shows just the card form; `{ singleWallet }` goes straight to
   * one wallet.
   *
   * `{ singleWallet }` is **Android-only** until the iOS native SDK supports
   * it; on iOS it rejects with `invalid_configuration`.
   */
  presentation?:
    'methodList' | 'cardOnly' | { singleWallet: PaymentMethodType } | undefined;
  /**
   * Restrict the picker to these methods. An **empty array is rejected** on
   * both platforms so the two agree.
   *
   * **Android-only** until the iOS native SDK supports it; on iOS it rejects
   * with `invalid_configuration`.
   */
  allowedPaymentMethods?: PaymentMethodType[] | undefined;
  /**
   * Prefill for the card form. **Android-only**; ignored with a warning on iOS.
   * Not retained by the SDK after the sheet settles.
   */
  billingDetails?: BillingDetails | undefined;
  /**
   * iOS-only copy hook: the merchant name the iOS sheet shows in its header.
   * **Ignored on Android**, whose sheet has no equivalent slot.
   */
  merchantDisplayName?: string | undefined;
};
