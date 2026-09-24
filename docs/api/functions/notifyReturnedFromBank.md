[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / notifyReturnedFromBank

# Function: notifyReturnedFromBank()

> **notifyReturnedFromBank**(): `void`

Tell the SDK your app was reopened by the bank's return URL. Only needed on
iOS, and only if your app handles the deep link itself with `Linking`; it is
a no-op on Android.

It never throws, so it is safe inside a `Linking` listener: before `init()`
has resolved there is no sheet to notify and the call does nothing.

## Returns

`void`

## Example

```ts
Linking.addEventListener('url', ({ url }) => {
  if (url.startsWith('myapp://pay/return')) notifyReturnedFromBank();
});
```
