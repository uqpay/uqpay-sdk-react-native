[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / UqpayPaymentResult

# Type Alias: UqpayPaymentResult

> **UqpayPaymentResult** = \{ `amount?`: `string`; `completedAt?`: `string`; `currency?`: `string`; `kind`: `"completed"`; `merchantOrderId?`: `string`; `paymentIntentId`: `string`; `paymentMethodType?`: [`PaymentMethodType`](PaymentMethodType.md); `status`: `"SUCCEEDED"` \| `"REQUIRES_CAPTURE"`; `transactionId?`: `string`; \} \| \{ `error`: [`UqpayError`](UqpayError.md); `kind`: `"failed"`; `paymentIntentId`: `string`; \} \| \{ `kind`: `"canceled"`; `paymentIntentId`: `string`; `reason`: [`CancelReason`](CancelReason.md); \} \| \{ `cause?`: [`UqpayError`](UqpayError.md); `kind`: `"pending"`; `lastKnownStatus?`: [`IntentStatus`](IntentStatus.md); `paymentIntentId`: `string`; `reconcile`: () => `Promise`\<`UqpayPaymentResult`\>; \}

The outcome of one `presentPaymentSheet` call — a discriminated union on
`kind`, so a `switch` is exhaustive under `strict`. **This set of four is
frozen for the 1.x line**: new outcomes arrive as new error
codes or new fields, never as a fifth variant.

The client result is a UX signal, not proof of payment. Before fulfilling an
order, confirm the payment on your server by retrieving the payment intent
from the UQPAY API.

## Union Members

### Type Literal

\{ `amount?`: `string`; `completedAt?`: `string`; `currency?`: `string`; `kind`: `"completed"`; `merchantOrderId?`: `string`; `paymentIntentId`: `string`; `paymentMethodType?`: [`PaymentMethodType`](PaymentMethodType.md); `status`: `"SUCCEEDED"` \| `"REQUIRES_CAPTURE"`; `transactionId?`: `string`; \}

#### amount?

> `optional` **amount?**: `string`

The wire amount in major units, as a string, never re-scaled
Absent when the native could not report one.

#### completedAt?

> `optional` **completedAt?**: `string`

ISO-8601 timestamp. **Informational only** — iOS reports the gateway's
`completed_at`, Android reports the device's observation time, and
neither is a settlement time.

#### currency?

> `optional` **currency?**: `string`

ISO-4217 currency, casing untouched.

#### kind

> **kind**: `"completed"`

The gateway accepted the payment. For a manual-capture intent this may
mean authorised but not yet captured — see `status`.

#### merchantOrderId?

> `optional` **merchantOrderId?**: `string`

Your order reference, when the intent carried one.

#### paymentIntentId

> **paymentIntentId**: `string`

The intent that was paid.

#### paymentMethodType?

> `optional` **paymentMethodType?**: [`PaymentMethodType`](PaymentMethodType.md)

The method the native actually confirmed.

#### status

> **status**: `"SUCCEEDED"` \| `"REQUIRES_CAPTURE"`

Almost always `'SUCCEEDED'` — including for a manual-capture intent that
is authorised and awaiting capture: both native sheets report
`SUCCEEDED` in that case. `'REQUIRES_CAPTURE'` appears only when the iOS
bridge settled the result by re-reading the intent from the server. If
you use manual capture, read the capture state from your server; do not
infer it from this field.

#### transactionId?

> `optional` **transactionId?**: `string`

The payment-attempt id. `undefined` on iOS when it fell back to the intent id.

***

### Type Literal

\{ `error`: [`UqpayError`](UqpayError.md); `kind`: `"failed"`; `paymentIntentId`: `string`; \}

#### error

> **error**: [`UqpayError`](UqpayError.md)

Why it failed.

#### kind

> **kind**: `"failed"`

The payment definitively did not go through (unless `error.isOutcomeUnknown`).

#### paymentIntentId

> **paymentIntentId**: `string`

The intent that was attempted.

***

### Type Literal

\{ `kind`: `"canceled"`; `paymentIntentId`: `string`; `reason`: [`CancelReason`](CancelReason.md); \}

#### kind

> **kind**: `"canceled"`

The sheet closed with no attempt, or the intent was already cancelled.

#### paymentIntentId

> **paymentIntentId**: `string`

The intent that was attempted.

#### reason

> **reason**: [`CancelReason`](CancelReason.md)

Who or what cancelled.

***

### Type Literal

\{ `cause?`: [`UqpayError`](UqpayError.md); `kind`: `"pending"`; `lastKnownStatus?`: [`IntentStatus`](IntentStatus.md); `paymentIntentId`: `string`; `reconcile`: () => `Promise`\<`UqpayPaymentResult`\>; \}

#### cause?

> `optional` **cause?**: [`UqpayError`](UqpayError.md)

Why the outcome is unknown — usually `timeout` with `isOutcomeUnknown: true`.

#### kind

> **kind**: `"pending"`

The outcome is not known on the device. **`pending` is final for this
promise on both platforms**; resolve it with `reconcile()`
or from your server.

#### lastKnownStatus?

> `optional` **lastKnownStatus?**: [`IntentStatus`](IntentStatus.md)

The last intent status the native saw, if it saw one.

#### paymentIntentId

> **paymentIntentId**: `string`

The intent to reconcile. Persist it.

#### reconcile

> **reconcile**: () => `Promise`\<`UqpayPaymentResult`\>

Ask the native to settle this intent. Implemented by re-presenting the
same intent: the natives' terminal-intent guard returns the settled
result without showing a form. On iOS it resolves immediately when a
`paymentReconciled` event for this intent has already arrived.

It needs the JS context that produced this result. After a Metro
reload or a process restart that context is gone and `reconcile()`
rejects; call `presentPaymentSheet` again with the same
`paymentIntentId` instead — the terminal-intent guard returns the
settled result without showing a form. Persist `paymentIntentId` on
your side so you can do that at next launch.

##### Returns

`Promise`\<`UqpayPaymentResult`\>

##### Example

```ts
if (result.kind === 'pending') {
  await AsyncStorage.setItem('uqpay.pendingIntent', result.paymentIntentId);
  const settled = await result.reconcile();
}
// next launch, after a reload:
const id = await AsyncStorage.getItem('uqpay.pendingIntent');
if (id) await presentPaymentSheet({ paymentIntentId: id, returnUrl });
```

## Example

```ts
const result = await presentPaymentSheet({ paymentIntentId, returnUrl });
switch (result.kind) {
  case 'completed': return showReceipt(result.paymentIntentId);
  case 'failed':    return toast(result.error.userMessage);
  case 'canceled':  return showTryAgain();
  case 'pending':   return persistAndReconcileLater(result);
}
```
