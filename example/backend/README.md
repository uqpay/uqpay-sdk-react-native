# UQPAY reference merchant backend (Node)

A ~600-line, **zero-dependency** stand-in for the part of a payment integration
that cannot live in the app: minting auth tokens and creating payment intents.
Both need `UQPAY_API_KEY`, and an API key on a phone is an API key in every
attacker's hands. This server is where it belongs.

It is a straight port of the Dart reference backend that ships with the Flutter
SDK's example, so behaviour matches: single-flight token minting, `description`
validation, webhook capture, masked logs.

**It is a demo, not a template for production.** See [Not production-ready](#not-production-ready).

## Run

```bash
cp example/.env.template example/.env     # then fill in the two credentials
node example/backend/server.mjs
```

No install step: plain ESM, `node:http` and the global `fetch`. Node ≥ 20.

You can start it before filling in `.env` — it will run, `/health` will answer
`ok: false`, and it will tell you which variables are missing rather than
crashing.

From the app:

| Where the app runs | Base URL |
|---|---|
| iOS simulator | `http://localhost:8787` |
| Android emulator | `http://10.0.2.2:8787` (an emulator's `localhost` is the emulator) |
| Physical device | your machine's LAN IP, e.g. `http://192.168.1.20:8787` |

The sample app does the Android rewrite for you and says so on the Home screen.

## Configuration

Read from `example/.env`, with `process.env` taking precedence.

| Variable | Required | Meaning |
|---|---|---|
| `UQPAY_ENVIRONMENT` | no (default `sandbox`) | `sandbox` → `https://api-sandbox.uqpaytech.com`, `production` → `https://api.uqpay.com` |
| `UQPAY_CLIENT_ID` | **yes** | Merchant client id; sent as `x-client-id` |
| `UQPAY_API_KEY` | **yes** | Sent as `x-api-key` when minting a token. Never leaves this process |
| `UQPAY_MERCHANT_BACKEND_URL` | no (default `http://localhost:8787`) | The listen port is taken from this URL |
| `UQPAY_ON_BEHALF_OF` | no | UQPAY Connect sub-account; sent as `x-on-behalf-of` |
| `UQPAY_WEBHOOK_URL` | no | Informational; echoed in `/health` |
| `UQPAY_ALLOW_PRODUCTION` | only for production | Must be `1`, or a production config is refused |
| `PORT` | no | Overrides the port from the backend URL |

## Endpoints

### `GET /health`

```json
{ "ok": true, "environment": "sandbox", "clientIdMasked": "0459****", "tokenCached": false, "webhookUrl": null }
```

When something is missing, `ok` is `false` and `message` / `problems` name the
variables to fill. Values are never included.

### `POST /client-token[?force=1]`

Mints (or serves from cache) the short-lived auth token the app's
`tokenProvider` returns to the SDK.

```json
{ "authToken": "…", "expiresAt": 1789982283000, "clientId": "0459…" }
```

`expiresAt` is **epoch milliseconds**. UQPAY sends `expired_at` as epoch
*seconds*, optionally; the conversion happens here, and a missing value falls
back to a deliberately short 20-minute assumed lifetime.

**One active token per merchant.** Minting a new token silently invalidates the
previous one — including one held by a colleague testing on another machine.
So: the cache is served until expiry − 120 s, concurrent callers share a single
in-flight request (single-flight), and a refresh is only forced with `?force=1`.

### `POST /payment-intents`

```jsonc
{
  "amount": "8.98",            // decimal STRING, major units. Never cents, never a number
  "currency": "SGD",
  "description": "Tee shirt",  // optional; ≤ 32 characters, validated here
  "merchantOrderId": "…",      // optional; generated if absent
  "returnUrl": "uqpayexample://return",
  "metadata": { }              // optional
}
```

→ `POST {base}/api/v2/payment_intents/create` with `x-client-id`,
`x-auth-token: Bearer <token>`, a fresh lowercase v4 `x-idempotency-key`, and
`x-on-behalf-of` when configured. Returns:

```json
{ "paymentIntentId": "pi_…", "status": "REQUIRES_PAYMENT_METHOD", "amount": "8.98", "currency": "SGD", "raw": { } }
```

`amount` is forwarded byte-for-byte: no scaling, no rounding, no reformatting.

`description` is validated at 32 characters because the gateway rejects 33 with
a bare `invalid_parameter` that does not name the offending field.

### `GET /payment-intents/:id`

Retrieves the intent — the merchant-side truth. Same response shape.

### `POST /webhooks/uqpay`

Accepts any JSON and keeps the last **50** payloads in memory.

> ⚠️ **No signature verification.** UQPAY's webhook signing scheme is not yet
> documented for this SDK, so this endpoint trusts every caller. A production
> merchant MUST verify the signature — otherwise anyone who finds the URL can
> mark orders paid.

For UQPAY to reach a laptop you need a tunnel:

```bash
ngrok http 8787     # then register https://<id>.ngrok.app/webhooks/uqpay with UQPAY
```

To exercise the app's Webhooks screen without one:

```bash
curl -X POST http://localhost:8787/webhooks/uqpay \
  -H 'content-type: application/json' \
  -d '{"type":"payment_intent.succeeded","data":{"payment_intent_id":"pi_demo","status":"SUCCEEDED"}}'
```

### `GET /webhooks/recent`

`{ "events": [ … ], "capacity": 50, "signatureVerified": false }`, newest first.

## Logging

Method, path, status and **masked** ids only. The API key, the auth token and
request/response bodies never reach a log line. A test asserts that the token
manager's output contains neither the token nor the key, and another greps the
source for `console.log` of a credential.

```
2026-09-21T08:48:17.697Z token: minting (client ****93af, key ****wxyz)
2026-09-21T08:48:17.712Z intent: create -> 200 id=pi_abc123 trace=…
```

## Tests

```bash
node --test "example/backend/test/*.test.mjs"
```

59 tests, no runner to install. They cover the env loader and masking, the
config (including the production guard), token single-flight and the 120 s
refresh margin, `expired_at` conversion in all its shapes, `description`
validation, the 401 retry reusing its idempotency key, the webhook ring buffer,
and the RN-SEC3 / RN-FLOW4 tripwires.

## Not production-ready

Deliberate simplifications, each of which a real merchant must fix:

1. **`/client-token` is unauthenticated.** Anyone who can reach this server gets
   a merchant token. A real backend authenticates the user's session first and
   scopes what it hands out — ideally to a single payment.
2. **No webhook signature verification** (above).
3. **CORS is wide open** (`*`), for local development convenience.
4. **Webhooks live in memory.** A restart loses them. Fulfilment must be driven
   from durable storage, transactionally with the order.
5. **One process, one token.** Two instances will fight over the merchant's
   single active token.
6. **The app chooses the amount.** `POST /payment-intents` takes `amount` and
   `currency` from the request so the demo can try different values. A real
   backend never does this: it computes the amount from its own order or cart,
   otherwise anyone can pay 0.01 for anything by editing the request.
7. **It listens on every network interface** (`0.0.0.0`) so emulators and
   phones on your Wi-Fi can reach it. Don't run it on an untrusted network.
