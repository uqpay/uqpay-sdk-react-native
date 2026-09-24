[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / isUnknownErrorCode

# Function: isUnknownErrorCode()

> **isUnknownErrorCode**(`code`): `boolean`

`true` when a code is not one of the fourteen canonical documented codes, or
is literally `'unknown'`.

Merchants should branch on this rather than on a closed set, so a new code
from either native degrades to "something went wrong" instead of throwing.

## Parameters

### code

`string`

the `code` from a [UqpayError](../type-aliases/UqpayError.md)

## Returns

`boolean`

`true` when the SDK has no documented handling for this code

## Example

```ts
import { isUnknownErrorCode } from '@uqpay/react-native';

if (result.kind === 'failed' && isUnknownErrorCode(result.error.code)) {
  reportToSentry(result.error.raw ?? result.error.code);
}
```
