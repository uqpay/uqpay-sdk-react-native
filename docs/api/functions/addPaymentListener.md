[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / addPaymentListener

# Function: addPaymentListener()

> **addPaymentListener**(`listener`): `object`

Subscribe to out-of-band payment events. Both are **iOS-only** today:
`paymentReconciled` fires when a late server read settles an intent that
previously resolved `pending`, and `requiresAction` when the sheet shows a
customer action. On Android, settle a `pending` result with
`result.reconcile()` or, better, from your server.

The returned handle removes both underlying native subscriptions, leaving no
listener behind.

## Parameters

### listener

(`event`) => `void`

called for every event; exceptions it throws are not swallowed

## Returns

`object`

a handle with a `remove()` method

### remove

> **remove**: () => `void`

#### Returns

`void`

## Example

```ts
useEffect(() => {
  const sub = addPaymentListener((e) => {
    if (e.type === 'paymentReconciled') void refreshOrder(e.result.paymentIntentId);
  });
  return () => { sub.remove(); };
}, []);
```
