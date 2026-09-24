# Release process

How a version of `@uqpay/react-native` gets to npm. Contributor-facing; a
merchant never needs this page.

Releases are cut **from CI, on a signed tag**. There are no laptop publishes —
`npm publish` from a developer machine is not part of this process and the npm
token lives only in CI.

## The pipeline

A signed tag matching `v*` triggers the release workflow, which runs in order
and stops at the first failure:

1. `yarn typecheck` — `tsc --noEmit`
2. `yarn lint` — ESLint, zero warnings
3. `yarn test` — Jest with the coverage gate
4. `yarn api:check` — the public API report must match `etc/uqpay-react-native.api.md`
5. `yarn docs:check` — every tagged doc sample extracts and type-checks
6. `yarn errors:generate` + drift check — `ERROR_CODES.md` must match `src/errors/table.ts`
7. `yarn pod:lint` — `pod lib lint` against the pinned `UqpaySDKiOS`
8. Example app builds, iOS and Android, debug and release
9. `npm publish --provenance --access public`

Provenance is not optional: it is what lets a merchant verify the tarball was
built from this repository at that commit.

## Before you tag

- [ ] `CHANGELOG.md` has an entry for this version, with today's date, moved out
      of `[Unreleased]`.
- [ ] That entry carries the **Native versions** line naming the exact
      `UqpaySDKiOS` and `uqpay-sdk-android` versions this release pins.
- [ ] Anything a merchant must act on is under a **Migration** subsection.
- [ ] The README [compatibility matrix](../README.md#requirements) row matches
      the pins in `uqpay-react-native.podspec` and `android/build.gradle`.
- [ ] `version` in `package.json` matches the tag.
- [ ] If the public API changed: `yarn api:update` was run and the report diff is
      in the same pull request, and the version bump follows
      [STABILITY.md](../STABILITY.md).
- [ ] If a floor moved: it is a major release (raising a floor is breaking —
      see [STABILITY.md](../STABILITY.md)), and it does not exceed the newest
      Expo SDK's React Native minus one.

Then:

```sh
git tag -s v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

## Native patch releases

The iOS pin is a **patch-only range** (`~> 1.1.0`), so a native iOS patch is
picked up by a fresh `pod install` without any change here. The Android pin is
currently **exact** (`0.1.0`), so an Android patch always needs a pin change
here; it moves to a patch-only range once `0.1.1` is published. Either way that
is not enough: merchants with a committed `Podfile.lock` or a locked Gradle
resolution will not move until we tell them to.

**A native patch release is consumed by a patch release of this package within
the same week.** The process:

1. Read the native CHANGELOG; note which fixes are in it.
2. Bump the pin in `uqpay-react-native.podspec` / `android/build.gradle` —
   always on Android while its pin is exact; on iOS only if the range needs
   widening.
3. Run the full pipeline locally plus a sandbox smoke payment on both platforms.
4. CHANGELOG entry: the new **Native versions** line **and one line per native
   fix carried**, so a merchant can tell whether the patch affects them.
5. Tag a patch.

A native **minor** is our minor; a native **major** is our major, always — see
[STABILITY.md](../STABILITY.md#native-sdk-versions).

## Pin update checklist

Whenever either native version changes, these five must move together. No CI
check enforces this yet, so the releaser checks each one by hand:

- [ ] `uqpay-react-native.podspec` — `s.dependency "UqpaySDKiOS", "~> X.Y.Z"`
- [ ] `android/build.gradle` — the `com.uqpay.sdk:uqpay-sdk-android` range
- [ ] `README.md` — the compatibility matrix row
- [ ] `CHANGELOG.md` — the **Native versions** line for the release
- [ ] A sandbox smoke payment on **both** platforms against the new pins, card
      and one wallet, before the tag

If a native bump raises a floor (deployment target, `minSdk`, Kotlin, AGP,
Xcode), the README matrix and `package.json` peers move too, and the release is
a major: raising a floor is a breaking change (see [STABILITY.md](../STABILITY.md)).

## Release candidates

1.0.0 is preceded by at least one `1.0.0-rc.N` published to npm and integrated
end to end in sandbox, on both platforms, by a real pilot merchant — or by the
internal example app standing in for one.

RCs publish on the `next` dist-tag, never `latest`:

```sh
npm publish --provenance --access public --tag next
```

An RC is cut through the same pipeline as a stable release. The only
differences are the dist-tag and that the CHANGELOG entry stays under
`[Unreleased]` until 1.0.0 is cut.

Promote to `latest` only after the pilot integration has completed a real
sandbox payment on both platforms and signed off.

## After publishing

- [ ] Verify the listing anonymously: `npm view @uqpay/react-native` shows the
      new version, the provenance badge, and a `files` list containing
      `README.md`, `CHANGELOG.md`, `LICENSE`, `PRIVACY.md`, `STABILITY.md`,
      `ERROR_CODES.md` and `docs/` — and none of the repository's internal
      working notes (the `files` list in `package.json` excludes them).
- [ ] Install it into a fresh app at the floor React Native version and run the
      quickstart to a sandbox payment.
- [ ] Publish the GitHub release with the CHANGELOG entry as its body.
