[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / PaymentMethodType

# Type Alias: PaymentMethodType

> **PaymentMethodType** = `"card"` \| `"wechatpay"` \| `"alipaycn"` \| `"alipayhk"` \| `"grabpay"` \| `"paynow"` \| `"unionpay"` \| `"truemoney"` \| `"tng"` \| `"gcash"` \| `"dana"` \| `"kakaopay"` \| `"tosspay"` \| `"naverpay"` \| `string` & `Record`\<`never`, `never`\>

A payment-method wire type. The fourteen values below are the methods both
native SDKs render today; the union stays open because the gateway can add
methods without a wrapper release. `paypal` is not offered by this SDK.

## Example

```ts
await presentPaymentSheet({
  paymentIntentId: 'pi_123',
  returnUrl: 'myapp://pay/return',
  presentation: { singleWallet: 'grabpay' },
});
```
