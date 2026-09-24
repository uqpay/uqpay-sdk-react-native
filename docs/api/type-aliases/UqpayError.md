[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / UqpayError

# Type Alias: UqpayError

> **UqpayError** = `object`

A normalised error. `userMessage` is safe to show a customer as-is;
`developerMessage` is for your logs and never contains a token, PAN, CVC or
expiry.

`isOutcomeUnknown: true` means the payment may still have succeeded — never
treat it as a definitive failure; reconcile server-side.

## Example

```ts
if (r.kind === 'failed') {
  toast(r.error.userMessage);
  log.error(r.error.developerMessage, { code: r.error.code, traceId: r.error.traceId });
}
```

## Properties

### code

> **code**: [`UqpayErrorCode`](UqpayErrorCode.md)

Canonical code, or an unrecognised one passed through verbatim.

***

### declineCode?

> `optional` **declineCode?**: `string`

The gateway's decline code when it sent one.

***

### developerMessage

> **developerMessage**: `string`

For your logs. Never contains secrets.

***

### httpStatus?

> `optional` **httpStatus?**: `number`

HTTP status when the native SDK could recover one.

***

### isOutcomeUnknown

> **isOutcomeUnknown**: `boolean`

`true` when the payment may still have gone through. Reconcile server-side.

***

### isRetryable

> **isRetryable**: `boolean`

`true` when retrying the same action can plausibly succeed.

***

### platform

> **platform**: `"ios"` \| `"android"`

Which native SDK produced this error.

***

### raw?

> `optional` **raw?**: `string`

The native code/string when `code` is not canonical.

***

### traceId?

> `optional` **traceId?**: `string`

Trace id when available — always `undefined` today (the gateway sends no trace header).

***

### userMessage

> **userMessage**: `string`

Safe to display to the customer: no jargon, no stack, no platform name.
