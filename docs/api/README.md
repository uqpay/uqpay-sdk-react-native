**@uqpay/react-native**

***

# @uqpay/react-native

`@uqpay/react-native` — the UQPAY payment sheet for React Native.

This module is the **entire** public surface: nothing from the
Turbo Module spec, the native bridges or the internal helpers is re-exported,
and the list below is frozen in `etc/uqpay-react-native.api.md`.

## Example

```ts
import { init, presentPaymentSheet } from '@uqpay/react-native';

async function pay(paymentIntentId: string) {
  await init({ environment: 'sandbox', clientId, tokenProvider });
  return presentPaymentSheet({ paymentIntentId, returnUrl: 'myapp://pay/return' });
}
```

## Classes

- [UqpayConfigurationError](classes/UqpayConfigurationError.md)

## Type Aliases

- [Appearance](type-aliases/Appearance.md)
- [BillingDetails](type-aliases/BillingDetails.md)
- [CancelReason](type-aliases/CancelReason.md)
- [InitOptions](type-aliases/InitOptions.md)
- [IntentStatus](type-aliases/IntentStatus.md)
- [PaymentEvent](type-aliases/PaymentEvent.md)
- [PaymentMethodType](type-aliases/PaymentMethodType.md)
- [PresentOptions](type-aliases/PresentOptions.md)
- [UqpayError](type-aliases/UqpayError.md)
- [UqpayErrorCode](type-aliases/UqpayErrorCode.md)
- [UqpayPaymentResult](type-aliases/UqpayPaymentResult.md)

## Functions

- [addPaymentListener](functions/addPaymentListener.md)
- [cancelPaymentSheet](functions/cancelPaymentSheet.md)
- [getPendingResult](functions/getPendingResult.md)
- [init](functions/init.md)
- [isUnknownErrorCode](functions/isUnknownErrorCode.md)
- [notifyReturnedFromBank](functions/notifyReturnedFromBank.md)
- [presentPaymentSheet](functions/presentPaymentSheet.md)
- [useUqpay](functions/useUqpay.md)
