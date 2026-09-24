# Stability policy

What `@uqpay/react-native` promises about its API, and what it does not. This
is the contract behind the version number: if something here would be violated,
the release is a major.

This policy takes effect at **1.0.0**. Before then (`0.x`, `1.0.0-rc.N`)
anything may change, though we intend not to.

## What is public API

The public API is **exactly** the set of symbols exported from `src/index.ts`,
frozen in the committed API report at
[`etc/uqpay-react-native.api.md`](https://github.com/uqpay/uqpay-sdk-react-native/blob/main/etc/uqpay-react-native.api.md). CI diffs that
report on every pull request; an addition or removal fails the build until the
report is regenerated deliberately.

Public:

| | |
|---|---|
| Functions | `init`, `presentPaymentSheet`, `cancelPaymentSheet`, `notifyReturnedFromBank`, `getPendingResult`, `addPaymentListener`, `useUqpay`, `isUnknownErrorCode` |
| Error class | `UqpayConfigurationError` |
| Types | `InitOptions`, `PresentOptions`, `UqpayPaymentResult`, `UqpayError`, `UqpayErrorCode`, `PaymentMethodType`, `CancelReason`, `IntentStatus`, `BillingDetails`, `Appearance`, `PaymentEvent` |
| Test helper | `@uqpay/react-native/jest` — the scripted mock native module |
| Expo plugin | `app.plugin.js` and its `iosUrlScheme` prop |

**Not** public, and may change in any release: anything under `src/` that
`index.ts` does not re-export, the Turbo Module spec (`NativeUqpay.ts`), the
native bridge classes (Swift, Kotlin, ObjC++), event name constants, the
`lib/` build layout, and every internal helper. If you reach into those, a patch
release may break you.

Behaviour documented in the README's [Limitations & platform
differences](README.md#limitations--platform-differences) is part of the
contract too: we will not silently change a documented platform difference into
a different one.

## The frozen result union

```ts
type UqpayPaymentResult = Completed | Failed | Canceled | Pending; // discriminated on `kind`
```

**These four variants are frozen for the whole 1.x line.** A `switch` on `kind`
with all four arms will stay exhaustive under `strict` for every 1.x release.

New outcomes arrive as **new error codes** or **new optional fields**, never as
a fifth variant. Adding a fifth variant is a major-version change, because it
silently breaks exhaustiveness checking in merchant code.

Adding a new optional field to an existing variant is a **minor**. Making an
optional field required, or removing one, is a **major**.

## Open code unions

`UqpayErrorCode`, `PaymentMethodType`, `CancelReason`, `IntentStatus` and
`PaymentEvent`'s action `type` are **open** unions — `KnownValue | (string & {})`.
They can gain members in a **minor** release, and a value neither the wrapper
nor the natives have seen round-trips into JavaScript untouched rather than
throwing.

So: never compare an error code against a closed set, and never write a
`switch` on one without a default arm. Use `isUnknownErrorCode(code)` to tell
"canonical" from "passed through". `error.raw` carries the original native
value when the code is not canonical.

Because these unions are open, **adding a code is not a breaking change** and
will not get a major version. Handling unknown values is your side of that
bargain.

## Deprecation window

When something public is going away:

1. It is marked `@deprecated` in TSDoc, and the message **names the
   replacement**.
2. It keeps working, unchanged, for **at least two minor releases**.
3. The CHANGELOG records the deprecation when it lands and again when it is
   removed.
4. Removal happens only in a major release.

A deprecated symbol still appears in the API report; it does not disappear
quietly.

## Supported React Native and Expo range

The floors are React Native **≥ 0.79** and Expo SDK **≥ 53** (see the
[compatibility matrix](README.md#requirements)).

- Raising a floor (React Native, Expo, iOS, Android, Kotlin, AGP, Xcode or
  Node) is a **breaking change** and happens only in a **major** release.
- A floor is **never raised above the newest Expo SDK's React Native version
  minus one**. If the newest Expo SDK ships React Native 0.86, our floor may go
  no higher than 0.85. This guarantees that an Expo app on the current SDK — and
  an Expo app one SDK behind — can always install the current version of this
  package.
- Supporting a *newer* React Native is a patch or minor; we do not wait for a
  major to add support.

`react` and `react-native` are peer dependencies with ranges, never pinned.

## Native SDK versions

Every release pins exactly one version of each native SDK: `~> 1.1.0` (a
patch-only range) for `UqpaySDKiOS`, and exactly `0.1.0` for
`com.uqpay.sdk:uqpay-sdk-android`. The Android pin moves to a patch-only range
once `0.1.1` is published. The pinned versions are stated in the CHANGELOG
entry for every release and in the README matrix.

| Native change | Our release |
|---|---|
| Native **patch** (bug fixes) | Our **patch**, consumed within the same week — see [release process](docs/release-process.md) |
| Native **minor** (new features, compatible) | Our **minor** |
| Native **major** | Our **major**, always |

A native major bump is a major bump here even when our own TypeScript surface is
untouched, because the behaviour a merchant integrated against has changed
underneath.

## What counts as breaking

Breaking (major):

- Removing or renaming any public export.
- Adding a required parameter or a required field to an options type.
- Adding a variant to `UqpayPaymentResult`.
- Changing the meaning of an existing result kind, error code or field.
- Raising the React Native, Expo, iOS, Android, Kotlin, AGP, Xcode or Node
  floor.
- Bumping either native SDK across a major version.
- Removing a deprecated symbol.

Not breaking (minor or patch):

- Adding a new export, a new optional field, or a new member to an open union.
- Changing a `userMessage` string (they are copy, not identifiers — never parse
  them).
- Native patch bumps, dependency updates, build and packaging changes.
- Anything under `src/` that is not exported from `index.ts`.

## Security fixes

A security fix ships as fast as we can cut it, on the current major. If a fix is
impossible without a breaking change, we ship the breaking change and say so
loudly in the CHANGELOG rather than leaving the hole open.
