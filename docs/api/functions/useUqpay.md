[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / useUqpay

# Function: useUqpay()

> **useUqpay**(): `object`

A React-friendly handle on the imperative API. It adds **no capability** the
module functions lack — it exists so the callbacks can go into
a dependency array without being re-created: the returned object and every
callback on it have a stable identity for the life of the JS context, so
`useUqpay()` never causes a re-render or a stale-closure bug.

## Returns

the three payment entry points, with stable identities

### cancelPaymentSheet

> **cancelPaymentSheet**: () => `Promise`\<`void`\>

Ask the native to dismiss the sheet. With nothing in flight the pending
`presentPaymentSheet` promise resolves `canceled` / `merchant_cancelled`;
with a confirm already on its way to the server it resolves `pending`, never
`canceled`. A cancel that arrives while the SDK is still fetching the token,
before the sheet is on screen, stops the sheet from appearing.

#### Returns

`Promise`\<`void`\>

a promise that resolves once the native has accepted the request

#### Example

```ts
useEffect(() => () => { void cancelPaymentSheet(); }, []);
```

### getPendingResult

> **getPendingResult**: () => `Promise`\<[`UqpayPaymentResult`](../type-aliases/UqpayPaymentResult.md) \| `null`\>

Collect a result that arrived while no JS promise was attached — after a
Metro reload, a Fast Refresh, or an Android process death mid-3DS.
Exactly once: the native clears its buffer as it hands the
result over, so a second call returns `null`.

A `pending` result that comes back from here belongs to a JS context that no
longer exists, so its `reconcile()` rejects. Persist `paymentIntentId` on
your side and, after a reload, call [presentPaymentSheet](presentPaymentSheet.md) again with
the same `paymentIntentId`: the natives' terminal-intent guard returns the
settled result without showing a form.

#### Returns

`Promise`\<[`UqpayPaymentResult`](../type-aliases/UqpayPaymentResult.md) \| `null`\>

the buffered result, or `null` when there is none

#### Example

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

### presentPaymentSheet

> **presentPaymentSheet**: (`options`) => `Promise`\<[`UqpayPaymentResult`](../type-aliases/UqpayPaymentResult.md)\>

Present the native payment sheet and wait for the outcome.

Expected outcomes **resolve**: a decline, a cancel, a timeout and a pending
payment all come back as a [UqpayPaymentResult](../type-aliases/UqpayPaymentResult.md). The
promise rejects only for programmer error — no `init`, a bad field, a
plain-HTTP `returnUrl`, an unsupported platform.

Presenting while a sheet is already open resolves (it does not reject)
`failed` / `invalid_configuration`, so a double tap cannot open two sheets.

#### Parameters

##### options

[`PresentOptions`](../type-aliases/PresentOptions.md)

the intent, the return URL and how to present

#### Returns

`Promise`\<[`UqpayPaymentResult`](../type-aliases/UqpayPaymentResult.md)\>

exactly one of the four [UqpayPaymentResult](../type-aliases/UqpayPaymentResult.md) variants

#### Example

```ts
const result = await presentPaymentSheet({
  paymentIntentId: 'pi_123',
  returnUrl: 'myapp://pay/return',
});
if (result.kind === 'pending') {
  await persist(result.paymentIntentId);
}
```

## Example

```tsx
function PayButton({ paymentIntentId }: { paymentIntentId: string }) {
  const { presentPaymentSheet } = useUqpay();
  const pay = useCallback(
    () => presentPaymentSheet({ paymentIntentId, returnUrl: 'myapp://pay/return' }),
    [presentPaymentSheet, paymentIntentId]
  );
  return <Button title="Pay" onPress={pay} />;
}
```
