[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / presentPaymentSheet

# Function: presentPaymentSheet()

> **presentPaymentSheet**(`options`): `Promise`\<[`UqpayPaymentResult`](../type-aliases/UqpayPaymentResult.md)\>

Present the native payment sheet and wait for the outcome.

Expected outcomes **resolve**: a decline, a cancel, a timeout and a pending
payment all come back as a [UqpayPaymentResult](../type-aliases/UqpayPaymentResult.md). The
promise rejects only for programmer error — no `init`, a bad field, a
plain-HTTP `returnUrl`, an unsupported platform.

Presenting while a sheet is already open resolves (it does not reject)
`failed` / `invalid_configuration`, so a double tap cannot open two sheets.

## Parameters

### options

[`PresentOptions`](../type-aliases/PresentOptions.md)

the intent, the return URL and how to present

## Returns

`Promise`\<[`UqpayPaymentResult`](../type-aliases/UqpayPaymentResult.md)\>

exactly one of the four [UqpayPaymentResult](../type-aliases/UqpayPaymentResult.md) variants

## Example

```ts
const result = await presentPaymentSheet({
  paymentIntentId: 'pi_123',
  returnUrl: 'myapp://pay/return',
});
if (result.kind === 'pending') {
  await persist(result.paymentIntentId);
}
```
