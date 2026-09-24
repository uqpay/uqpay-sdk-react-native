[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / PresentOptions

# Type Alias: PresentOptions

> **PresentOptions** = `object`

Options for [presentPaymentSheet](../functions/presentPaymentSheet.md).

## Example

```ts
const result = await presentPaymentSheet({
  paymentIntentId: 'pi_123',
  returnUrl: 'myapp://pay/return',
  presentation: 'methodList',
});
```

## Properties

### allowedPaymentMethods?

> `optional` **allowedPaymentMethods?**: [`PaymentMethodType`](PaymentMethodType.md)[]

Restrict the picker to these methods. An **empty array is rejected** on
both platforms so the two agree.

**Android-only** until the iOS native SDK supports it; on iOS it rejects
with `invalid_configuration`.

***

### billingDetails?

> `optional` **billingDetails?**: [`BillingDetails`](BillingDetails.md)

Prefill for the card form. **Android-only**; ignored with a warning on iOS.
Not retained by the SDK after the sheet settles.

***

### merchantDisplayName?

> `optional` **merchantDisplayName?**: `string`

iOS-only copy hook: the merchant name the iOS sheet shows in its header.
**Ignored on Android**, whose sheet has no equivalent slot.

***

### paymentIntentId

> **paymentIntentId**: `string`

The intent to pay, created by your server. Must match
`/^[A-Za-z0-9_-]{1,128}$/`, or the call rejects with
`invalid_configuration`.

***

### presentation?

> `optional` **presentation?**: `"methodList"` \| `"cardOnly"` \| \{ `singleWallet`: [`PaymentMethodType`](PaymentMethodType.md); \}

`'methodList'` (default) shows every method the intent allows;
`'cardOnly'` shows just the card form; `{ singleWallet }` goes straight to
one wallet.

`{ singleWallet }` is **Android-only** until the iOS native SDK supports
it; on iOS it rejects with `invalid_configuration`.

***

### returnUrl

> **returnUrl**: `string`

Where the bank / 3DS challenge returns to: an `https://` URL or a custom
scheme. Plain HTTP is rejected at call time. Prefer an `https://`
Universal Link / App Link you own (another app can register the same custom
scheme), and put no secret or order data in it.
