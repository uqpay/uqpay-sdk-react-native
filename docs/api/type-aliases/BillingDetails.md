[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / BillingDetails

# Type Alias: BillingDetails

> **BillingDetails** = `object`

Billing information used to **prefill** the card form. Never card data.

Android-only until the iOS native SDK adds billing prefill: on iOS the field
is ignored and the SDK emits one `console.warn` per JS context. The SDK does
not keep billing details after the sheet settles.

## Example

```ts
await presentPaymentSheet({
  paymentIntentId: 'pi_123',
  returnUrl: 'myapp://pay/return',
  billingDetails: { firstName: 'Ada', email: 'ada@example.com', countryCode: 'SG' },
});
```

## Properties

### addressLine1?

> `optional` **addressLine1?**: `string`

Street address, first line.

***

### addressLine2?

> `optional` **addressLine2?**: `string`

Street address, second line.

***

### city?

> `optional` **city?**: `string`

City / locality.

***

### countryCode?

> `optional` **countryCode?**: `string`

ISO-3166 alpha-2 country code, e.g. `'SG'`.

***

### email?

> `optional` **email?**: `string`

Contact email.

***

### firstName?

> `optional` **firstName?**: `string`

Given name.

***

### lastName?

> `optional` **lastName?**: `string`

Family name.

***

### phone?

> `optional` **phone?**: `string`

Contact phone in E.164 if you have it.

***

### postalCode?

> `optional` **postalCode?**: `string`

Postal or ZIP code.

***

### state?

> `optional` **state?**: `string`

State / province / region.
