# Changelog

All notable changes to `@uqpay/react-native` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Every release names the native SDK versions it carries; what is and is not a
breaking change is defined in [STABILITY.md](STABILITY.md).

## [Unreleased]

Second release candidate: `1.0.0-rc.2` (2026-10-02). Pre-release — test in
sandbox before taking live payments. Supersedes `1.0.0-rc.1` (2026-09-24).

### Fixed in rc.2

- Android: `tokenProvider` is now called before **every** present, as on iOS
  and as documented. Previously a cached token that had not yet expired was
  reused without asking JavaScript, so after your backend minted a new token
  (a restart, a deploy, a second instance — UQPAY keeps one active token per
  merchant) every Android payment failed with `authentication_failed` until
  the cached token aged out. If `tokenProvider` throws or times out, Android
  falls back to a cached token that is still outside the refresh margin, so a
  backend that is briefly down does not fail a payment a live token can still
  make; with no such token the present settles as `authentication_failed`
  immediately instead of showing a spinner.

**Native versions:** iOS `UqpaySDKiOS` 1.1.0 (`~> 1.1.0`) · Android
`com.uqpay.sdk:uqpay-sdk-android` 0.1.0 (exact pin; moves to a patch range once
0.1.1 is published)

### Added

**The payment API**

- `init(options)` — configures both natives from a single `InitOptions`.
  Idempotent: calling it again with the same non-secret configuration is a no-op
  that only re-registers your `tokenProvider`, which is what makes a Metro
  reload safe. Rejects on an unsupported platform, naming it.
- `presentPaymentSheet(options)` — presents the native sheet and resolves with
  exactly one `UqpayPaymentResult`. Expected outcomes resolve; only programmer
  error rejects.
- `UqpayPaymentResult` — a discriminated union on `kind`:
  `completed | failed | canceled | pending`, frozen for the 1.x line.
- `cancelPaymentSheet()`, `notifyReturnedFromBank()`, `getPendingResult()`.
- `addPaymentListener(listener)` — `paymentReconciled` and `requiresAction`,
  both iOS-only (the Android native emits neither).
- `useUqpay()` — the same imperative API, bound for use in a component.
- `pending.reconcile()` — settles a pending intent by re-presenting it, so the
  natives' terminal-intent guard can return the settled result without showing a
  form.

**Auth, errors and types**

- `tokenProvider`-only authentication. There is no API-key, publishable-key or
  client-secret parameter anywhere in the public surface.
- `UqpayError` with a canonical `code`, a customer-safe `userMessage`, a
  `developerMessage` that never carries a secret, `isRetryable`,
  `isOutcomeUnknown`, `declineCode`, `httpStatus`, `raw` and `platform`.
- `isUnknownErrorCode(code)` and open string unions for error codes, payment
  methods, cancel reasons and intent statuses, so an unrecognised value
  round-trips instead of throwing.
- `UqpayConfigurationError` — thrown at call time for programmer error, naming
  the exact field.
- Amounts cross the bridge as the **wire string in major units**, never a
  number, never re-scaled.

**Platform integration**

- New-Architecture Turbo Module (`Uqpay`) with Codegen, for iOS and Android.
- Expo config plugin (`app.plugin.js`, `iosUrlScheme` prop) registering the iOS
  3DS return URL scheme; a documented no-op on Android.
- `@uqpay/react-native/jest` — a scripted mock native module, the same one the
  SDK's own suite uses.
- Appearance theming: a common subset mapped onto both natives, plus
  per-platform escape hatches, set at `init`.

**Documentation**

- README with a ≤ 25-line quickstart, the compatibility matrix, the results and
  errors reference, sandbox caveats, security notes, a **security checklist for
  production** and the full limitations list.
- Integration guide: the UQPAY API hosts for sandbox and production, the token
  and payment-intent calls your server makes, confirming payments server-side
  before fulfilling, and choosing the environment by explicit build
  configuration.
- [Integration guide](docs/integration-guide.md),
  [troubleshooting](docs/troubleshooting.md),
  [release process](docs/release-process.md).
- [`ERROR_CODES.md`](ERROR_CODES.md), generated from the same table the mappers
  use. [`PRIVACY.md`](PRIVACY.md) for Apple's nutrition label and Google Play
  Data Safety. [`STABILITY.md`](STABILITY.md).
- Every TypeScript sample in the README and `docs/` is extracted and
  type-checked in CI (`yarn docs:check`), so a sample cannot drift from the API.
- Example app and a zero-dependency reference merchant backend in `example/`.

**Server-truth resolution on iOS**

- When the iOS native sheet abandons a confirm it cannot drive (it reports
  `unknown` with the intent status as `declineCode`, e.g. `REQUIRES_CUSTOMER_ACTION`
  without a `next_action` — seen live with the UnionPay sandbox card), the bridge
  no longer settles the sheet's guess. The same applies to the sheet's `timeout`
  and `network_error` on the card path, which it only raises after the confirm
  was sent (a timed-out or lost 3DS poll) — previously those resolved `failed`
  where Android resolves `pending`. It reads the intent from the server
  (every 2 s, up to ~20 s) and resolves `completed` / `failed` / `canceled` from
  the server's status, matching Android. If the intent is still in flight after
  that it resolves `pending` with `isOutcomeUnknown: true` and keeps reading under
  the 75 s reconciliation window, delivering a late outcome as `paymentReconciled`.

### Changed during the release candidate

- Importing the package no longer throws when the native module is missing.
  The first call rejects with `UqpayConfigurationError('invalid_configuration')`
  saying the native module is not in the app binary; Expo Go and web now get the
  `unsupported_platform` error from `init()` / `presentPaymentSheet()` as
  documented.
- Every rejection is a `UqpayConfigurationError`: rejections from the native
  layer are wrapped instead of surfacing as plain `Error`s.
- `clientId` must be printable ASCII with no whitespace, and `paymentIntentId`
  must match `/^[A-Za-z0-9_-]{1,128}$/`; anything else rejects with
  `invalid_configuration`.
- A `tokenProvider` answer without `expiresAt` prints one developer warning, and
  the token is treated as short-lived (Android assumes five minutes). Always
  return `expiresAt`.
- `notifyReturnedFromBank()` never throws; before `init()` it does nothing.
- `billingDetails` is no longer kept in memory after the sheet settles.
- `cancelPaymentSheet()` called while the token is still being fetched, before
  the sheet is on screen, now stops the sheet from appearing on both platforms.
- Jest: importing `@uqpay/react-native/jest` in your setup file is the whole
  setup. Do not call `jest.mock('@uqpay/react-native/jest')`.
- Documentation: `completed` results for manual-capture intents normally report
  `status: 'SUCCEEDED'` (not `REQUIRES_CAPTURE`); read capture state on your
  server. Raising a platform floor is a breaking change (major release).

### Known limitations

This release ships with documented differences between the two native SDKs —
iOS presentation modes and billing prefill, Android QR rendering and
configuration-change behaviour, the `pending` semantics both platforms share.
Read **[Limitations & platform
differences](README.md#limitations--platform-differences)** before integrating;
every item there is either tracked upstream or a deliberate 1.0 non-goal.

### Migration

Nothing to migrate: this is the first release.
