# UQPAY React Native — sample app

A bare React Native app that exercises the whole of `@uqpay/react-native`, plus
the [reference merchant backend](backend/README.md) it talks to.

The integration itself is small — the `init` call in [`src/App.tsx`](src/App.tsx)
and the `presentPaymentSheet` call in
[`src/screens/HomeScreen.tsx`](src/screens/HomeScreen.tsx), about 25 lines
together. Everything else here exists to make the behaviour *visible*: the
result union rendered field by field, a webhook inbox, the pending/reconcile
path, the event stream, theming.

```
┌─────────┐   1. create intent    ┌──────────────────┐   x-api-key   ┌───────┐
│   app   │ ────────────────────▶ │ merchant backend │ ────────────▶ │ UQPAY │
│         │ ◀──────────────────── │  (example/backend) │ ◀──────────── │       │
│         │   2. client token     └──────────────────┘               └───────┘
│         │                                ▲                              │
│ native  │   3. the payment itself        │      4. webhook              │
│  sheet  │ ───────────────────────────────┼──────────────────────────────┘
└─────────┘                          the outcome you fulfil orders from
```

The app never holds the merchant API key, and never calls the UQPAY API host —
a test fails the build if either changes (AC RN-SEC3, RN-FLOW4).

---

## 1. Configure

```bash
cp example/.env.template example/.env
$EDITOR example/.env          # fill UQPAY_CLIENT_ID and the API key
node example/scripts/gen-env.mjs
```

`gen-env.mjs` writes `example/src/env.generated.ts` with **exactly three**
values — environment, client id, backend URL. It is gitignored, and it is
regenerated automatically by the `start` / `ios` / `android` scripts. Re-run it
by hand after editing `.env`, and restart Metro with `--reset-cache`.

Variables live in `example/.env.template`, which documents which of them the
app may see and which are backend-only.

## 2. Run the backend

```bash
node example/backend/server.mjs
```

It starts even with an empty `.env` and tells you what is missing. Leave it
running in its own terminal. Details: [`backend/README.md`](backend/README.md).

## 3. Run the app

```bash
# from the repo root
yarn                                # once
yarn example start --reset-cache    # Metro, in its own terminal
yarn example ios                    # or: yarn example android
```

First Android build on a fresh clone: keystores are never committed, so create
the standard React Native debug keystore once (public debug values, debug builds
only):

```bash
keytool -genkeypair -keystore example/android/app/debug.keystore \
  -storepass android -alias androiddebugkey -keypass android \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
```

| | Backend URL used | Notes |
|---|---|---|
| iOS simulator | `http://localhost:8787` | Works as configured |
| Android emulator | `http://10.0.2.2:8787` | Rewritten automatically; the Home screen says so |
| Physical device | your LAN IP | Set `UQPAY_MERCHANT_BACKEND_URL` to it and re-run `gen-env.mjs` |

### URL scheme (3DS / wallet return)

The app returns from the bank through `uqpayexample://return`.

- **iOS (bare):** `example/ios/UqpayExample/Info.plist` needs a `CFBundleURLTypes`
  entry with `CFBundleURLSchemes = ["uqpayexample"]`. Without it, 3DS opens and
  never comes back.
- **iOS (Expo):** the config plugin adds it for you.
- **Android:** nothing to configure.

### Cleartext HTTP to the backend

`http://localhost:8787` is plain HTTP, which both platforms block by default in
a release build. For local development:

- **iOS** — an ATS exception for `localhost` in `Info.plist`, or use https via a
  tunnel.
- **Android** — debug builds of RN already allow cleartext to the emulator host.

This applies to the *sample backend only*. Traffic to UQPAY is always HTTPS.

---

## 4. Sandbox notes — read before testing

| | |
|---|---|
| **Cards** | Use the sandbox test cards with **exactly** this expiry/CVC (the ACS rejects anything else with `3ds_failed`): **Mastercard 3DS** `5521 9700 7999 8012`, **10/28**, CVC **001** → `SUCCEEDED` (the only 3DS-enrolled card, frictionless). **UnionPay** `6250 9470 0000 0014`, 12/33, 123 → `SUCCEEDED` without 3DS. The quickstart Mastercards `5346 …8117` / `5413 …4047` are not 3DS-enrolled and always fail through the sheet. A **Visa** 3DS card returns `system_error` — sandbox limitations, not SDK bugs. |
| **Wallets** | `paynow`, `tosspay` and `naverpay` return `system_error` server-side. |
| **QR wallets** | ⚠️ **Sandbox QR wallets settle on REAL rails.** Scanning a sandbox QR with a real wallet app moves real money. Get budget/approval first; do not scan casually. |
| **Tokens** | One active token per merchant. Minting from a second machine invalidates the first tester's session — coordinate before running two backends. |
| **Intents** | Expire 30 minutes after creation. |

---

## 5. What each screen demonstrates

**Checkout**

- environment badge, resolved client id (masked), return URL, backend URL with
  the `10.0.2.2` hint
- backend `GET /health` with the "fill in your `.env`" message passed through
- amount + currency with a **wire preview** — amounts are strings in major
  units, end to end; `"8.98"` is never `898`
- presentation mode: method list · card only · single wallet
- **Create intent & pay** — server creates the intent, the app presents the sheet
- the result rendered by an exhaustive `switch (result.kind)` over all four
  variants, every field shown, with `isOutcomeUnknown` and `REQUIRES_CAPTURE`
  called out
- a banner on every result: **the client result is a UX signal, not proof of
  payment**
- **Pending → reconcile()** on a pending result
- **Recover last result** → `getPendingResult()`, for a Metro reload or an
  Android process death mid-flow
- **Cancel sheet after 3 s** → `cancelPaymentSheet()`
- event panel: `paymentReconciled` (both platforms) and `requiresAction`
  (iOS only)
- theming toggle that re-calls `init` with a different `appearance`, and
  explains the re-init side effect on Android's token cache

**Webhooks** — polls the merchant backend's `/webhooks/recent` every 3 s, so you
can watch the 3DS outcome land server-side while the sheet is still on screen.
That is the event a real integration fulfils orders from.

---

## 6. Manual test checklist

20 rows mapped to the RN-TEST3 matrix. Run each on **both** platforms and record
`iOS ✓/✗` and `Android ✓/✗`; iOS and Android must produce the same `kind`, the
same `error.code` and the same cancel `reason` (RN-PAR1).

| # | RN-TEST3 cell | How to trigger | Expected |
|---|---|---|---|
| 1 | success | UnionPay test card `6250 9470 0000 0014`, 12/33, 123 (no 3DS redirect) | `completed`, `status` `SUCCEEDED`, `amount` exactly as sent |
| 2 | success / auth only | An intent created with auto-capture off | `completed`, `status` `REQUIRES_CAPTURE` — **success**, not failure |
| 3 | decline | Decline test card | `failed`, `error.code` `card_declined`, `isRetryable` true |
| 4 | insufficient funds | Insufficient-funds test card | `failed`, `insufficient_funds` |
| 5 | 3DS pass | Mastercard 3DS card `5521 9700 7999 8012`, **10/28**, CVC **001** (frictionless — no challenge UI) | `completed`, `status` `SUCCEEDED`; app returns via `uqpayexample://return` |
| 6 | 3DS fail | The same Mastercard 3DS card with any **other** expiry/CVC (e.g. 12/30, 123) | `failed`, `3ds_failed` |
| 7 | user cancel | Open the sheet, close it before entering a card | `canceled`, `reason` `user_cancelled` |
| 8 | sheet dismiss | Swipe the sheet down (iOS) / back button (Android) | `canceled`, `user_cancelled` — never a crash |
| 9 | dismiss mid-confirm | Start 3DS, then dismiss before it returns | `pending`, **not** `canceled`; iOS omits `amount`/`currency` |
| 10 | network timeout | Enable airplane mode after tapping Pay | `pending` or `failed`/`timeout` with `isOutcomeUnknown` true |
| 11 | server 5xx | Point the backend at an intent the gateway rejects | `failed`, `server_error` |
| 12 | unknown error code | Inject an unrecognised native code | `failed`; `isUnknownErrorCode` true, `raw` preserved, no throw |
| 13 | app backgrounded | Background the app mid-sheet, return | Sheet still usable; result delivered once |
| 14 | process death (Android) | Enable "Don't keep activities", pay through 3DS | Result survives; delivered on next launch or by **Recover last result** |
| 15 | Metro reload | Press `r` in Metro while the sheet is open | After reload, **Recover last result** returns it; a second call returns `null` |
| 16 | QR expiry | Single wallet, leave the QR until it expires (**do not scan**) | `failed`/`timeout` or `pending`; no crash |
| 17 | double present | Tap **Create intent & pay** twice quickly | Second call resolves `failed`/`invalid_configuration` — never two sheets |
| 18 | merchant cancel | **Cancel sheet after 3 s** | `canceled`, `reason` `merchant_cancelled` |
| 19 | token provider fails | Stop the backend, then pay | `failed`, `authentication_failed`; `userMessage` is customer-safe, `developerMessage` names the provider |
| 20 | webhook is truth | Complete a 3DS payment, switch to **Webhooks** | The outcome appears server-side (needs a tunnel; `UQPAY_WEBHOOK_URL`) |

Also worth walking once, though not RN-TEST3 cells: the theming toggle
(re-`init` succeeds and the next sheet is restyled), and **Check server-side
status** agreeing with the client result.

## 7. Tests

```bash
node --test "example/backend/test/*.test.mjs"   # 59 tests: backend + tripwires
```

The tripwires fail the build if any file under `example/src` or
`example/scripts` names the merchant API key or the UQPAY API host.
`example/src/__tests__/secrets.test.ts` is the same gate written for Jest, for
when the example is wired into the root Jest run.
