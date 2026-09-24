# Privacy and data collection

What integrating `@uqpay/react-native` means for the disclosures **you** must
make: Apple's privacy nutrition label (App Store Connect) and Google Play's Data
Safety form.

This page aggregates the disclosures of the two native SDKs this package wraps —
`UqpaySDKiOS` 1.1.0 and `com.uqpay.sdk:uqpay-sdk-android` 0.1.0. It describes
the SDK only. Whatever else your app collects is yours to declare.

> Not legal advice. Your privacy policy and your app-store declarations are your
> responsibility; this is the factual basis for filling them in.

## The wrapper itself collects nothing

The JavaScript and bridge layer in this package:

- makes **no network call of its own** — every request comes from the native
  SDKs, to the UQPAY environment you configured and to the bank/wallet hosts the
  3DS WebView and QR loader contact by design;
- **stores nothing** — no `AsyncStorage`, MMKV, file or database write happens
  anywhere in `src/`;
- **logs no payment data** — no PAN, CVC, expiry, cardholder name or auth token
  ever crosses into JavaScript on the sheet path, so none can reach
  `console.log`, Metro, Flipper or React DevTools;
- bundles **no analytics, crash-reporting, attribution or advertising SDK**, and
  its runtime dependency tree is `react` and `react-native` and nothing else.

Everything below is collected by the native SDKs, in the course of processing a
payment.

## What the native SDKs collect

### iOS (`UqpaySDKiOS` 1.1.0)

Declared in `PrivacyInfo.xcprivacy`, shipped in all three modules (wired for
both SwiftPM and CocoaPods). `NSPrivacyTracking` is **false**, and
`NSPrivacyAccessedAPITypes` is **empty** — the SDK uses **no Required Reason
APIs**, so it adds nothing to your app's Required Reason declarations.

| Data type (Apple's taxonomy) | What it actually is | Purpose | Linked to identity | Used for tracking |
|---|---|---|---|---|
| Payment Info | Card details entered in the sheet, sent to the gateway to authorise the payment | App Functionality | Yes | No |
| Name | Billing name, when the intent or the form carries one | App Functionality | Yes | No |
| Email Address | Billing email, when present | App Functionality | Yes | No |
| Phone Number | Billing phone, when present | App Functionality | Yes | No |
| Physical Address | Billing address, when present | App Functionality | Yes | No |
| Device ID | `identifierForVendor`, sent as `device_id` in the confirm payload's `browser_info` | App Functionality | Yes | No |
| Other Data (device IP) | The device's network interface IP, read via `getifaddrs`, sent for fraud screening | App Functionality | Yes | No |

### Android (`uqpay-sdk-android` 0.1.0)

The Android SDK has no privacy manifest format to declare; this is the audited
content of the `browser_info` object it sends with each confirm, plus the card
data the sheet collects.

| What | Detail |
|---|---|
| Payment info | Card number, expiry and CVC entered in the sheet, sent to the gateway to authorise the payment. Held in Compose state only; never written to disk. |
| Billing details | The `billingDetails` you pass, carried in the launch parcel. Never persisted. |
| Device identifier | `Settings.Secure.ANDROID_ID`, sent as `device_id`. |
| Device IP address | The device's network interface IP. A confirm **fails** rather than degrades if no IP can be read. |
| Device and OS | Model, OS type, OS version, and the mobile carrier name when available. |
| Screen and locale | Screen height and width, colour depth (a fixed 24), whole-hour timezone offset, BCP-47 language and country. |
| Browser-shaped fields | A synthesised user-agent string, plus `java_enabled`, `javascript_enabled`, `cookie_enabled`, `plugins`, `do_not_track`, `touch_support`, `hardware_concurrency`, `device_memory` — the schema the gateway's fraud engine expects. |

Explicitly **not** collected on Android: advertising ID, IMEI, MAC address,
serial number, phone number, contacts and location. No third-party analytics or
tracking library is present.

## Mapping to Apple's privacy nutrition label

Declare these in App Store Connect for the SDK's behaviour. All are **used for
App Functionality**, **linked to the user**, and **not used for tracking**.

- Payment Info → Payment Info
- Contact Info → Name, Email Address, Phone Number, Physical Address
- Identifiers → Device ID
- Other Data → device IP address

If you collect none of these yourself, that is the whole SDK-attributable
disclosure. Nothing here requires a Required Reason API declaration.

## Mapping to Google Play Data Safety

| Data Safety category | Declare | Collected | Shared | Purpose | Required |
|---|---|---|---|---|---|
| Financial info → Payment info (User payment info) | Yes | Yes | Yes — with UQPAY as payment processor | App functionality | Required for the payment |
| Personal info → Name, Email address, Phone number, Address | Yes, when you pass `billingDetails` or the intent carries them | Yes | Yes | App functionality, fraud prevention | Optional |
| Device or other IDs | Yes | Yes | Yes | App functionality, fraud prevention | Required for the payment |
| App info and performance → other (device/IP/locale diagnostics) | Yes | Yes | Yes | Fraud prevention, app functionality | Required for the payment |

For every row above: **data is encrypted in transit** (HTTPS only, enforced by
type in both natives — there is no cleartext path), and **data cannot be
deleted by the user from within the app** (payment records are financial records
UQPAY retains for its own legal obligations).

Declare "Data is processed ephemerally" only where it is true for your own app;
it is not true for the payment record, which UQPAY retains.

## What is stored at rest

Very little, and never anything secret.

| Where | What | What it is not |
|---|---|---|
| iOS Keychain | Idempotency pins — **digests only**, keyed per payment attempt, so a replay cannot double-charge | Not a card number, not a token |
| Android app-private storage | An idempotency pin file: digest, key and device metrics, excluded from backup | Not a card number, not a token |
| Android `SharedPreferences` | The last **non-secret** configuration — environment, client id, appearance, config id — so a sheet recreated by the OS after process death is not left uninitialised | **Never an auth token**, never card data |
| JavaScript | Nothing | — |

No PAN, CVC, expiry, cardholder name or auth token is persisted by either
native SDK or by this package, on either platform. Card entry never leaves the
native sheet, and the auth token from your `tokenProvider` is handed to native
once and dropped.

## Network destinations

The natives contact:

- the UQPAY API host for the environment you configured (`sandbox` or
  `production`) — always `https://`, hardcoded, with no base-URL override in the
  public API;
- the bank's ACS host inside the 3-D Secure WebView, which uses a
  non-persistent data store (no cookies survive the challenge);
- the wallet/QR image host when a wallet method is used.

Nothing else. Certificate pinning is deliberately not used — see the [rationale
in the README](README.md#security).

## Questions

Data-protection questions about UQPAY's own processing, retention and
sub-processors belong to UQPAY, not to this package: <https://uqpay.com>.
