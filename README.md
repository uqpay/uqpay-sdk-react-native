# UQPAY React Native SDK

[![CI](https://github.com/uqpay/uqpay-sdk-react-native/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/uqpay/uqpay-sdk-react-native/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-iOS%2015.1%2B%20%7C%20Android%20minSdk%2024-lightgrey.svg)
![React Native](https://img.shields.io/badge/React%20Native-New%20Architecture%20only-61DAFB.svg)
![Status](https://img.shields.io/badge/status-release%20candidate-orange.svg)

Accept cards (with 3-D Secure) and regional QR wallets in your React Native app
with UQPAY's native payment sheet. `@uqpay/react-native` wraps the published
native SDKs — [`UqpaySDKiOS`](https://github.com/uqpay/uqpay-sdk-ios) and
[`com.uqpay.sdk:uqpay-sdk-android`](https://github.com/uqpay/uqpay-sdk-android) —
behind one typed, promise-based API on a New-Architecture Turbo Module.
JavaScript owns the typed API, the result union, events and the Expo config
plugin; every payment operation (the card form, 3-D Secure, QR rendering,
polling, idempotency) runs inside the native SDKs, so **no card data ever
reaches your JavaScript**.

> [!IMPORTANT]
> **Release candidate: `1.0.0-rc.2`, published to npm under the `next` tag.
> Not yet tested with live payments.** The API on this page is the 1.0.0 contract and is
> frozen in [`etc/uqpay-react-native.api.md`](https://github.com/uqpay/uqpay-sdk-react-native/blob/main/etc/uqpay-react-native.api.md), but
> versions, native pins and platform floors can still move before 1.0.0.
> Integrate and test in **sandbox**; read
> [Limitations & platform differences](#limitations--platform-differences) and
> the [security checklist](#security-checklist-for-production) before you take
> real payments.

> [!WARNING]
> **Expo Go is not supported.** This package contains native code, so Expo apps
> need a [development build](#expo) (dev client or EAS Build). `init()` fails
> with a clear error naming Expo Go if you try.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation) — [bare React Native](#bare-react-native) · [Expo](#expo) · [release candidate](#installing-a-release-candidate)
- [How it works](#how-it-works)
- [Quick start](#quick-start) — [server](#1-server-token-and-payment-intent) · [app](#2-app-initialise-once) · [present](#3-app-present-the-sheet) · [confirm](#4-server-confirm-before-fulfilling)
- [Handling the result](#handling-the-result) — [`pending`](#pending-and-reconciliation) · [errors](#errors) · [events and the hook](#events-and-the-hook)
- [Configuration](#configuration) — [`init`](#init-options) · [`presentPaymentSheet`](#present-options) · [appearance](#appearance)
- [Return URLs and 3-D Secure](#return-urls-and-3-d-secure)
- [Testing](#testing) — [Jest](#unit-tests-with-jest) · [sandbox](#sandbox-testing) · [example apps](#example-apps)
- [Security](#security) — [checklist for production](#security-checklist-for-production)
- [Limitations & platform differences](#limitations--platform-differences)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation) · [Support](#support-and-reporting) · [Related SDKs](#related-sdks) · [License](#license)

---

## Features

- **Native payment sheet on iOS and Android.** The same UQPAY sheets the native
  SDKs ship, presented with one call: `presentPaymentSheet({ paymentIntentId, returnUrl })`.
- **Cards with 3-D Secure.** Both native sheets always run 3DS on card payments.
- **Regional QR wallets.** Merchant-presented QR: the sheet shows a QR code and
  the customer pays by scanning it in their wallet app. The SDK knows these
  method types (`PaymentMethodType`):

  | Type | Method | Type | Method |
  |---|---|---|---|
  | `card` | Card, with 3DS | `truemoney` | TrueMoney |
  | `wechatpay` | WeChat Pay | `tng` | Touch 'n Go |
  | `alipaycn` | Alipay | `gcash` | GCash |
  | `alipayhk` | AlipayHK | `dana` | DANA |
  | `grabpay` | GrabPay | `kakaopay` | KakaoPay |
  | `paynow` | PayNow | `tosspay` | Toss Pay |
  | `unionpay` | UnionPay | `naverpay` | Naver Pay |

  The sheet shows whatever the payment intent your server created allows —
  nothing is decided in the app. Apple Pay, Google Pay and native WeChat/Alipay
  app hand-off are [not supported](#not-supported-at-100).
- **No card data in JavaScript.** PAN, CVC, expiry and cardholder name stay
  inside the native sheet.
- **No API key in the app.** The SDK authenticates only through a short-lived
  token your server mints. There is no API-key, publishable-key or client-secret
  parameter anywhere in the public API, by design.
- **One typed result.** `presentPaymentSheet` resolves with a four-variant
  discriminated union — `completed | failed | canceled | pending` — frozen for
  the 1.x line, so a `switch` is exhaustive under `strict`.
- **Honest about unknown outcomes.** A payment whose outcome the device cannot
  know resolves `pending` with a `reconcile()` helper, never a false `failed`.
- **Expo config plugin**, a **scripted Jest mock** of the native module, and
  **theming** that maps onto both native sheets.
- **Small footprint.** No analytics, crash or ad SDK. The runtime dependency
  tree is `react` + `react-native` and nothing else.

## Requirements

Every release of this package pins exactly one version of each native SDK. That
mapping is the compatibility contract:

| `@uqpay/react-native` | `UqpaySDKiOS` | `uqpay-sdk-android` | React Native | Expo SDK | iOS | Android | Toolchain |
|---|---|---|---|---|---|---|---|
| 1.0.0-rc *(unreleased)* | 1.1.0 (`~> 1.1.0`) | 0.1.0 (exact) | ≥ 0.79; builds verified on 0.86 and 0.87 | ≥ 53; verified on 57 | deployment target 15.1 | `minSdk` 24, `compileSdk` 35 | Kotlin ≥ 2.0, AGP ≥ 8.6, Xcode ≥ 16.1, Node ≥ 20 |

- **Native SDKs are pinned.** The Android SDK is pinned to exactly `0.1.0`
  today; it moves to a patch range once `0.1.1` is published. You do not add
  either native SDK yourself — CocoaPods and Gradle pull the pinned versions in.
- **Verified vs declared.** The declared floors (React Native 0.79, Expo SDK 53)
  are what the package is written against; the builds we have actually verified
  are React Native 0.86 (Expo SDK 57) and 0.87. If you are on an older version
  in the supported range, test your build before release.
- **New Architecture only.** Turbo Modules + Codegen, bridgeless. There is no
  legacy-bridge fallback. The New Architecture has been React Native's default
  since 0.76; if your app has opted out of it, this package will not load.
- **React Native 0.79 with Xcode 26** — a known React Native / Xcode issue, not
  this SDK: a plain React Native 0.79 app fails to compile React Native's own
  `fmt` pod under Xcode 26 (`consteval` errors in `format-inl.h`). Use the
  community Podfile `post_install` fix that compiles `fmt` as C++17, or build
  React Native 0.79 with Xcode 16.x. This combination is not one we have
  verified.
- **Hermes** (the default engine). JSC is untested.
- **iOS and Android only.** No `react-native-web`, macOS or Windows — `init()`
  rejects with `unsupported_platform` on anything else. Importing the package
  never throws, so a shared codebase can import it on every platform.
- **A UQPAY merchant account** with sandbox credentials (client id and API key)
  for your **server**.

Raising a platform floor is a breaking change and only happens in a major
release; see [STABILITY.md](STABILITY.md).

## Installation

### Bare React Native

```sh
npm install @uqpay/react-native
cd ios && pod install
```

That is the whole installation for a bare React Native app. Autolinking
registers the module on both platforms — no `AppDelegate` or `MainApplication`
edits, no Podfile or Gradle changes, no Android manifest entries.

If your 3DS `returnUrl` uses a custom URL scheme, register that scheme on iOS —
see [Return URLs and 3-D Secure](#return-urls-and-3-d-secure). Android needs
nothing.

### Installing a release candidate

Release candidates are published to npm under the `next` dist-tag, so a plain
`npm install @uqpay/react-native` does not resolve until 1.0.0. Install the
current candidate explicitly:

```sh
npm install @uqpay/react-native@next
cd ios && pod install
```

The same package is attached to the [GitHub Release](https://github.com/uqpay/uqpay-sdk-react-native/releases/tag/v1.0.0-rc.2)
as a tarball with its checksum, if you prefer to install from a file:

```sh
npm install https://github.com/uqpay/uqpay-sdk-react-native/releases/download/v1.0.0-rc.2/uqpay-react-native-1.0.0-rc.2.tgz
```

**Expo apps:** install the tarball the same way — `npm install <url-or-path>`
(or `yarn add <url-or-path>`) — **not** `npx expo install <tgz>`. Expo CLI
currently mis-handles tarball specs, local or remote, and writes an `undefined`
dependency into `package.json`. Then continue with the [Expo](#expo) steps from
the config plugin onwards.

Everything else on this page is identical. When 1.0.0 is on npm, replace the URL
in your `package.json` with a normal version range.

### Expo

The SDK contains native code, so it needs a **development build** — Expo Go
cannot load it (`init()` rejects with a clear Expo Go error; see
[Troubleshooting](docs/troubleshooting.md#init-fails-naming-expo-go)).

```sh
npx expo install @uqpay/react-native
```

Add the config plugin to `app.json`:

```json
{
  "expo": {
    "plugins": [["@uqpay/react-native", { "iosUrlScheme": "myapp" }]]
  }
}
```

Then generate the native projects:

```sh
npx expo prebuild
```

and run a dev client locally (`npx expo run:ios` / `npx expo run:android`) or
build with EAS (`eas build --profile development`).

**What the plugin does.** On iOS it registers the URL scheme your bank/3DS step
returns to, as a `CFBundleURLTypes` entry named `com.uqpay.return`. It is
idempotent — re-running `prebuild` never duplicates it. On **Android it does
nothing**: the native SDK handles the bank return inside its own Activity, so no
manifest entry is required.

**`iosUrlScheme` is optional.** Without it the plugin uses your app's own
`expo.scheme` (the first entry if `scheme` is an array), and failing that
`expo.ios.bundleIdentifier`. Pass it only when you want the 3DS return URL on a
scheme different from your app's.

The plugin is the only place `@expo/config-plugins` is used; it is an **optional
peer dependency**, so bare React Native apps never install it.

**If your app handles the return deep link itself** (a `Linking` listener),
call `notifyReturnedFromBank()` from that listener when the return URL arrives,
so the SDK knows the customer is back. It matters on iOS, is a no-op on Android,
and never throws. See [Return URLs and 3-D Secure](#return-urls-and-3-d-secure).

**Expo Router.** The return URL (`myapp://pay/return`) also reaches Expo Router
as a navigation, like any other deep link into your app. Give it a route (for
example a screen that simply shows the checkout state) or filter it out, so the
customer does not land on an unmatched-route screen when they come back from the
bank.

## How it works

Your server holds the UQPAY API key; the app never does.

```
┌──────────┐ 1. "pay for cart 42"  ┌──────────────┐  x-api-key   ┌───────┐
│ Your app │ ────────────────────▶ │ Your backend │ ───────────▶ │ UQPAY │
│          │ ◀──────────────────── │              │ ◀─────────── │  API  │
│          │ 2. paymentIntentId    └──────────────┘              └───────┘
│          │    + client token            ▲  4. retrieve the intent,   ▲
│  native  │                              │     then fulfil            │
│  sheet   │ 3. card form, 3DS, QR, polling — straight to UQPAY ───────┘
└──────────┘
```

1. **Your server creates the payment intent** — amount, currency and customer
   from its own records — and **mints a short-lived client auth token** with its
   API key.
2. **The app calls `init()` once**, with a `tokenProvider` that fetches that
   token from your server, then **`presentPaymentSheet()`** with the intent id.
3. **The native sheet takes the payment** and resolves the promise with a
   result: a UX signal for the customer.
4. **Your server confirms** by retrieving the payment intent from the UQPAY API
   before it ships anything.

The [integration guide](docs/integration-guide.md#the-shape-of-an-integration)
has the long form.

## Quick start

A complete sandbox integration is four pieces. Copy them, then replace the
placeholders.

### 1. Server: token and payment intent

Your backend needs two routes the app can call — `POST /uqpay/client-token`
returning `{ authToken, expiresAt }` and `POST /uqpay/payment-intents` returning
`{ paymentIntentId }` — both **behind your own user authentication**. Behind
them, three UQPAY calls:

<!-- snippet: quickstart-server -->

```ts
// Server only (Node ≥ 20). The API key lives here and nowhere else.
const UQPAY_HOST =
  process.env.UQPAY_ENVIRONMENT === 'production'
    ? 'https://api.uqpay.com'
    : 'https://api-sandbox.uqpaytech.com';
const CLIENT_ID = process.env.UQPAY_CLIENT_ID!;

type ClientToken = { authToken: string; expiresAt: number };
let cached: ClientToken | null = null;
let inFlight: Promise<ClientToken> | null = null;

async function mintToken(): Promise<ClientToken> {
  const res = await fetch(`${UQPAY_HOST}/api/v1/connect/token`, {
    method: 'POST',
    headers: { 'x-client-id': CLIENT_ID, 'x-api-key': process.env.UQPAY_API_KEY! },
  });
  if (!res.ok) throw new Error(`token mint failed: ${res.status}`);
  const body = (await res.json()) as { auth_token: string; expired_at?: number };
  // expired_at is epoch SECONDS and sometimes absent; the app wants milliseconds.
  const expiresAt = body.expired_at ? body.expired_at * 1000 : Date.now() + 20 * 60_000;
  return { authToken: body.auth_token, expiresAt };
}

/** Handler for POST /uqpay/client-token. Never log the token. */
export async function getClientToken(): Promise<ClientToken> {
  // UQPAY allows ONE active token per merchant: minting a new one invalidates the
  // last. Cache it and single-flight the mint — never mint per request or per device.
  if (cached && Date.now() + 120_000 < cached.expiresAt) return cached;
  inFlight ??= mintToken()
    .then((token) => (cached = token))
    .finally(() => (inFlight = null));
  return inFlight;
}

async function uqpayHeaders(): Promise<Record<string, string>> {
  const { authToken } = await getClientToken();
  return { 'x-client-id': CLIENT_ID, 'x-auth-token': `Bearer ${authToken}` };
}

/** Handler for POST /uqpay/payment-intents. The price comes from YOUR order record. */
export async function createPaymentIntent(
  order: { id: string; amount: string; currency: string }, // amount: "8.98", major units
  idempotencyKey: string // a v4 UUID; reuse it when retrying the same order
): Promise<{ paymentIntentId: string }> {
  const res = await fetch(`${UQPAY_HOST}/api/v2/payment_intents/create`, {
    method: 'POST',
    headers: {
      ...(await uqpayHeaders()),
      'x-idempotency-key': idempotencyKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount: order.amount,
      currency: order.currency,
      merchant_order_id: order.id,
      description: `Order ${order.id}`.slice(0, 32), // sandbox rejects > 32 chars
    }),
  });
  if (!res.ok) throw new Error(`create intent failed: ${res.status}`);
  const body = (await res.json()) as { payment_intent_id?: string; id?: string };
  return { paymentIntentId: (body.payment_intent_id ?? body.id)! };
}

/** Before fulfilling: the server-side truth about a payment. */
export async function retrieveIntentStatus(paymentIntentId: string): Promise<string | undefined> {
  const res = await fetch(
    `${UQPAY_HOST}/api/v2/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    { headers: await uqpayHeaders() }
  );
  if (!res.ok) throw new Error(`retrieve intent failed: ${res.status}`);
  const body = (await res.json()) as { intent_status?: string; status?: string };
  return body.intent_status ?? body.status; // e.g. 'SUCCEEDED'
}
```

The [integration guide](docs/integration-guide.md#the-backend-contract) has the
full contract (headers, body fields, Connect sub-accounts), and
[`example/backend`](https://github.com/uqpay/uqpay-sdk-react-native/tree/main/example/backend) is a working, zero-dependency
reference with tests.

### 2. App: initialise once

Call `init` once at startup, after your user has signed in. The `tokenProvider`
fetches the token from **your** server, sending your own session credential:

<!-- snippet: token-provider -->

```ts
import { init } from '@uqpay/react-native';

declare function getSessionToken(): Promise<string>; // your app's own auth

await init({
  environment: 'sandbox', // choose per build, not from __DEV__ — see Configuration
  clientId: 'YOUR_UQPAY_CLIENT_ID', // identifies the merchant; not a secret
  // Called before every present, and whenever native needs a refresh.
  tokenProvider: async () => {
    const res = await fetch('https://your-server.example/uqpay/client-token', {
      method: 'POST',
      headers: { authorization: `Bearer ${await getSessionToken()}` },
    });
    if (!res.ok) throw new Error(`token endpoint ${res.status}`);
    return (await res.json()) as { authToken: string; expiresAt: number };
  },
});
```

### 3. App: present the sheet

<!-- snippet: quickstart -->

```ts
import { presentPaymentSheet } from '@uqpay/react-native';

export async function checkout(cartId: string, sessionToken: string) {
  // Your server creates the intent and decides the amount. Send a reference, not a price.
  const res = await fetch('https://your-server.example/uqpay/payment-intents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ cartId }),
  });
  if (!res.ok) throw new Error(`create intent failed: ${res.status}`);
  const { paymentIntentId } = (await res.json()) as { paymentIntentId: string };

  const result = await presentPaymentSheet({ paymentIntentId, returnUrl: 'myapp://pay/return' });
  switch (result.kind) {
    case 'completed': return 'show receipt; your server confirms before fulfilling';
    case 'failed': return result.error.userMessage; // safe to show the customer
    case 'canceled': return 'back to cart';
    case 'pending': return 'processing; reconcile, never charge again';
  }
}
```

### 4. Server: confirm before fulfilling

> [!IMPORTANT]
> **The client result is a UX signal, not proof of payment.**
> `kind: 'completed'` means the gateway accepted the payment on the device's
> last look at it. It is the right thing to show the customer, and the wrong
> thing to release goods on. **Before fulfilling, confirm on your server** by
> retrieving the payment intent from the UQPAY API (`retrieveIntentStatus`
> above). The device can be killed, lose its network or be tampered with
> between the payment and your `.then`; your server cannot.

That is a working integration. If you only read one more section, read
[Handling the result](#handling-the-result).

## Handling the result

`presentPaymentSheet` **resolves — it does not reject — for every expected
outcome**: declines, cancellations, timeouts and unknown outcomes all come back
as a `UqpayPaymentResult`. It rejects only for programmer error (no `init`, a
bad field, an unsupported platform, a native module missing from the build), and
every rejection is a `UqpayConfigurationError` — rejections from the native
layer are wrapped in it too.

`UqpayPaymentResult` is a discriminated union on `kind`. **The four variants are
frozen for the 1.x line**; new outcomes arrive as new error codes or new fields,
never as a fifth variant.

| `kind` | Means | What to do | Fields |
|---|---|---|---|
| `completed` | The gateway accepted the payment (for manual capture: authorised, possibly not yet captured). | Show a receipt. Fulfil only after your server has retrieved the intent. | `paymentIntentId`, `status` (almost always `'SUCCEEDED'`; see below), `amount?`, `currency?`, `paymentMethodType?`, `transactionId?`, `merchantOrderId?`, `completedAt?` |
| `failed` | The payment did not go through — **unless `error.isOutcomeUnknown`**. | Show `error.userMessage`; offer a retry when `error.isRetryable`. If `error.isOutcomeUnknown`, treat it as `pending`. | `paymentIntentId`, `error` |
| `canceled` | The sheet closed with no attempt, or the intent was cancelled server-side. | Return the customer to checkout. Nothing was charged. | `paymentIntentId`, `reason` (`'user_cancelled'` \| `'merchant_cancelled'` \| `'intent_cancelled'`) |
| `pending` | The outcome is **not known on the device**. | Show "processing". Never show failure, never charge again. [Reconcile](#pending-and-reconciliation). | `paymentIntentId`, `lastKnownStatus?`, `cause?`, `reconcile()` |

Notes that matter in production:

- `amount` is the **wire string in major units** (`'8.98'`), never a number and
  never re-scaled. Do no arithmetic on it; compare it as a string or parse it
  with a decimal library.
- **Manual capture: check the capture state on your server.** For an intent
  that is authorised and waiting for capture, both native sheets report
  `status: 'SUCCEEDED'` — the device cannot tell you whether it was captured.
  `'REQUIRES_CAPTURE'` appears only when the iOS bridge settled the result by
  re-reading the intent from the server. Either way it is a success, not a
  failure; decide on capture from the intent your server retrieves.
- `completedAt` is ISO-8601 UTC with millisecond precision
  (`yyyy-MM-ddTHH:mm:ss.SSSZ`) on both platforms, and is **informational only**:
  iOS reports the gateway's `completed_at`, Android reports the device's
  observation time. Neither is a settlement time.
- `transactionId` can be `undefined` on iOS (see
  [Limitations](#limitations--platform-differences)).

### `pending` and reconciliation

`pending` means the device cannot tell whether the money moved — typically the
confirm left the device and no answer came back. **Never show the customer a
failure, and never charge again.** `pending` is final for that promise on both
platforms.

There are two ways to resolve it, and you should implement both: settle it now
with `reconcile()`, and settle it on the next launch if the app was killed
first.

<!-- snippet: pending-reconcile -->

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { presentPaymentSheet } from '@uqpay/react-native';

const PENDING_KEY = 'uqpay.pendingIntent';

export async function payAndSettle(paymentIntentId: string) {
  const result = await presentPaymentSheet({
    paymentIntentId,
    returnUrl: 'myapp://pay/return',
  });
  if (result.kind !== 'pending') return result;

  // 1. Persist the id first — reconcile() needs the JS context that produced it,
  //    and a Metro reload or a process restart destroys that context.
  await AsyncStorage.setItem(PENDING_KEY, result.paymentIntentId);

  // 2. Ask native to settle it now. This re-presents the same intent; the
  //    terminal-intent guard returns the settled result without showing a form.
  const settled = await result.reconcile();
  if (settled.kind !== 'pending') await AsyncStorage.removeItem(PENDING_KEY);
  return settled;
}
```

<!-- snippet: reconcile-at-launch -->

```tsx
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPendingResult, presentPaymentSheet } from '@uqpay/react-native';

/** Call once, after init(), at app launch. */
export function useUqpayRecovery() {
  useEffect(() => {
    void (async () => {
      // A result that arrived while no JS listener existed — Metro reload, or
      // Android recreating the Activity after process death mid-3DS. Delivered
      // exactly once; a second call returns null.
      const buffered = await getPendingResult();
      if (buffered) console.log('recovered', buffered.kind, buffered.paymentIntentId);

      // A pending intent we persisted on a previous run. reconcile() is gone
      // with its JS context, so re-present instead: the terminal-intent guard
      // settles it without showing a form.
      const id = await AsyncStorage.getItem('uqpay.pendingIntent');
      if (id) {
        const settled = await presentPaymentSheet({
          paymentIntentId: id,
          returnUrl: 'myapp://pay/return',
        });
        if (settled.kind !== 'pending') await AsyncStorage.removeItem('uqpay.pendingIntent');
      }
    })();
  }, []);
}
```

`getPendingResult()` returns a result the native buffered because no JavaScript
was listening, and **clears it** — so it is delivered exactly once, never also
to a stale promise. It returns `null` when there is nothing to collect. The
[integration guide](docs/integration-guide.md#surviving-process-death-and-metro-reloads)
explains which mechanism covers which situation.

### Errors

Every failure carries a `UqpayError`:

| Field | |
|---|---|
| `code` | One of the canonical codes, or an unrecognised one passed through verbatim. |
| `userMessage` | Safe to show the customer as-is. No jargon, no stack, no platform name. |
| `developerMessage` | For your logs. Never contains a token, PAN, CVC or expiry. |
| `isRetryable` | `true` when retrying the same action can plausibly succeed. |
| `isOutcomeUnknown` | `true` when the payment may still have gone through. Reconcile server-side. |
| `declineCode?` | The gateway's decline code when it sent one. |
| `httpStatus?` | HTTP status, **iOS only** in practice: the Android native SDK does not expose it, so on Android it is `undefined` (the status appears only inside `developerMessage`). Do not branch on it across platforms — branch on `code`. |
| `traceId?` | Always `undefined` today — the gateway sends no trace header. |
| `raw?` | The native code/string when `code` is not canonical. |
| `platform` | `'ios'` or `'android'`. |

**[ERROR_CODES.md](ERROR_CODES.md) is the full table** — code, meaning,
retryable, outcome-unknown, what you should do, what the customer is told, and
which platform can emit it. It is generated from the same table the mappers use,
so it cannot drift.

Codes are an **open** union. Never compare against a closed set; a native or the
gateway can introduce a code without a wrapper release:

<!-- snippet: unknown-error-code -->

```ts
import { isUnknownErrorCode, type UqpayPaymentResult } from '@uqpay/react-native';

export function describe(result: UqpayPaymentResult): string {
  if (result.kind !== 'failed') return result.kind;
  const { code, raw, userMessage } = result.error;
  if (isUnknownErrorCode(code)) {
    // Report `raw` to UQPAY; still show the customer a safe message.
    console.warn('unrecognised UQPAY error code', code, raw);
  }
  return userMessage;
}
```

**Programmer errors reject.** A missing `init`, a blank `clientId`, an empty
`paymentIntentId`, an `http://` return URL, an unsupported platform — these
throw a `UqpayConfigurationError` at call time, naming the exact field, rather
than failing mid-payment. Its `code` is `'invalid_configuration'`,
`'not_initialized'` or `'unsupported_platform'`:

<!-- snippet: configuration-error -->

```ts
import { UqpayConfigurationError, presentPaymentSheet } from '@uqpay/react-native';

try {
  await presentPaymentSheet({ paymentIntentId: 'pi_123', returnUrl: 'http://nope' });
} catch (error) {
  if (error instanceof UqpayConfigurationError) {
    // Your bug, not the customer's. Fix the call; do not show this to a user.
    console.error(error.code, error.message);
  }
}
```

### Events and the hook

The promise is the primary API. Events are optional and additive — they carry
nothing the promise cannot give you, except late outcomes on iOS:

<!-- snippet: events -->

```ts
import { addPaymentListener } from '@uqpay/react-native';

const subscription = addPaymentListener((event) => {
  if (event.type === 'paymentReconciled') {
    // A late outcome upgrading an earlier `pending`. iOS only — Android never
    // emits it; settle a pending result there with reconcile() or your server.
    console.log('settled', event.result.kind, event.result.paymentIntentId);
  } else {
    // `requiresAction` is iOS-only — Android's native callback is result-only.
    // Never build UI that depends on receiving it.
    console.log('customer action:', event.action.type);
  }
});

subscription.remove();
```

`useUqpay()` is the same imperative API (`presentPaymentSheet`,
`cancelPaymentSheet`, `getPendingResult`), bound for use in a component:

<!-- snippet: use-uqpay -->

```tsx
import { Button } from 'react-native';
import { useUqpay } from '@uqpay/react-native';

export function PayButton({ paymentIntentId }: { paymentIntentId: string }) {
  const { presentPaymentSheet } = useUqpay();
  return (
    <Button
      title="Pay"
      onPress={() => {
        void presentPaymentSheet({
          paymentIntentId,
          returnUrl: 'myapp://pay/return',
        }).then((result) => console.log(result.kind));
      }}
    />
  );
}
```

`cancelPaymentSheet()` dismisses the sheet from your code; with nothing in
flight the promise resolves `canceled` / `merchant_cancelled`. See the
[platform notes](#limitations--platform-differences) for its timing windows.

## Configuration

### `init` options

`init(options: InitOptions)` configures both natives. Calling it again with the
**same** configuration is a no-op that only re-registers your `tokenProvider`,
which is what makes a Metro reload safe. Changing the configuration (for
example the appearance) means calling `init` again with the new one, which
rebuilds Android's token cache.

| Option | Type | |
|---|---|---|
| `environment` | `'sandbox' \| 'production'` | **Required.** Choose it from explicit per-build configuration, not `__DEV__` — see [sandbox vs production](docs/integration-guide.md#sandbox-vs-production). |
| `clientId` | `string` | **Required.** Your UQPAY client id. Not a secret. Must be printable ASCII with no whitespace, or `init` rejects with `invalid_configuration`. |
| `tokenProvider` | `() => Promise<{ authToken: string; expiresAt?: number }>` | **Required.** Returns a fresh merchant auth token from your server. |
| `appearance` | `Appearance` | Sheet theming. See [Appearance](#appearance). |
| `debugLogging` | `boolean` | Asks the natives for verbose logs. Ignored by both natives in release builds. |

**`tokenProvider` in detail.** It is called before every present, and whenever
native needs a refresh — cache the token on your side; UQPAY issues one active
token per merchant. `expiresAt` is epoch milliseconds. **Always return it** —
your server gets the expiry from UQPAY when it mints the token. If you leave it
out, the SDK prints one developer warning and treats the token as short-lived
(Android assumes five minutes), so it asks for a token more often than it needs
to. The SDK passes the token to native once and never logs it, stores it or
reads it back. If your provider throws, returns a blank token, or does not
settle within the native's 10 second budget, the payment resolves `failed` with
`authentication_failed`. The SDK adds no timer of its own.

**The token is a merchant credential.** Your token endpoint must require your
own signed-in user session, be rate-limited, and never be callable anonymously.
Do not log the token on your server or in the app.

**Never put your UQPAY API key (`x-api-key`) in the app.** Anyone with your app
binary has your key, and the key can create, capture, cancel and refund
payments for your whole account — an app binary is a public document. The key
belongs on your server, which uses it to mint the short-lived client token the
app receives and to create payment intents.

### Present options

`presentPaymentSheet(options: PresentOptions)` presents the sheet and resolves
with exactly one `UqpayPaymentResult`. Only one sheet can be open at a time.

| Option | Type | iOS | Android | |
|---|---|---|---|---|
| `paymentIntentId` | `string` | ✓ | ✓ | **Required.** Created by your server. Must match `/^[A-Za-z0-9_-]{1,128}$/`. |
| `returnUrl` | `string` | ✓ | ✓ | **Required.** Where the bank / 3DS step returns to. `https://` or a custom scheme; `http://` is rejected. See [Return URLs](#return-urls-and-3-d-secure). |
| `presentation` | `'methodList' \| 'cardOnly' \| { singleWallet }` | `methodList`, `cardOnly` | all | `'methodList'` (default) shows every method the intent allows; `'cardOnly'` just the card form; `{ singleWallet }` goes straight to one wallet. On iOS `{ singleWallet }` rejects with `invalid_configuration`. |
| `allowedPaymentMethods` | `PaymentMethodType[]` | rejected | ✓ | Restrict the picker. An empty array is rejected on both platforms. On iOS any value rejects with `invalid_configuration`. |
| `billingDetails` | `BillingDetails` | ignored | ✓ | Card-form prefill. Ignored on iOS with one `console.warn` per JS context. Not retained after the sheet settles. |
| `merchantDisplayName` | `string` | ✓ | ignored | The merchant name in the iOS sheet header. Android's sheet has no equivalent slot. |

Full signatures and types: the [API reference](docs/api/README.md).

### Appearance

Theming is set at **`init`**, not per payment — the Android native binds it to
its configuration. A common subset is mapped onto both platforms; anything
outside it goes through a per-platform escape hatch that is passed to native
untouched. Colours are hex strings, validated at `init`: an invalid value
rejects rather than rendering something unexpected.

<!-- snippet: appearance -->

```ts
import { init, type Appearance, type InitOptions } from '@uqpay/react-native';

declare const tokenProvider: InitOptions['tokenProvider'];

const appearance: Appearance = {
  colorMode: 'system', // or 'light' | 'dark'
  primaryColor: '#0A84FF',
  backgroundColor: '#FFFFFF',
  surfaceColor: '#F2F2F7',
  textColor: '#000000',
  secondaryTextColor: '#6E6E73',
  errorColor: '#FF3B30', // Android only — the iOS sheet is not themeable here
  cornerRadius: 12, // dp on Android, pt on iOS
  // Escape hatches, passed to native untouched:
  ios: { payButtonColor: '#0A84FF', fieldBorderColor: '#D1D1D6' },
  android: { light: { primary: '#FF0A84FF' }, dark: { primary: '#FF64D2FF' } },
};

await init({ environment: 'sandbox', clientId: 'ck_test_123', tokenProvider, appearance });
```

- **`ios` escape hatch** — `PaymentSheet.Appearance` colour property names from
  the iOS SDK, for example `primaryColorLight`, `titleColor`, `labelColor`,
  `fieldBackgroundColor`, `fieldBorderColor`, `payButtonColor`,
  `payButtonTextColor`, `closeButtonColor`, `cardBrand.visa` or
  `system.separator`. An unknown key is ignored (with a native debug-log
  warning), so check the result on a device.
- **`android` escape hatch** — `UQPayAppearance.Colors` names such as `primary`,
  per colour scheme (`light` / `dark`).
- **Gaps.** `errorColor` is **Android-only** (the iOS sheet exposes no error
  colour), and the iOS 3-D Secure screen is **not themeable at all** — it is
  hardcoded in the native SDK. Custom fonts are not supported on either
  platform.

## Return URLs and 3-D Secure

`returnUrl` is where the bank sends the customer back to your app after 3-D
Secure or a wallet hand-off. It must be a custom scheme your app registers, or
an `https://` Universal Link / App Link you own. Plain `http://` is rejected at
call time.

**Prefer `https://` in production.** An `https://` return URL backed by a
Universal Link needs no plist entry, and is the safer choice: any app can
register the same custom scheme (see the
[security checklist](#security-checklist-for-production)). Whichever you use,
put no secret, token or order data in the URL.

<a id="ios-the-3ds-return-url-scheme"></a>

**iOS, bare React Native.** If the URL uses a custom scheme, iOS needs to know
the scheme exists. Add it to `ios/<YourApp>/Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.uqpay.return</string>
    <key>CFBundleURLSchemes</key>
    <array><string>myapp</string></array>
  </dict>
</array>
```

With that in place, `returnUrl: 'myapp://pay/return'` works.

**iOS, Expo.** The [config plugin](#expo) registers the scheme for you.

**Android.** Nothing to configure. The native SDK handles the bank return inside
its own Activity; there is no manifest entry, no intent filter and no Gradle
change.

**Your own deep-link handler.** If your app already handles the return URL with
`Linking`, call `notifyReturnedFromBank()` so the SDK knows the customer is
back. It is a no-op on Android, never throws, and does nothing before `init()`
— see [the integration guide](docs/integration-guide.md#the-3ds-return-url).

## Testing

### Unit tests with Jest

The package ships a scripted mock native module, so you can test declines, 3DS
failures, cancellations, timeouts and pending payments on CI without a
simulator and without touching sandbox. It is the same mock the SDK's own suite
uses, so it cannot quietly drift from the real bridge.

Setup is one import in your Jest setup file — **no `jest.mock` call**:

<!-- snippet: jest-setup -->

```ts
// jest.setup.ts — importing the helper registers the mock as the native module.
import { beforeEach } from '@jest/globals';
import { uqpayNativeMock } from '@uqpay/react-native/jest';

beforeEach(() => {
  uqpayNativeMock.__reset();
});
```

**Bare React Native** — keep the Jest preset your app template already has
(current templates, e.g. React Native 0.87, use `@react-native/jest-preset`;
older ones use `react-native` — on 0.87 `preset: 'react-native'` fails with
"Module react-native should have jest-preset.js"). Add only
`setupFilesAfterEnv`, plus the `transformIgnorePatterns` entry if your config
does not already let Babel transform `@uqpay`:

```js
// jest.config.js
module.exports = {
  preset: '@react-native/jest-preset', // whatever your template ships
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Only if needed, so Babel transforms the package:
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@uqpay)/)',
  ],
};
```

**Expo** — use the `jest-expo` preset. It works with the helper as-is, with no
`transformIgnorePatterns` entry; only add `setupFilesAfterEnv` pointing at the
setup file above.

Then script what "native" does next:

<!-- snippet: jest-mock -->

```ts
import { expect, it } from '@jest/globals';
import { init, presentPaymentSheet } from '@uqpay/react-native';
import { uqpayNativeMock as native } from '@uqpay/react-native/jest';

it('shows the decline message', async () => {
  native.__setPlatform('android');
  await init({ environment: 'sandbox', clientId: 'ck_test_1', tokenProvider: native.tokenProvider });

  native.__nextResult({
    kind: 'failed',
    paymentIntentId: 'pi_1',
    error: { code: 'card_declined', developerMessage: 'issuer declined', isOutcomeUnknown: false },
    platform: 'android',
    resultId: 'r1',
  });

  const result = await presentPaymentSheet({ paymentIntentId: 'pi_1', returnUrl: 'myapp://pay/return' });
  expect(result.kind).toBe('failed');
});
```

The full list of scripting hooks is in [`jest/README.md`](jest/README.md).

### Sandbox testing

Sandbox behaves differently from production in ways that will otherwise look
like SDK bugs.

**Test cards.** Use the UQPAY sandbox test cards with **exactly** the expiry and
CVC listed — the sandbox ACS rejects the 3DS card with any other expiry/CVC
(`3ds_failed`, authentication status `N`). Both native sheets always enforce
3DS, so only cards enrolled with the sandbox ACS can succeed through this SDK.
Verified 2026-09-22 against the sandbox gateway:

| Card | Number | Expiry | CVC | Result |
|---|---|---|---|---|
| Mastercard, 3DS | `5521 9700 7999 8012` | **10/28** | **001** | Frictionless 3DS `Y`, intent `SUCCEEDED`. The **only** 3DS-enrolled card. |
| UnionPay | `6250 9470 0000 0014` | **12/33** | **123** | No 3DS redirect, intent `SUCCEEDED`. |
| Mastercard (UQPAY quickstart) | `5346 9301 0010 8117` | 12/26 | 811 | **Not** 3DS-enrolled ("not in card bin range"): always `3ds_failed` through the native sheets. Works only with `skip_3ds`, which the sheets never send. |
| Mastercard (UQPAY quickstart) | `5413 3300 5700 4047` | 12/27 | 989 | Same as above. |
| Visa, 3DS | — | — | — | Returns `system_error`. |

All of this is sandbox behaviour, not a bug in this package.

| | |
|---|---|
| **Forcing declines** | Not documented by either native SDK, and we have not verified a trigger list. Use the gateway's sandbox decline triggers — see the UQPAY API documentation — or ask UQPAY support for the current test-card matrix. |
| **Wallets** | Which wallets are enabled in sandbox depends on your merchant account. If a wallet returns `system_error`, ask UQPAY support to confirm it is enabled for your account. |
| **QR wallets** | ⚠️ **Sandbox QR wallets settle on real rails.** Scanning a sandbox QR with a real wallet app moves real money. Get budget and approval before scanning; do not scan casually. |
| **Tokens** | **One active token per merchant.** Minting from a second machine invalidates the first tester's session. Coordinate before running two backends against the same merchant. |
| **Intents** | Expire **30 minutes** after creation. A stale intent resolves through the terminal-intent guard, not a payment form. |

**Going to production** means `environment: 'production'` at `init`, chosen by
an explicit per-build setting rather than `__DEV__`, plus production
credentials on your backend. Work through the
[security checklist](#security-checklist-for-production) first. See
[the integration guide](docs/integration-guide.md#sandbox-vs-production).

### Example apps

- [`example/`](https://github.com/uqpay/uqpay-sdk-react-native/tree/main/example) — a bare React Native app that exercises the
  whole package: every result variant field by field, the pending/reconcile
  path, buffered-result recovery, the event stream, theming and a webhook inbox.
- [`example/backend`](https://github.com/uqpay/uqpay-sdk-react-native/tree/main/example/backend) — a zero-dependency Node
  reference merchant backend with `POST /client-token` (single-flight minting,
  120 s refresh margin) and `POST /payment-intents`. It is a demo, not a
  production server — its endpoints are unauthenticated and it takes the amount
  from the request.
- [`example-expo/`](https://github.com/uqpay/uqpay-sdk-react-native/tree/main/example-expo) — the same integration in an Expo
  app, built with the config plugin and a development build.

They run against sandbox with only a config change. To run the bare example
from a clone of this repository:

```sh
cp example/.env.template example/.env   # fill UQPAY_CLIENT_ID and the API key
node example/scripts/gen-env.mjs
node example/backend/server.mjs         # leave running
yarn && yarn example start --reset-cache
yarn example ios                        # or: yarn example android
```

## Security

How the SDK protects card data and credentials:

- **HTTPS only.** Every host is hardcoded `https://` in the natives, and there
  is no base-URL override anywhere in the public surface. A `returnUrl` starting
  `http://` is rejected at call time.
- **No certificate pinning**, deliberately. Both native SDKs made this call, and
  we inherit it: a pinned certificate turns a routine certificate rotation into
  a total outage for every already-installed app binary, with no server-side
  remedy. TLS with standard trust-store validation is the protection here.
- **No card data crosses into JavaScript.** The PAN, CVC, expiry and cardholder
  name live entirely inside the native sheet. Nothing card-derived appears in
  `console.log`, Metro output, React DevTools props or an error message, and the
  SDK writes nothing to `AsyncStorage`, MMKV or the filesystem from JavaScript.
- **No API key.** The SDK authenticates only through your `tokenProvider`. Your
  token value is passed to native once and never logged, stored or re-read.
- **Debug builds pre-fill the card form on iOS.** The iOS native SDK auto-fills
  the card form with mock data in `DEBUG` builds. If your React Native debug
  build compiles the SDK in Debug configuration, you will see a pre-filled form.
  This **never** happens in a release build.
- **Native loggers are off in release.** `debugLogging: true` at `init` asks the
  natives for verbose logs and is ignored by both in release builds. The iOS
  SDK's raw log handler is not exposed to JavaScript at all.
- **Screenshots of the card form are not blocked.** Neither native sets
  Android's `FLAG_SECURE` or an iOS secure-field overlay. Requested upstream.
- **No third-party SDKs.** No analytics, crash or ad SDK is bundled, and the
  runtime dependency tree is `react` + `react-native` and nothing else.

Data collection, for Apple's privacy nutrition label and Google Play's Data
Safety form: **[PRIVACY.md](PRIVACY.md)**. Reporting a vulnerability:
**[SECURITY.md](https://github.com/uqpay/uqpay-sdk-react-native/blob/main/SECURITY.md)**.

### Security checklist for production

This SDK keeps card data out of your JavaScript. It cannot protect your server,
and a phone is not a trusted environment: a rooted or modified device can fake
anything your JavaScript sees. Go through this list before you take real
payments.

**Credentials**

- [ ] **The auth token is a merchant credential.** Treat the token your
      `tokenProvider` returns like a password. Your token endpoint requires your
      own signed-in user session, is rate-limited, and is never callable
      anonymously.
- [ ] **No UQPAY API key or client secret in the app** — not in the bundle, not
      in an `EXPO_PUBLIC_*` or other build-time variable, not in a remote config
      the app downloads. The API key stays on your server.
- [ ] **Tokens are never logged** — not on your server, not in the app, not in
      crash reports or analytics.

**Payment intents**

- [ ] **Intents are created server-side only.** Your server decides the amount,
      currency and customer from its own records (the order or cart). The app
      sends an order reference, never a price or currency your server trusts.
- [ ] **Your server confirms every payment before fulfilling.** Never ship
      goods, credit a balance or mark an order paid because the SDK said
      `completed`. Retrieve the payment intent from the UQPAY API on your
      server (`GET /api/v2/payment_intents/{id}`) and act on its status.
- [ ] **Webhooks are a hint, for now.** UQPAY has not yet published a webhook
      signature scheme for this integration. Until it does, treat an incoming
      webhook as a prompt to re-fetch the intent from the UQPAY API, never as
      proof of payment on its own.
- [ ] **`pending` means unknown.** Do not show success, do not show failure,
      and do not charge again. Persist the `paymentIntentId` and reconcile on
      your server. Treat `failed` with `error.isOutcomeUnknown` the same way.
- [ ] **Manual capture: capture state lives on your server.** The sheet reports
      `SUCCEEDED` for an intent that is only authorised. Decide whether and when
      to capture from the intent your server retrieves.

**App configuration**

- [ ] **Return URLs are https where you can.** Any app can register the same
      custom URL scheme as yours. Prefer an `https://` Universal Link (iOS) /
      App Link (Android) you own, and put no secret, token or order data in the
      return URL.
- [ ] **Sandbox vs production is an explicit build setting.** Choose
      `environment` from per-build configuration (a build flavour, scheme or EAS
      profile), not from `__DEV__` — otherwise an internal QA or staging release
      build silently talks to production. Your server's UQPAY host and
      credentials must match what the app is built for.

The [integration guide](docs/integration-guide.md) shows the server side of
each of these.

## Limitations & platform differences

Read this before you integrate, not after. Everything here ships unresolved in
1.0.0.

### Not supported at 1.0.0

| Not supported | Why | What to do instead |
|---|---|---|
| Web / `react-native-web` | This package wraps native iOS and Android SDKs; neither runs in a browser. | UQPAY's Flutter package or a hosted checkout page is the web route. |
| Apple Pay / Google Pay | Not available in either native SDK yet. `applepay` / `googlepay` can appear in sandbox `available_payment_method_types`; both native sheets hide them. | On the roadmap. |
| Native WeChat / Alipay **app hand-off** | Requires the vendors' native SDKs; both natives ship the merchant-presented QR flow only. | QR flow in-sheet. |
| Creating or cancelling a payment intent from the app | Requires your UQPAY API key, which must never be in an app. | Your backend creates (and cancels) the intent. |
| Headless card confirm | Android native has no public headless API. | Use the sheet; a headless API is a possible future addition. |
| Custom fonts in the sheet | iOS native has no font API; Android theming is colour + corner radius only. | Not supported. |
| Localisation beyond English | Both natives ship English only. Android strings are resource-overridable by the host app; iOS has no override hook. | Override the Android strings; iOS localisation is requested upstream. |
| Certificate pinning | Deliberately not done by either native (a certificate rotation would break every installed app). | See [Security](#security). |
| Expo Go | Native code. | Expo dev client / EAS Build only. |

### At a glance

| | iOS | Android |
|---|---|---|
| `presentation: { singleWallet }`, `allowedPaymentMethods` | Rejected (`invalid_configuration`) | Supported |
| `billingDetails` prefill | Ignored, one warning | Supported |
| `merchantDisplayName` | Shown in the sheet header | Ignored |
| `appearance.errorColor` | Ignored | Supported |
| `paymentReconciled` / `requiresAction` events | Emitted | Never emitted |
| Token refresh while the sheet is open | Not possible — the token is fetched once per present | Native can ask `tokenProvider` for a refresh |
| Raw EMVCo QR payload (no `qr_code_url`) | Rendered | Not rendered |
| QR `expires_at` countdown | Not shown | Shown |
| `error.httpStatus` | Set when known | Always `undefined` |
| Sandbox badge on the sheet | No | Yes |
| `completedAt` source | Gateway's `completed_at` | Device observation time |

### iOS

- **`presentation: { singleWallet }` and `allowedPaymentMethods` are rejected**
  with `invalid_configuration`. The iOS native has only `cardOnly` and
  `paymentList`; the Android set is in the contract and iOS gains it when the
  upstream change lands.
- **`billingDetails` is ignored**, with one `console.warn` per JS context. The
  iOS native has no prefill API.
- **No token refresh mid-sheet.** The iOS sheet takes a static header token. The
  SDK calls your `tokenProvider` immediately before every present, but a token
  that expires while the customer is still in the sheet cannot be renewed —
  the payment fails and the customer retries. UQPAY tokens live 30 minutes.
- **`transactionId` may be `undefined`.** iOS falls back to the intent id when
  it has no attempt id; the bridge drops it rather than reporting the intent id
  as an attempt id.
- **`appearance.errorColor` is ignored.** The iOS sheet exposes no error colour,
  so the field is Android-only until the upstream change lands.
- **The 3-D Secure screen is not themeable.** It is hardcoded in the native SDK
  and ignores your `appearance` entirely.
- **`cancelPaymentSheet()` before the sheet is on screen** (while the SDK is
  still fetching the token) stops the sheet from appearing; the promise
  resolves `canceled` / `merchant_cancelled`. The same holds on Android.
- **`cancelPaymentSheet()` during a silent confirm may resolve `pending`.** The
  iOS native does not tell the SDK when a frictionless (no-3DS) card confirm has
  started, so a cancel issued in that window falls back to a 5 second wait and
  then reports `pending` rather than `canceled`. That is the safe answer — the
  confirm may already have left the device — but it means a merchant-initiated
  cancel is not always a `canceled` result. Reconcile as usual.
- **Wallet-screen errors do not reach the SDK.** A confirm error on the iOS
  wallet screen is shown to the customer by the native but is not reported to
  the delegate. The bridge resolves `canceled` when the wallet screen closed
  with no attempt, and `pending` when an attempt had started.
- **Some card confirms settle a few seconds late on iOS.** When the gateway
  answers a card confirm with `REQUIRES_CUSTOMER_ACTION` and no `next_action`
  (seen with the UnionPay sandbox card), or the native 3DS poll times out or
  loses the network, the iOS native sheet shows its own failure screen and
  reports `unknown`, `timeout` or `network_error`. The bridge ignores that
  guess and reads the intent from the server instead: the promise resolves
  `completed`, `failed` or `canceled` from the server's status, usually within a
  few seconds and at most ~20 s. If the intent is still in flight after that, it
  resolves `pending` with `isOutcomeUnknown: true` and a later outcome arrives as
  a `paymentReconciled` event. Android polls natively and needs none of this.
- **`completedAt` is the gateway's `completed_at`** — informational, not a
  settlement time. (Android reports the device's observation time instead; both
  are formatted as millisecond-precision ISO-8601 UTC.)
- **`java_enabled: true` is fabricated** in the device info iOS sends. Native
  behaviour, noted for completeness.

### Android

- **`error.httpStatus` is always `undefined`.** The Android native SDK does not
  expose the HTTP status; it appears only inside `developerMessage`. The same
  gateway 401 gives `httpStatus: 401` on iOS and `undefined` on Android, so
  branch on `error.code`, never on `httpStatus`.
- **Raw EMVCo QR payloads are not rendered.** The Android native renders only
  `qr_code_url`; if the gateway returns a raw `qr_code` string and no URL, no QR
  appears. iOS renders both.
- **A dark-mode or locale change loses typed card fields.** The Android sheet's
  Activity is recreated on those configuration changes and the partially typed
  card form is not restored. The customer re-types; nothing is charged.
- **`cancelPaymentSheet()` has a brief no-op window.** A cancel that arrives
  while the SDK is still fetching the token stops the sheet from appearing
  (the promise resolves `canceled` / `merchant_cancelled`). But in the moment
  after the native has launched the sheet and before its Activity exists, the
  native has nothing to dismiss and the cancel does nothing. Call it again, or
  let the customer dismiss the sheet.
- **App-to-app 3DS resolves `pending`.** When the issuer's ACS returns an
  `intent://` app-to-app URL, the Android native consumes it but never launches
  it, and the payment resolves `pending`. Reconcile server-side.
- **QR `expires_at` countdown is shown** on Android and decoded-but-unused on
  iOS, so the two platforms look different on a wallet screen.
- **The wallet screen re-polls on foreground** on Android only.
- **A sandbox badge is shown** on the Android sheet, not the iOS one.
- **The host Activity must be a `ComponentActivity`.** A plain `Activity` host
  (unusual brownfield setups) is unsupported by the native SDK.

### Both platforms

- **`onBehalfOf` is not a thing in this SDK.** Neither native's *sheet* path
  applies the `x-on-behalf-of` header, so we do not expose an option that would
  silently do nothing. **Configure UQPAY Connect sub-account payments when your
  backend creates the payment intent** — that is where the routing is decided.
- **A 5xx on the confirm path resolves `pending`, not `failed`** — on both
  platforms, by design. Once the confirm has left the device the outcome is
  genuinely unknown, and reporting `failed` would invite a second charge.
  `server_error` remains reachable on the *load* path (fetching the intent).
- **`pending` is final for the promise.** iOS may deliver a late upgrade via the
  `paymentReconciled` event (Android never emits it); the promise itself never
  resolves twice.
- **`user_cancelled` does not distinguish a swipe from the cancel button.**
  Neither native reports the difference.
- **`traceId` is always `undefined`.** The gateway sends no trace header today.
- **One sheet at a time.** A second `presentPaymentSheet` while one is open
  resolves `failed` / `invalid_configuration` rather than opening two sheets.
- **No headless API.** `retrieveIntent`, `confirmCard` and `reconcileUnresolved`
  do not exist at 1.0.0 — the Android native exposes no public headless surface.
  `pending.reconcile()` is implemented by re-presenting the same intent.

## Troubleshooting

The common failure modes and what they mean are in
**[docs/troubleshooting.md](docs/troubleshooting.md)**:

- [The sheet opens blank or unstyled on iOS](docs/troubleshooting.md#the-sheet-opens-blank-or-unstyled-on-ios) (pod resource bundle not found)
- [`use_frameworks!` linkage](docs/troubleshooting.md#use_frameworks-static-or-dynamic)
- [Kotlin / Compose version conflicts](docs/troubleshooting.md#kotlin-or-compose-version-conflict-on-android)
- ["registering after STARTED" on Android](docs/troubleshooting.md#androidx-registering-after-started-crash)
- [`init` fails naming Expo Go](docs/troubleshooting.md#init-fails-naming-expo-go)
- ["The UQPAY native module is not in this app binary"](docs/troubleshooting.md#the-uqpay-native-module-is-not-in-this-app-binary)
- [No foreground Activity (`getCurrentActivity() == null`)](docs/troubleshooting.md#failed--invalid_configuration-no-foreground-activity)
- [3DS opens and never returns](docs/troubleshooting.md#3ds-opens-and-never-comes-back)
- ["The payment succeeded but my promise said `pending`"](docs/troubleshooting.md#the-payment-succeeded-but-my-promise-said-pending)
- [Metro reload mid-payment](docs/troubleshooting.md#metro-reload-mid-payment)
- [`authentication_failed` on every payment](docs/troubleshooting.md#authentication_failed-on-every-payment)
- [The card form is pre-filled with a test card](docs/troubleshooting.md#the-card-form-is-pre-filled-with-a-test-card)

## Documentation

| | |
|---|---|
| [Integration guide](docs/integration-guide.md) | The long form of this page: backend contract, sandbox vs production, confirming server-side, process death and Metro reloads, return URLs. |
| [API reference](docs/api/README.md) | Every exported function and type, generated from TSDoc. |
| [Error codes](ERROR_CODES.md) | Every code, what it means, and what to do. Generated. |
| [Troubleshooting](docs/troubleshooting.md) | Symptoms, causes and fixes. |
| [Migration guide](docs/migration.md) | Coming from the native iOS, Android or Flutter SDKs. |
| [Stability policy](STABILITY.md) | What is public API, what counts as breaking, supported version range. |
| [Privacy and data collection](PRIVACY.md) | For Apple's privacy nutrition label and Google Play's Data Safety form. |
| [Changelog](CHANGELOG.md) | Every release, with the native SDK versions it pins. |
| [Release process](docs/release-process.md) | How releases are cut (for maintainers). |
| [Contributing](https://github.com/uqpay/uqpay-sdk-react-native/blob/main/CONTRIBUTING.md) · [Code of conduct](https://github.com/uqpay/uqpay-sdk-react-native/blob/main/CODE_OF_CONDUCT.md) | Working on this repository. |

## Support and reporting

- **A bug in this SDK** — open a
  [GitHub issue](https://github.com/uqpay/uqpay-sdk-react-native/issues) with
  the `@uqpay/react-native` version, React Native / Expo version, platform and
  OS version, the `UqpayError` `code` and `developerMessage`, and steps to
  reproduce. Never paste a token, API key or card number.
- **Your UQPAY account, a payment, or credentials** —
  [it@uqpay.com](mailto:it@uqpay.com).
- **A security vulnerability** — please do not open a public issue. See
  [SECURITY.md](https://github.com/uqpay/uqpay-sdk-react-native/blob/main/SECURITY.md).

## Related SDKs

- [UQPAY iOS SDK](https://github.com/uqpay/uqpay-sdk-ios) (`UqpaySDKiOS`) — the
  native iOS SDK this package wraps.
- [UQPAY SDK for Android](https://github.com/uqpay/uqpay-sdk-android)
  (`com.uqpay.sdk:uqpay-sdk-android`) — the native Android SDK this package
  wraps.

## License

MIT. See [LICENSE](LICENSE).
