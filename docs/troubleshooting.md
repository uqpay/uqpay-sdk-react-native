# Troubleshooting

The failure modes we see most often, what causes them, and what to do. If your
symptom is not here, check [Limitations & platform
differences](../README.md#limitations--platform-differences) — a surprising
number of "bugs" are documented asymmetries between the two native SDKs.

- [The sheet opens blank or unstyled on iOS](#the-sheet-opens-blank-or-unstyled-on-ios)
- [`use_frameworks!` (static or dynamic)](#use_frameworks-static-or-dynamic)
- [Kotlin or Compose version conflict on Android](#kotlin-or-compose-version-conflict-on-android)
- [AndroidX "registering after STARTED" crash](#androidx-registering-after-started-crash)
- [`init` fails naming Expo Go](#init-fails-naming-expo-go)
- ["The UQPAY native module is not in this app binary"](#the-uqpay-native-module-is-not-in-this-app-binary)
- [`failed` / `invalid_configuration`: no foreground Activity](#failed--invalid_configuration-no-foreground-activity)
- [3DS opens and never comes back](#3ds-opens-and-never-comes-back)
- [The payment succeeded but my promise said `pending`](#the-payment-succeeded-but-my-promise-said-pending)
- [Metro reload mid-payment](#metro-reload-mid-payment)
- [`authentication_failed` on every payment](#authentication_failed-on-every-payment)
- [The card form is pre-filled with a test card](#the-card-form-is-pre-filled-with-a-test-card)
- [Working on this repository](#working-on-this-repository)

---

## The sheet opens blank or unstyled on iOS

**Symptom.** The payment sheet presents, but it is empty, has no images, or
crashes with a message about a missing bundle — often
`Could not find resource bundle UqpayPaymentSheet`.

**Cause.** The iOS native SDK ships its images and assets in a resource bundle
called `UqpayPaymentSheet` and finds it at runtime by name. Some Podfile
configurations — particularly ones that flatten or relocate resource bundles, or
a build where `pod install` was not re-run after adding the package — leave the
bundle somewhere the SDK does not probe.

**Fix.**

```sh
cd ios
rm -rf Pods Podfile.lock build ~/Library/Developer/Xcode/DerivedData
pod install --repo-update
```

Then confirm the bundle is actually in the app: build, right-click the `.app` in
Xcode's Products group, *Show in Finder*, and look for
`UqpayPaymentSheet.bundle` inside it. If it is missing after a clean
`pod install`, the Podfile is relocating resources — check for custom
`post_install` hooks that move or strip `.bundle` files.

## `use_frameworks!` (static or dynamic)

**Symptom.** Link errors mentioning `UqpaySDKiOS` or Swift symbols, or the
resource-bundle failure above, but only in a project that uses
`use_frameworks!`.

**Cause.** The native SDK ships as static frameworks. All four combinations —
no `use_frameworks!`, `use_frameworks!`, `use_frameworks! :linkage => :static`
and `:linkage => :dynamic` — are supported, but they need a clean derived-data
state after switching, because CocoaPods does not always rebuild the
intermediate artefacts.

**Fix.** After adding or changing a `use_frameworks!` line:

```sh
cd ios
rm -rf Pods Podfile.lock build ~/Library/Developer/Xcode/DerivedData
pod install
```

If you use `:linkage => :static`, also make sure any `post_install` hook you
have copied from a blog post is not forcing `BUILD_LIBRARY_FOR_DISTRIBUTION` or
stripping bitcode on pods — both break Swift static frameworks.

## Kotlin or Compose version conflict on Android

**Symptom.** Gradle fails with something like
`Class 'kotlin.Unit' was compiled with an incompatible version of Kotlin`, or a
Compose runtime error about a mismatched compiler extension.

**Cause.** The Android native SDK pulls Jetpack Compose 1.7.6 and Material3
1.3.1 into your app. If your app pins an *older* Compose BOM, or an older
Kotlin, Gradle's conflict resolution may not lift it far enough.

**Fix.** Do not pin downward. Let Gradle resolve upward:

- Kotlin **2.0 or newer** (`kotlinVersion` in `android/build.gradle`).
- AGP **8.6 or newer**.
- `compileSdk` **35 or newer**.
- If you pin a Compose BOM, pin it to 2024.12.01 or later — never below.

A host app on a *newer* Compose BOM is fine and is covered by CI; a host app
with no Compose at all is fine too. To see what is actually resolving:

```sh
cd android && ./gradlew :app:dependencies --configuration releaseRuntimeClasspath | grep -i compose
```

## AndroidX "registering after STARTED" crash

**Symptom.**
`java.lang.IllegalStateException: LifecycleOwner ... is attempting to register while current state is RESUMED. LifecycleOwners must call register before they are STARTED.`

**Cause.** This is an AndroidX ActivityResult rule: a result launcher must be
registered before the Activity reaches `STARTED`. In a React Native app the
Activity is often already resumed by the time JavaScript runs, which is exactly
why this SDK does **not** register from JavaScript — it registers per Activity
from the module's host-lifecycle hooks.

If you see this crash, it is almost never from this package. Look for your own
code (or another library) calling `registerForActivityResult` from a React
callback, an effect, or a `Promise.then`.

**Fix.** Move the registration into `onCreate`, or use a library that registers
it for you. If you can reproduce it with only `@uqpay/react-native` installed,
that is a bug — please file it with the stack trace.

## `init` fails naming Expo Go

**Symptom.** `init()` rejects with an error that says the SDK cannot run in Expo
Go.

**Cause.** Expo Go is a fixed, pre-built binary. It contains only the native
modules Expo ships; it cannot load this package's native code. This is not
something a configuration flag can change.

**Fix.** Use a development build.

```sh
npx expo install @uqpay/react-native
# add the plugin to app.json, then:
npx expo prebuild
npx expo run:ios      # or: npx expo run:android
```

or build a dev client with EAS (`eas build --profile development`). See
[Expo](../README.md#expo).

## "The UQPAY native module is not in this app binary"

**Symptom.** `init()` (or another call) rejects with a
`UqpayConfigurationError`, code `invalid_configuration`, whose message says the
UQPAY native module is not in this app binary. Importing the package does not
throw; the error appears on the first call.

**Cause.** The JavaScript package is installed but the native code was not
built into the app you are running: the app was not rebuilt after installing,
`pod install` was not run, an Expo project was not re-prebuilt, or — in Jest —
the mock is not registered.

**Fix.** Rebuild the app: `cd ios && pod install`, then a fresh native build on
both platforms; on Expo, `npx expo prebuild` (or a new EAS build). A Metro
reload alone is not enough. In Jest, add
`import { uqpayNativeMock } from '@uqpay/react-native/jest'` to your setup file
(see [`jest/README.md`](../jest/README.md)).

## `failed` / `invalid_configuration`: no foreground Activity

**Symptom.** On Android, a payment resolves `failed` with
`invalid_configuration` and a developer message about no foreground Activity.
On iOS, the same result with a message about no presenting view controller.

**Cause.** You called `presentPaymentSheet` when there was nothing to present
*from*: the app was backgrounded, the Activity was being recreated (rotation,
dark-mode switch, "Don't keep activities"), or the call ran from a background
task or a push-notification handler.

This is reported as a resolved result rather than a crash on purpose — it is
recoverable.

**Fix.** Present from a user interaction in a mounted screen. If you present in
response to something asynchronous, check that the app is foregrounded first:

<!-- snippet: present-when-foreground -->

```ts
import { AppState } from 'react-native';
import { presentPaymentSheet } from '@uqpay/react-native';

export async function payWhenForeground(paymentIntentId: string) {
  if (AppState.currentState !== 'active') {
    // Queue it; presenting from the background always fails.
    return null;
  }
  return presentPaymentSheet({ paymentIntentId, returnUrl: 'myapp://pay/return' });
}
```

A brownfield note: the Android native needs the host Activity to be a
`ComponentActivity`. A plain `Activity` host is unsupported.

## 3DS opens and never comes back

**Symptom.** The bank's 3-D Secure page opens, the customer authenticates, and
the app never regains control — or the sheet sits on a spinner until it times
out to `pending`.

**Causes, in the order worth checking.**

1. **The return URL scheme is not registered (iOS).** Add the
   `CFBundleURLTypes` entry, or let the Expo plugin add it. Without it, iOS has
   nowhere to send the customer back to. This is the single most common cause.
2. **`returnUrl` does not match what the scheme registers.** `myapp://…` in the
   call, `myapp` in the plist. A typo in either is silent.
3. **Your app handles the deep link itself.** If you have a `Linking` handler
   that consumes the URL, the SDK never learns the customer is back. Call
   `notifyReturnedFromBank()` from your handler (it is a no-op on Android).
4. **App-to-app 3DS on Android.** If the issuer returns an `intent://`
   app-to-app URL, the Android native consumes it but never launches it, and the
   payment resolves `pending`. This is a known limitation; reconcile
   server-side.
5. **Sandbox, wrong test card details.** Only the Mastercard 3DS test card
   `5521 9700 7999 8012` completes 3DS in sandbox, and only with expiry
   **10/28** and CVC **001**; any other expiry/CVC is answered by the sandbox
   ACS with authentication status `N` and resolves `failed` / `3ds_failed`.
   The quickstart Mastercards (`5346 …8117`, `5413 …4047`) are not 3DS-enrolled
   and always fail through the sheet. A Visa 3DS card returns `system_error`.
   These are sandbox limitations, not bugs.

## The payment succeeded but my promise said `pending`

**Symptom.** Your server (or a webhook) says the payment succeeded. The app got
`kind: 'pending'`, or `failed` with `isOutcomeUnknown: true`.

**This is working as designed.** `pending` does not mean "failed" — it means
*the device does not know*. The confirm left the device and no usable answer
came back: the network dropped, the app was backgrounded past the native's
attempt budget, the customer dismissed the sheet mid-confirm, or the gateway
answered 5xx **after** the confirm was already in flight. In that last case both
platforms deliberately report `pending` rather than `failed`, because reporting
a failure would invite a second charge for a payment that already went through.

**What to do.**

- Never show the customer a failure. Show "we are confirming this payment".
- Never present the same cart again as a new payment.
- Resolve it: `result.reconcile()`, or re-present the same `paymentIntentId`
  after a relaunch, or read your own order record once your server has
  retrieved the intent from the UQPAY API. All three are covered in [Surviving process death and Metro
  reloads](integration-guide.md#surviving-process-death-and-metro-reloads).

One iOS-specific case worth knowing: calling `cancelPaymentSheet()` during a
frictionless (no-3DS) card confirm can also resolve `pending`, because the iOS
native does not tell the SDK that a silent confirm has started. Same rule
applies — reconcile, do not re-charge.

## Metro reload mid-payment

**Symptom.** You pressed `r` in Metro (or Fast Refresh fired) while the sheet
was open. The promise never resolves, or `reconcile()` rejects.

**Cause.** A reload destroys the JavaScript context. A promise cannot survive
that, and neither can the closure behind `pending.reconcile()`. The *native*
side survives, and buffers the result.

**Fix.** Collect the buffered result at launch:

<!-- snippet: collect-buffered -->

```ts
import { getPendingResult } from '@uqpay/react-native';

export async function collectBufferedResult() {
  // Returns the result native buffered because no JS was listening, and clears
  // it — so it is delivered exactly once. Returns null when there is nothing.
  const result = await getPendingResult();
  if (result) console.log('recovered after reload:', result.kind, result.paymentIntentId);
  return result;
}
```

The same mechanism covers Android process death mid-3DS (reproduce it with
*Don't keep activities* plus `adb shell am kill <package>`). Calling `init()`
again after a reload with the **same** configuration is a no-op that only
re-registers your `tokenProvider`, so it is safe and expected.

## `authentication_failed` on every payment

**Symptom.** Every payment resolves `failed` with `authentication_failed`, and
the developer message names your token provider.

**Causes.**

- Your `tokenProvider` threw, returned a blank `authToken`, or did not settle
  within the native's 10 second budget. The SDK adds no timer of its own.
- Your backend is unreachable from the device. An Android emulator reaches the
  host as `10.0.2.2`, not `localhost`; a physical device needs your LAN IP.
- Environment mismatch: a sandbox token against `environment: 'production'`, or
  the reverse.
- **Someone else minted a token.** UQPAY allows **one active token per
  merchant**; a colleague running a second backend against the same merchant
  invalidates yours. Coordinate before running two backends.

**Fix.** Log inside your `tokenProvider` (never the token value itself — log
`res.status` and whether `authToken` was non-empty), and check
`/health` on your backend from the device, not from your laptop.

## The card form is pre-filled with a test card

**Symptom.** The card form opens with mock card details already typed in.

**Cause.** The iOS native SDK auto-fills the card form in `DEBUG` builds. If
your React Native debug build compiles the SDK in Debug configuration, you see
it.

**This never happens in a release build.** Verify with a release build before
raising it — it is native behaviour, not something this wrapper sets.

## Working on this repository

If you are building the SDK itself rather than consuming it:

- **`example/ios/Podfile` has a `:testspecs` line.** It exists so the library's
  own XCTest target builds in CI. It is a development detail of this repository;
  **your app's Podfile needs nothing of the sort.**
- `yarn docs:check` extracts every tagged code sample in the README and
  `docs/*.md` into `docs-fixtures/` and type-checks it against `src/index.ts`.
  If you change the public API, the samples go red before the docs drift.
- `yarn api:check` diffs the public API report. Any addition or removal needs an
  explicit `yarn api:update` and a CHANGELOG entry.
