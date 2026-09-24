[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / cancelPaymentSheet

# Function: cancelPaymentSheet()

> **cancelPaymentSheet**(): `Promise`\<`void`\>

Ask the native to dismiss the sheet. With nothing in flight the pending
`presentPaymentSheet` promise resolves `canceled` / `merchant_cancelled`;
with a confirm already on its way to the server it resolves `pending`, never
`canceled`. A cancel that arrives while the SDK is still fetching the token,
before the sheet is on screen, stops the sheet from appearing.

## Returns

`Promise`\<`void`\>

a promise that resolves once the native has accepted the request

## Example

```ts
useEffect(() => () => { void cancelPaymentSheet(); }, []);
```
