# Integration guide

The long form of the [README](../README.md). Read the README quickstart first —
this page is what you reach for when you are wiring the payment into a real app
with a real backend.

- [The shape of an integration](#the-shape-of-an-integration)
- [The backend contract](#the-backend-contract)
- [Sandbox vs production](#sandbox-vs-production)
- [Confirm on your server before fulfilling](#confirm-on-your-server-before-fulfilling)
- [Surviving process death and Metro reloads](#surviving-process-death-and-metro-reloads)
- [The 3DS return URL](#the-3ds-return-url)
- [Testing without a simulator](#testing-without-a-simulator)

Before going live, work through the
[security checklist for production](../README.md#security-checklist-for-production)
in the README. This guide shows the server side of each item.

---

## The shape of an integration

```
┌─────────┐   1. create intent    ┌──────────────────┐   x-api-key   ┌───────┐
│   app   │ ────────────────────▶ │  your backend    │ ────────────▶ │ UQPAY │
│         │ ◀──────────────────── │                  │ ◀──────────── │       │
│         │   2. client token     └──────────────────┘               └───────┘
│         │                                ▲                              │
│ native  │   3. the payment itself        │      4. webhook              │
│  sheet  │ ───────────────────────────────┼──────────────────────────────┘
└─────────┘                          the outcome you fulfil orders from
```

Four responsibilities, and only one of them is in the app:

1. **Your backend creates the payment intent.** It holds the `x-api-key`; the
   app never does. Your server decides the amount, currency and customer. This
   is also where UQPAY Connect routing is decided — see
   [sub-accounts](#connect-sub-accounts).
2. **Your backend mints the client auth token.** Short-lived, one active token
   per merchant. The app fetches it through `tokenProvider`, from an endpoint
   that only your signed-in users can call.
3. **The app presents the sheet.** `presentPaymentSheet(...)` returns a UX
   signal.
4. **Your backend confirms the outcome** by retrieving the payment intent from
   the UQPAY API (prompted by a webhook, the app, or a timer). That is what you
   fulfil from.

## The backend contract

Your app needs two endpoints on **your** server. Neither accepts an amount the
client chose, and both sit behind your own user authentication.

Your server talks to one of two UQPAY hosts. Choose it from server
configuration, and make sure it matches the `environment` the app was built
with — a sandbox token does not work against production:

| Environment | UQPAY API host |
|---|---|
| `sandbox` | `https://api-sandbox.uqpaytech.com` |
| `production` | `https://api.uqpay.com` |

The calls the reference backend makes, all on that host:

| Call | Purpose |
|---|---|
| `POST /api/v1/connect/token` | Mint the auth token. Headers `x-client-id` and `x-api-key`; no body. |
| `POST /api/v2/payment_intents/create` | Create an intent. Headers below. |
| `GET /api/v2/payment_intents/{id}` | Retrieve an intent — the server-side truth you fulfil from. |

The payment-intent calls authenticate with `x-client-id` plus
`x-auth-token: Bearer <token>` (a custom header, not `Authorization`). For
UQPAY's full API reference, see UQPAY's API documentation; this guide covers
only what this SDK's flow needs.

### `POST /uqpay/client-token`

Returns `{ authToken, expiresAt }` — `expiresAt` in epoch **milliseconds**.
Always include it: without it the SDK treats the token as short-lived (Android
assumes five minutes) and asks for a new one more often.

**The token is a merchant credential**, and this endpoint hands it to a device.
Require your own authenticated user session on this route, rate-limit it per
user, never make it callable anonymously, and never log the token.

UQPAY issues **one active token per merchant**: minting a new one silently
invalidates the previous one. So the mint must be cached and single-flighted on
your server, never per request and never per device.

<!-- snippet: backend-token-endpoint -->

```ts
// Reference implementation — the shape of example/backend/lib/token-manager.mjs.
// Your API key lives here, on the server, and nowhere else.
type Token = { value: string; expiresAt: number };

const REFRESH_MARGIN_MS = 120_000; // refresh this long before expiry
const ASSUMED_LIFETIME_MS = 20 * 60_000; // when the response omits expired_at

// Chosen by server configuration, never by anything the app sends.
const UQPAY_HOSTS = {
  sandbox: 'https://api-sandbox.uqpaytech.com',
  production: 'https://api.uqpay.com',
} as const;
const UQPAY_BASE_URL =
  UQPAY_HOSTS[process.env.UQPAY_ENVIRONMENT === 'production' ? 'production' : 'sandbox'];

let cached: Token | null = null;
let inFlight: Promise<Token> | null = null;

async function mint(): Promise<Token> {
  // POST, headers only, no body. Never log the response.
  const res = await fetch(`${UQPAY_BASE_URL}/api/v1/connect/token`, {
    method: 'POST',
    headers: {
      'x-client-id': process.env.UQPAY_CLIENT_ID!,
      'x-api-key': process.env.UQPAY_API_KEY!,
      'accept': 'application/json',
    },
  });
  if (res.status !== 200) throw new Error(`token mint failed: ${res.status}`);
  const body = (await res.json()) as { auth_token?: string; expired_at?: number };
  if (!body.auth_token) throw new Error('token response lacked auth_token');

  // expired_at is epoch SECONDS when present, and is sometimes absent.
  const expiresAt = body.expired_at
    ? Math.round(body.expired_at * 1000)
    : Date.now() + ASSUMED_LIFETIME_MS;
  return { value: body.auth_token, expiresAt };
}

/** Single-flight: two concurrent callers must never mint two tokens. */
export async function getToken(): Promise<Token> {
  if (cached && Date.now() + REFRESH_MARGIN_MS < cached.expiresAt) return cached;
  inFlight ??= mint()
    .then((token) => (cached = token))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
```

The working version, with masked logging, a 401-invalidate-and-retry-once path
and 59 tests, is [`example/backend`](https://github.com/uqpay/uqpay-sdk-react-native/tree/main/example/backend). It has zero
dependencies, so you can read it end to end in a sitting.

### `POST /uqpay/payment-intents`

Creates the intent and returns at minimum `{ paymentIntentId }`. Three rules:

- **Amount, currency and customer come from your database, not from the
  request body.** A client that can name its own price will. The app sends an
  order or cart reference; your server looks up what it costs.
- **Send an idempotency key** (`x-idempotency-key`, a lowercase v4 UUID) and
  reuse the same key on a retry of the same logical order, with the same bytes.
  UQPAY replays rather than double-charging.
- **Only your server calls UQPAY.** The app never creates, updates or cancels
  an intent.

Behind it, your server calls `POST {host}/api/v2/payment_intents/create` with
`x-client-id`, `x-auth-token: Bearer <token>`, `x-idempotency-key`,
`content-type: application/json` and, for a Connect sub-account,
`x-on-behalf-of`. The JSON body the reference backend sends:

| Field | Notes |
|---|---|
| `amount` | Decimal **string** in major units, e.g. `"8.98"` — never cents, never a JSON number. |
| `currency` | ISO 4217 code, e.g. `"SGD"`. |
| `merchant_order_id` | Your order reference. |
| `description` | Short text. Sandbox rejected descriptions longer than 32 characters with an `invalid_parameter` error that does not name the field. |
| `return_url` | Optional. The URL the customer returns to after a redirect. |
| `metadata` | Optional object. |

The reference backend reads the new intent's id from `payment_intent_id`
(falling back to `id`) and its status from `intent_status` (falling back to
`status`). Return the id to the app.

> The reference backend (`example/backend`) takes `amount` and `currency` from
> the app's request so the demo app can try any amount. That is exactly what a
> production server must **not** do.

The app then does nothing but pass the id through:

<!-- snippet: create-and-pay -->

```ts
import { presentPaymentSheet, type UqpayPaymentResult } from '@uqpay/react-native';

export async function checkout(
  cartId: string,
  sessionToken: string
): Promise<UqpayPaymentResult> {
  // Your server decides the amount. The app sends an order reference, not a price.
  const res = await fetch('https://your-server.example/uqpay/payment-intents', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sessionToken}`, // your own user session
    },
    body: JSON.stringify({ cartId }),
  });
  if (!res.ok) throw new Error(`create intent failed: ${res.status}`);
  const { paymentIntentId } = (await res.json()) as { paymentIntentId: string };

  return presentPaymentSheet({
    paymentIntentId,
    returnUrl: 'myapp://pay/return',
  });
}
```

### Connect sub-accounts

This SDK has no `onBehalfOf` option, deliberately: neither native SDK's sheet
path applies the `x-on-behalf-of` header, so exposing the option would silently
do nothing. **Set the sub-account when your backend creates the intent** — send
`x-on-behalf-of` on that call. The sheet then pays whatever intent it is given,
and the routing is already decided.

## Sandbox vs production

Choose the environment from **explicit per-build configuration** — a build
flavour (Android), a scheme or build configuration (iOS), or an EAS build
profile (Expo) — not from `__DEV__`. `__DEV__` is `false` in every release
build, including the internal QA, staging and TestFlight builds your team tests
with, so `__DEV__ ? 'sandbox' : 'production'` quietly points those builds at
production: testers make real charges, and your production backend sees test
traffic. An explicit setting also makes a production build visible in review.

<!-- snippet: environment-switch -->

```ts
import { init, type InitOptions } from '@uqpay/react-native';

// Set per build: e.g. Expo `extra` in app.config.ts driven by the EAS profile,
// react-native-config per Android flavour / iOS scheme, or a generated module.
declare const buildConfig: {
  uqpayEnvironment: InitOptions['environment'];
  uqpayClientId: string;
  apiBaseUrl: string; // your own backend for this build
};
declare function getSessionToken(): Promise<string>;

export async function initUqpay() {
  await init({
    environment: buildConfig.uqpayEnvironment,
    clientId: buildConfig.uqpayClientId,
    tokenProvider: async () => {
      const res = await fetch(`${buildConfig.apiBaseUrl}/uqpay/client-token`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await getSessionToken()}` },
      });
      if (!res.ok) throw new Error(`token endpoint ${res.status}`);
      return (await res.json()) as { authToken: string; expiresAt: number };
    },
  });
}
```

`clientId` is not a secret — it identifies the merchant, it does not authorise
anything. The API key that *does* authorise is on your server, and the
environment your server points at must match the environment the app passes; a
sandbox token against production fails with `authentication_failed`. Build each
app flavour against the backend for the same environment.

Before you flip the switch, re-read the [sandbox
caveats](../README.md#sandbox-testing): the Mastercard-only 3DS card, the
wallets that return `system_error`, the 30-minute intent expiry, and above all
that **sandbox QR wallets settle on real rails**.

## Confirm on your server before fulfilling

The result your app receives is the device's last look at the payment. It is
the right thing to show the customer and the wrong thing to release goods on.

Between the gateway accepting the payment and your `.then` running, the device
can lose its network, be killed by the OS, run out of battery, or be a
modified build talking to your API — a rooted or tampered device can make your
JavaScript see `completed` for a payment that never happened. None of that can
happen to your server.

So:

- **Fulfil only after your server has retrieved the payment intent** from the
  UQPAY API (`GET {host}/api/v2/payment_intents/{id}`) and seen a paid status.
- Treat `kind: 'completed'` as "show the receipt screen", not "ship the order".
- Treat `kind: 'pending'` as "we do not know yet" — never as a failure, never as
  a success, and never as a reason to charge again.
- Treat `kind: 'failed'` with `error.isOutcomeUnknown === true` the same way as
  `pending`.
- **Manual capture:** the sheet reports `status: 'SUCCEEDED'` for an intent that
  is authorised and waiting for capture. The capture state is only on the
  intent your server retrieves.

A practical shape: the app shows an optimistic receipt, then confirms against
your own order record, which your server updated after retrieving the intent.

<!-- snippet: fulfil-from-server -->

```ts
import { presentPaymentSheet } from '@uqpay/react-native';

type OrderState = 'paid' | 'awaiting' | 'unpaid';

/** Your own endpoint, backed by the order row your webhook handler updates. */
async function orderState(orderId: string): Promise<OrderState> {
  const res = await fetch(`https://your-server.example/orders/${orderId}`);
  return ((await res.json()) as { state: OrderState }).state;
}

export async function pay(orderId: string, paymentIntentId: string) {
  const result = await presentPaymentSheet({
    paymentIntentId,
    returnUrl: 'myapp://pay/return',
  });

  if (result.kind === 'canceled') return { screen: 'cart' as const };
  if (result.kind === 'failed' && !result.error.isOutcomeUnknown) {
    return { screen: 'retry' as const, message: result.error.userMessage };
  }

  // completed, pending, or failed-but-outcome-unknown: your server decides.
  const state = await orderState(orderId);
  return { screen: state === 'paid' ? ('receipt' as const) : ('processing' as const) };
}
```

### Webhooks

UQPAY has not yet published a webhook signature scheme for this integration,
so an incoming webhook cannot be authenticated. Until it is published, treat a
webhook as a **hint**: when one arrives, re-fetch the payment intent from the
UQPAY API with your own credentials and act on that. Never mark an order paid
from the webhook body alone — anyone who finds the URL could post one. Once
UQPAY publishes the scheme, verify signatures as well.

> The reference backend records webhooks in a ring buffer and the example app
> shows them on a Webhooks screen, so you can watch a 3DS outcome land
> server-side while the sheet is still on screen. It does **not** verify
> webhook signatures, for the reason above.

## Surviving process death and Metro reloads

Three separate situations, three separate mechanisms. Implement all three; they
cost about twenty lines together.

| Situation | What happened | What recovers it |
|---|---|---|
| The promise resolved `pending` | The confirm left the device; no answer came back | `result.reconcile()` |
| JS restarted while the sheet was open | Metro reload, Fast Refresh, or Android recreating the Activity after process death | `getPendingResult()` |
| The app was relaunched later | The process is gone, and with it the JS context `reconcile()` needs | `presentPaymentSheet` with the **same** `paymentIntentId` |

The third is the one people miss. `reconcile()` is a closure over the JS context
that produced the pending result; after a reload that context is gone and
`reconcile()` rejects. Re-presenting the same intent is the recovery path: the
natives' terminal-intent guard returns the settled result without showing a
form. That is why you persist `paymentIntentId` **before** you call
`reconcile()`, not after.

<!-- snippet: recovery-full -->

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getPendingResult,
  presentPaymentSheet,
  type UqpayPaymentResult,
} from '@uqpay/react-native';

const KEY = 'uqpay.pendingIntent';
const RETURN_URL = 'myapp://pay/return';

/** Run once at launch, after init(). */
export async function recoverUnresolved(): Promise<UqpayPaymentResult[]> {
  const recovered: UqpayPaymentResult[] = [];

  // (a) A result native buffered because no JS was listening. Exactly once;
  //     a second call returns null.
  const buffered = await getPendingResult();
  if (buffered) recovered.push(buffered);

  // (b) An intent we left pending on an earlier run. Re-present: the
  //     terminal-intent guard settles it without showing a payment form.
  const id = await AsyncStorage.getItem(KEY);
  if (id) {
    const settled = await presentPaymentSheet({ paymentIntentId: id, returnUrl: RETURN_URL });
    recovered.push(settled);
    if (settled.kind !== 'pending') await AsyncStorage.removeItem(KEY);
  }

  return recovered;
}

/** Wrap every payment so a pending outcome is never lost. */
export async function payTracked(paymentIntentId: string): Promise<UqpayPaymentResult> {
  const result = await presentPaymentSheet({ paymentIntentId, returnUrl: RETURN_URL });
  if (result.kind !== 'pending') return result;

  await AsyncStorage.setItem(KEY, result.paymentIntentId); // persist BEFORE reconciling
  const settled = await result.reconcile();
  if (settled.kind !== 'pending') await AsyncStorage.removeItem(KEY);
  return settled;
}
```

Late outcomes on iOS arrive as an event rather than a promise resolution, so
subscribe once at launch if you want to react to them without polling. The
`paymentReconciled` event is iOS-only; Android never emits it, so on Android
rely on `reconcile()` and your server:

<!-- snippet: reconciled-listener -->

```ts
import { addPaymentListener } from '@uqpay/react-native';

export function watchForLateOutcomes(refreshOrder: (intentId: string) => void) {
  const subscription = addPaymentListener((event) => {
    if (event.type === 'paymentReconciled') refreshOrder(event.result.paymentIntentId);
  });
  return () => subscription.remove();
}
```

## The 3DS return URL

`returnUrl` is where the bank sends the customer back to your app. It must be a
custom scheme your app registers, or an `https://` Universal Link / App Link you
own. Plain `http://` is rejected at call time.

Prefer the `https://` link in production. A custom URL scheme is not owned:
another app on the device can register the same scheme and receive the return.
Whichever you use, put no secret, token or order data in the URL — it is
routing, not a message.

- **iOS, bare:** add the scheme to `Info.plist` under `CFBundleURLTypes` — see
  the [README](../README.md#return-urls-and-3-d-secure).
- **iOS, Expo:** the config plugin does it. Pass `iosUrlScheme` only if you want
  a scheme different from your app's own.
- **Android:** nothing to configure. The native SDK handles the return inside
  its own Activity.

If your app already handles the deep link itself with `Linking` — common when
you have one universal handler — call `notifyReturnedFromBank()` so the SDK
knows the customer is back. It is a no-op on Android. It never throws, so it is
safe inside a `Linking` listener; before `init()` has completed it does
nothing.

<!-- snippet: notify-returned -->

```ts
import { Linking } from 'react-native';
import { notifyReturnedFromBank } from '@uqpay/react-native';

export function attachDeepLinkHandler() {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    if (url.startsWith('myapp://pay/return')) notifyReturnedFromBank();
  });
  return () => subscription.remove();
}
```

## Testing without a simulator

`@uqpay/react-native/jest` is a scripted stand-in for the native module: it
implements the whole bridge spec, records every call, and lets a test decide
what "native" does next. The SDK's own suite uses it, so it cannot drift from
the real bridge.

Use it to cover the paths you cannot reach by hand — a 5xx mid-confirm, an
unknown error code, a token provider that hangs, a result arriving after a
reload. The hooks are listed in [`jest/README.md`](../jest/README.md); here is
the pending-then-reconciled path, which is the one most worth a regression test:

<!-- snippet: jest-pending-path -->

```ts
import { expect, it } from '@jest/globals';
import { init, presentPaymentSheet } from '@uqpay/react-native';
import { uqpayNativeMock as native } from '@uqpay/react-native/jest';

it('treats a pending outcome as unresolved, not failed', async () => {
  native.__setPlatform('ios');
  await init({
    environment: 'sandbox',
    clientId: 'ck_test_1',
    tokenProvider: native.tokenProvider,
  });

  native.__nextResult({
    kind: 'pending',
    paymentIntentId: 'pi_1',
    status: 'REQUIRES_CUSTOMER_ACTION',
    error: { code: 'timeout', developerMessage: 'no answer', isOutcomeUnknown: true },
    platform: 'ios',
    resultId: 'r1',
  });

  const result = await presentPaymentSheet({
    paymentIntentId: 'pi_1',
    returnUrl: 'myapp://pay/return',
  });

  expect(result.kind).toBe('pending');
  if (result.kind === 'pending') {
    expect(result.cause?.isOutcomeUnknown).toBe(true);
    expect(typeof result.reconcile).toBe('function');
  }
});
```

---

Still stuck? [Troubleshooting](troubleshooting.md) covers the failure modes we
see most often.
