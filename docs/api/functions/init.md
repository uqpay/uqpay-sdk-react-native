[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / init

# Function: init()

> **init**(`options`): `Promise`\<`void`\>

Initialise the SDK. Idempotent: calling it again with the **same** non-secret
configuration is a no-op that only re-registers your `tokenProvider`, which
is what makes a Metro reload or Fast Refresh safe.
Calling it with a **different** configuration while a sheet is open rejects,
because the Android native would rebuild its token manager mid-payment.

Rejects with an error carrying `code: 'invalid_configuration'` for a bad
field (the message names it) or `code: 'unsupported_platform'` on web,
macOS, Windows or Expo Go.

## Parameters

### options

[`InitOptions`](../type-aliases/InitOptions.md)

environment, credentials, token provider and theming

## Returns

`Promise`\<`void`\>

a promise that resolves once the natives are configured

## Example

```ts
import { init } from '@uqpay/react-native';

await init({
  environment: 'sandbox',
  clientId: 'ck_test_123',
  tokenProvider: async () => {
    // Your server mints the token; protect this route with your own user auth.
    const res = await fetch('https://your-server.example/uqpay/token', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const { authToken, expiresAt } = await res.json();
    return { authToken, expiresAt };
  },
});
```
