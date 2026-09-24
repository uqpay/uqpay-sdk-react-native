[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / IntentStatus

# Type Alias: IntentStatus

> **IntentStatus** = `"REQUIRES_PAYMENT_METHOD"` \| `"REQUIRES_CUSTOMER_ACTION"` \| `"REQUIRES_CAPTURE"` \| `"PENDING"` \| `"SUCCEEDED"` \| `"CANCELLED"` \| `"CANCELED"` \| `"FAILED"` \| `string` & `Record`\<`never`, `never`\>

A payment-intent status as the gateway spells it. Casing is never changed by
the bridge, and the union is open because the gateway owns it.

## Example

```ts
if (r.kind === 'pending' && r.lastKnownStatus === 'REQUIRES_CUSTOMER_ACTION') {
  persistForLater(r.paymentIntentId);
}
```
