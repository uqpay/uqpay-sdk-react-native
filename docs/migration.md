# Migration guide

For teams already integrated with one of UQPAY's other SDKs and moving to
`@uqpay/react-native`. This is a concept map, not a tutorial — see the
[integration guide](./integration-guide.md) for the quickstart and the
[API reference](./api/README.md) for full signatures.

The React Native SDK wraps the same two native SDKs these teams already use,
so the underlying payment behaviour —
3DS, wallet/QR flows, idempotency, terminal-intent handling — is unchanged.
What changes is the shape of the API: one typed, promise-based surface
instead of a delegate/callback per platform.

## Coming from the native iOS SDK (`UqpaySDKiOS`)

| iOS SDK | `@uqpay/react-native` | Notes |
|---|---|---|
| `PaymentSheet` + `PaymentDelegate` | `presentPaymentSheet(options)` | One `await`ed call replaces constructing a sheet and implementing a delegate. |
| `paymentSheet(_:didCompleteWithResult:)` | Promise resolves `{ kind: 'completed', ... }` | |
| `paymentSheet(_:didFailWithError:)` | Promise resolves `{ kind: 'failed', error }` | Never a rejected promise or thrown error — see below. |
| `paymentSheetDidCancel(_:)` | Promise resolves `{ kind: 'canceled', reason: 'user_cancelled' }` | |
| `paymentSheet(_:paymentDidBecomePending:)` | Promise resolves `{ kind: 'pending', ... }` once; the later terminal outcome (iOS detached reconciliation, up to ~75 s) arrives as a `paymentReconciled` event via `addPaymentListener`, and is what `result.reconcile()` returns. | `pending` is final for the promise on both platforms — the delegate's later complete/fail callback has no promise equivalent. |
| `paymentSheet(_:requiresAction:)` | `requiresAction` event via `addPaymentListener` | Still iOS-only; there is no Android equivalent, so `PaymentEvent`'s `requiresAction` variant is documented as iOS-only. (`paymentReconciled` is iOS-only too.) |
| `PaymentSheetError.notReady` / `.failed` / `.authenticationTimedOut` | `UqpayConfigurationError` thrown by `init`/`presentPaymentSheet`, or a `{ kind: 'failed' }` result | Programmer error throws; payment outcomes resolve (see below). |
| `PaymentSheetError.intentNotPayable` | `{ kind: 'completed' | 'failed' | 'canceled' }`, matching the intent's actual terminal status | The wrapper's terminal-intent guard normalises this to the same result Android produces for the same case. |
| `PaymentError.ErrorCode` (10 cases) | `UqpayErrorCode` (14 canonical codes ∪ the Android set) | See the error-code note below. |
| `amount: Double` (deprecated) / `amountDecimal: Decimal?` | `amount?: string` | Always the original wire string, never re-scaled through a floating-point type. |
| `notifyReturnedFromBank()` (no iOS SDK equivalent — the sheet observes `Notification.Name("PaymentReturnedFromBank")` itself) | `notifyReturnedFromBank()` | Only needed if your app's own `Linking` handler intercepts the 3DS return URL before the sheet sees it; no-op on Android. |

## Coming from the native Android SDK (`uqpay-sdk-android`)

| Android SDK | `@uqpay/react-native` | Notes |
|---|---|---|
| `UQPay.initialize(application, config)` | `init(options)` | Same idempotency rule: re-calling with the same non-secret config is a no-op that keeps the token cache; a different config while a sheet is open rejects. |
| `UQPay.createPaymentLauncher(caller, callback)` + `launcher.launch(...)` | `presentPaymentSheet(options)` | The wrapper owns activity-result registration internally; nothing to register from your app. |
| `PaymentCallback.onResult(result)` | Promise resolves with a `UqpayPaymentResult` | One callback per `launch()` becomes one promise settlement — same "exactly once" contract. |
| `PaymentStatus.SUCCEEDED` | `kind: 'completed'`, `status: 'SUCCEEDED'` | |
| `PaymentStatus.FAILED` | `kind: 'failed'` | |
| `PaymentStatus.CANCELLED` | `kind: 'canceled'` | |
| `PaymentStatus.PENDING` | `kind: 'pending'` | |
| `UQPayErrorCode` | `UqpayErrorCode` | Same wire values — the Android error codes pass through the bridge's error mapper unchanged; the type is widened to an open string union (`UqpayErrorCode = <fourteen canonical codes> | (string & {})`) so a code Android adds later still round-trips instead of throwing. Use `isUnknownErrorCode()` rather than an exhaustive switch. |

## Coming from the Flutter SDK (`uqpay-sdk-flutter`)

Both SDKs share the same design: a frozen, discriminated **result union**
instead of a status enum plus a separate error object. If your team already
built against the Flutter SDK's `UqpayPaymentResult`, the mental model
carries over directly — `kind` plays the role Flutter's own discriminant
does, and the four variants (`completed`, `failed`, `canceled`, `pending`)
are the same shape: `pending` carries `reconcile()` rather than leaving the
caller to poll.

The one capability gap: **`reconcileUnresolved()` is not available in
`@uqpay/react-native` at 1.0.0.** The Flutter SDK can list every unresolved
pin from its idempotency store at app start; neither native mobile SDK
exposes that listing publicly today, so the React Native wrapper cannot
build it without touching internal native classes. It may be added once the
native SDKs expose that listing. Until then,
persist `paymentIntentId` yourself and resolve a `pending` result with
`result.reconcile()` (same session) or by calling `presentPaymentSheet`
again with the same `paymentIntentId` after a restart — the terminal-intent
guard on both natives returns the settled result without showing a form.

## Error handling, in general

Across all three source SDKs, expected payment outcomes (a decline, a
cancel, a timeout, a pending result) surface through whatever
platform-native "here's a result" channel exists — a delegate callback, a
callback interface, a Dart `Future` that resolves. `@uqpay/react-native`
keeps that same rule but narrows it to one channel: `presentPaymentSheet()`
**resolves** for every expected outcome and **rejects only for programmer
error** — no `init`, a blank required field, a plain-`http://` `returnUrl`,
an unsupported platform, or a native module missing from the build — always
with a `UqpayConfigurationError`. If you are porting error-handling code that
distinguished "the delegate reported a decline" from "the SDK threw," that
distinction now lives entirely in the resolved result's `kind`, not in
try/catch.
