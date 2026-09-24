[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / PaymentEvent

# Type Alias: PaymentEvent

> **PaymentEvent** = \{ `result`: [`UqpayPaymentResult`](UqpayPaymentResult.md); `type`: `"paymentReconciled"`; \} \| \{ `action`: \{ `type`: `"authenticate3DS"` \| `"scanQRCode"` \| `"displayBankDetails"` \| `"verifyOTP"` \| `"custom"` \| `string` & `Record`\<`never`, `never`\>; `url?`: `string`; \}; `type`: `"requiresAction"`; \}

An event delivered to [addPaymentListener](../functions/addPaymentListener.md).

Both events are **iOS-only** today. `paymentReconciled` fires when a late
server read settles an intent that earlier resolved `pending`; the Android
native never emits it, so on Android settle a `pending` result with
`result.reconcile()` or from your server. `requiresAction` fires when the iOS
sheet shows a customer action; Android's native callback is result-only, so
do not build UI that depends on it.

## Union Members

### Type Literal

\{ `result`: [`UqpayPaymentResult`](UqpayPaymentResult.md); `type`: `"paymentReconciled"`; \}

#### result

> **result**: [`UqpayPaymentResult`](UqpayPaymentResult.md)

The settled result.

#### type

> **type**: `"paymentReconciled"`

A late outcome for an intent that previously resolved `pending`. **iOS only.**

***

### Type Literal

\{ `action`: \{ `type`: `"authenticate3DS"` \| `"scanQRCode"` \| `"displayBankDetails"` \| `"verifyOTP"` \| `"custom"` \| `string` & `Record`\<`never`, `never`\>; `url?`: `string`; \}; `type`: `"requiresAction"`; \}

#### action

> **action**: `object`

What the customer is being asked to do.

##### action.type

> **type**: `"authenticate3DS"` \| `"scanQRCode"` \| `"displayBankDetails"` \| `"verifyOTP"` \| `"custom"` \| `string` & `Record`\<`never`, `never`\>

The kind of action; open union — new action types are not breaking.

##### action.url?

> `optional` **url?**: `string`

The ACS or QR URL. Never logged by the SDK.

#### type

> **type**: `"requiresAction"`

The native is showing a customer action. **iOS only.**

## Example

```ts
const sub = addPaymentListener((e) => {
  if (e.type === 'paymentReconciled') void refreshOrder(e.result.paymentIntentId);
});
// later
sub.remove();
```
