[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / InitOptions

# Type Alias: InitOptions

> **InitOptions** = `object`

Options for [init](../functions/init.md). Everything here except `tokenProvider` is
non-secret and forms the config identity used for idempotent re-`init`:
calling `init` again with the same values is a no-op.

## Example

```ts
await init({
  environment: 'sandbox',
  clientId: 'ck_test_123',
  tokenProvider: async () => {
    // Your server mints the token; protect this route with your own user session.
    const r = await fetch('https://your-server.example/uqpay/client-token', { method: 'POST' });
    const { authToken, expiresAt } = await r.json();
    return { authToken, expiresAt };
  },
});
```

## Properties

### appearance?

> `optional` **appearance?**: [`Appearance`](Appearance.md)

Sheet theming. See [Appearance](Appearance.md).

***

### clientId

> **clientId**: `string`

Your UQPAY client id. Not a secret. Must be printable ASCII with no
whitespace, or `init` rejects with `invalid_configuration`.

***

### debugLogging?

> `optional` **debugLogging?**: `boolean`

Ask the natives for verbose logs. Ignored by both natives in release builds.

***

### environment

> **environment**: `"sandbox"` \| `"production"`

Which UQPAY environment to talk to.

***

### tokenProvider

> **tokenProvider**: () => `Promise`\<\{ `authToken`: `string`; `expiresAt?`: `number`; \}\>

Returns a fresh merchant auth token. Called by the native bridge before
**every** present and whenever the native needs to refresh, so cache it on
your side. The SDK passes the value to native once and never logs, stores
or re-reads it. The token is a merchant credential: serve it only to your
own authenticated users.

`expiresAt` is epoch milliseconds. **Always return it** (your server gets
the expiry from UQPAY). Without it the SDK prints one developer warning and
the natives treat the token as short-lived (Android assumes five minutes),
so it is re-requested more often than necessary.

If it throws, returns a blank token, or does not settle within the
native's 10 s budget, the payment resolves `failed` with
`authentication_failed`. The SDK adds no timer of its own.

#### Returns

`Promise`\<\{ `authToken`: `string`; `expiresAt?`: `number`; \}\>
