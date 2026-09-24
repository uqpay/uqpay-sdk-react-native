[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / getPendingResult

# Function: getPendingResult()

> **getPendingResult**(): `Promise`\<[`UqpayPaymentResult`](../type-aliases/UqpayPaymentResult.md) \| `null`\>

Collect a result that arrived while no JS promise was attached — after a
Metro reload, a Fast Refresh, or an Android process death mid-3DS.
Exactly once: the native clears its buffer as it hands the
result over, so a second call returns `null`.

A `pending` result that comes back from here belongs to a JS context that no
longer exists, so its `reconcile()` rejects. Persist `paymentIntentId` on
your side and, after a reload, call [presentPaymentSheet](presentPaymentSheet.md) again with
the same `paymentIntentId`: the natives' terminal-intent guard returns the
settled result without showing a form.

## Returns

`Promise`\<[`UqpayPaymentResult`](../type-aliases/UqpayPaymentResult.md) \| `null`\>

the buffered result, or `null` when there is none

## Example

```ts
useEffect(() => {
  void getPendingResult().then(async (r) => {
    if (!r) return;
    if (r.kind === 'pending') {
      // The reload cleared reconcile()'s context: re-present the same intent.
      return showOutcome(await presentPaymentSheet({ paymentIntentId: r.paymentIntentId, returnUrl }));
    }
    showOutcome(r);
  });
}, []);
```
