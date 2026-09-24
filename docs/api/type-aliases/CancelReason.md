[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / CancelReason

# Type Alias: CancelReason

> **CancelReason** = `"user_cancelled"` \| `"merchant_cancelled"` \| `"intent_cancelled"` \| `string` & `Record`\<`never`, `never`\>

Why a payment sheet closed without an outcome.

`user_cancelled` — the customer dismissed the sheet (neither native
distinguishes a swipe from the close button). `merchant_cancelled` — your app
called [cancelPaymentSheet](../functions/cancelPaymentSheet.md) with nothing in flight. `intent_cancelled` —
the intent was cancelled server-side before it could be paid.

## Example

```ts
if (r.kind === 'canceled' && r.reason === 'user_cancelled') {
  showTryAgain();
}
```
