# Security Policy

`@uqpay/react-native` handles payment flows for merchant apps. We take reports
about it seriously and would much rather hear about a problem early than read
about it later.

## Supported versions

| Version | Supported |
| ------- | --------- |
| `1.0.0-rc.x` (release candidate) | ✅ Current development line |

Once `1.0.0` ships, this table will list the release lines that receive
security fixes.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.** A public
issue tells everyone about the weakness before merchants have a fixed version
to move to.

Use **GitHub's private vulnerability reporting** instead:

> Repository → **Security** tab → **Report a vulnerability**

That opens a private channel visible only to the maintainers. It keeps the
whole exchange in one place, and it lets us credit you when the fix ships.

**If you cannot use GitHub, email [it@uqpay.com](mailto:it@uqpay.com)** with
`SECURITY` in the subject line. Plain email is not encrypted, so keep the first
message short — what the issue affects and roughly how severe you believe it is
— and we will arrange a secure channel before you send details or any proof of
concept.

### What to include

- The `@uqpay/react-native` version, your React Native (and Expo, if used)
  version, and the platform: iOS or Android, OS version and device model.
- What an attacker can achieve, and the steps to reproduce it.
- Any proof-of-concept code, and the impact you believe it has.

**Never include real card numbers, security codes, API keys, access tokens, or
customer personal data in a report.** Use sandbox test values. If a real value
is genuinely necessary to explain the issue, say so and we will arrange a safer
channel — do not paste it. Mask anything you must reference, for example a card
as `•••• •••• •••• 1234`.

## What to expect

These are our targets, measured in business days:

| Stage | Target |
| ----- | ------ |
| Acknowledgement that we received the report | 3 days |
| Initial assessment and a severity judgement | 10 days |
| Fix or documented mitigation for a confirmed high-severity issue | 30 days |

We will keep you updated if something takes longer, and we will tell you when a
fix ships.

## Scope

**In scope** — anything in this repository: the JavaScript API, the iOS and
Android bridge code, the Expo config plugin, the Jest helper, and the example
apps and example backend.

**Out of scope:**

- The native payment SDKs this package wraps. Report those to
  [uqpay-sdk-ios](https://github.com/uqpay/uqpay-sdk-ios) and
  [uqpay-sdk-android](https://github.com/uqpay/uqpay-sdk-android).
- The UQPAY gateway and platform APIs. Those are a separate system with a
  separate reporting path; contact UQPAY directly rather than filing here.
- Reports that depend on a rooted or compromised device, on the host app
  deliberately misusing the public API, or on credentials the reporter already
  controls.
- The example backend's documented shortcuts (an unauthenticated token route,
  open CORS, a client-chosen amount). It is a local demo, not a server to deploy;
  its README lists what a real backend must do instead.

## Card data and network traffic

Card details are entered in the native payment sheet and never pass through
JavaScript. This package makes no network requests of its own: all traffic goes
through the native UQPAY SDKs over HTTPS, and certificate validation follows
their policies (see the security policy of each native SDK).

The SDK never logs the auth token, card data or customer details. How your own
server protects the token it mints — and why your server, not the app, must
confirm every payment — is covered in the README's
[Security checklist for production](README.md#security-checklist-for-production).

## Coordinated disclosure

We ask that you give us a reasonable window to ship a fix before publishing
details. We will not take legal action against anyone who reports a
vulnerability in good faith, follows this policy, and avoids privacy violations,
data destruction, and any disruption to production systems or real payments.
