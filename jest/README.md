# `@uqpay/react-native/jest` — the scripted mock native module

A stand-in for the `Uqpay` Turbo Module. It implements the whole
Codegen `Spec`, records every call, and lets a test decide what "native" does
next — so you can test declines, 3DS failures, cancellations, timeouts and
pending payments on CI, without a simulator and without touching sandbox.

The SDK's own suite uses this exact mock, so it cannot quietly drift from the
real bridge.

> The mock never talks to a network and never holds a real credential. The
> token it hands out is a sentinel string, so you can assert in your own tests
> that a token never reaches your logs.

## Setup

```ts
// jest.setup.ts
// Importing the helper registers the mock as the `Uqpay` native module.
// Import Jest's globals explicitly: TypeScript app templates (e.g. Expo's) do not
// declare them globally, so `tsc --noEmit` fails on a bare `beforeEach`.
import { beforeEach } from '@jest/globals';
import { uqpayNativeMock } from '@uqpay/react-native/jest';

beforeEach(() => {
  uqpayNativeMock.__reset();
});
```

> Do **not** add `jest.mock('@uqpay/react-native/jest')`. That swaps the helper
> for a Jest automock, the SDK then finds no native module, and every call
> rejects with `invalid_configuration`.

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
  // Only if needed: the package ships ES modules; let Babel transform them.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@uqpay)/)',
  ],
};
```

**Expo** — use the `jest-expo` preset. It works with the helper without any
`transformIgnorePatterns` entry; just point `setupFilesAfterEnv` at the setup
file above.

## A worked example

```ts
import { expect, it } from '@jest/globals';
import { init, presentPaymentSheet } from '@uqpay/react-native';
import { uqpayNativeMock as native } from '@uqpay/react-native/jest';

it('shows the decline message', async () => {
  native.__setPlatform('android');
  await init({
    environment: 'sandbox',
    clientId: 'ck_test_1',
    tokenProvider: native.tokenProvider,
  });

  native.__nextResult({
    kind: 'failed',
    paymentIntentId: 'pi_1',
    error: {
      code: 'card_declined',
      developerMessage: 'issuer declined',
      declineCode: 'do_not_honor',
      isOutcomeUnknown: false,
    },
    platform: 'android',
    resultId: 'r1',
  });

  const result = await presentPaymentSheet({
    paymentIntentId: 'pi_1',
    returnUrl: 'myapp://pay/return',
  });

  expect(result.kind).toBe('failed');
  expect(native.__calls.presentPaymentSheet).toHaveLength(1);
});
```

## Scripting hooks

| Hook | What it does |
|---|---|
| `__setPlatform('ios' \| 'android')` | Drives `Platform.OS` **and** the `platform` field of generated results. Defaults to `ios`. |
| `__platform()` | The platform the mock is currently pretending to be. |
| `__nextResult(nativeResult)` | Queues the payload the next `presentPaymentSheet` resolves with. Queue several to script a sequence. |
| `__nextReject(error)` | Queues a rejection — use it only for programmer error; expected outcomes resolve. |
| `__pending(nativeResult \| null)` | Sets what the next `getPendingResult()` returns. Consumed exactly once, like the native buffer. |
| `__emit(eventName, payload)` | Emits a native event (`uqpay_paymentReconciled`, `uqpay_requiresAction`, `uqpay_tokenRequested`) to whatever listeners exist. |
| `__tokenBehaviour('resolve' \| 'throw' \| 'blank' \| 'hang')` | How the ready-made `tokenProvider` behaves. `hang` never settles — the SDK adds no timeout of its own; the 10 s budget belongs to native. |
| `__emitTokenRequestOnPresent(boolean)` | Whether `presentPaymentSheet` first emits `uqpay_tokenRequested`. On by default, so the token round-trip is always exercised. |
| `__listenerCount()` | Live native listener count (`addListener` minus `removeListeners`), for leak tests. |
| `__calls` | Everything recorded: `initialize`, `presentPaymentSheet`, `cancelPaymentSheet`, `notifyReturnedFromBank`, `getPendingResult`, `provideToken`, `failToken`, `addListener`, `removeListeners`. |
| `__reset()` | Forgets every recorded call and queued answer, and goes back to `ios`. |
| `tokenProvider` | A ready-made `InitOptions['tokenProvider']` driven by `__tokenBehaviour`. |
| `__sentinelToken` | The token `tokenProvider` resolves with — assert it never appears in your logs. |

`createUqpayNativeMock()` builds an independent instance if you need two
modules in one file.

## Scenario fixtures

The scenario table the SDK itself is tested against (success, decline, 3DS
fail, dismiss-mid-confirm, server 5xx, malformed payload, unknown code, QR
expiry, the terminal-intent guard, …) lives as JSON alongside the native test suites in
the GitHub repository — [`ios/Tests/Fixtures`](https://github.com/uqpay/uqpay-sdk-react-native/tree/main/ios/Tests/Fixtures)
and [`android/src/test/resources`](https://github.com/uqpay/uqpay-sdk-react-native/tree/main/android/src/test/resources)
— so all three platforms assert the same behaviour. It is **not** included in
the npm package. See [`ERROR_CODES.md`](../ERROR_CODES.md) for the codes those
scenarios produce.
