[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / UqpayErrorCode

# Type Alias: UqpayErrorCode

> **UqpayErrorCode** = `"card_declined"` \| `"insufficient_funds"` \| `"invalid_payment_method"` \| `"3ds_failed"` \| `"cancelled"` \| `"authentication_failed"` \| `"invalid_configuration"` \| `"not_initialized"` \| `"invalid_request"` \| `"network_error"` \| `"timeout"` \| `"server_error"` \| `"intent_not_payable"` \| `"unknown"` \| `string` & `Record`\<`never`, `never`\>

A canonical UQPAY error code, or any other string a native SDK may invent.

The fourteen canonical codes are produced by exactly one mapper per platform,
so the same server condition yields the same code on iOS and Android
Anything else is passed through verbatim with `raw` preserved;
use [isUnknownErrorCode](../functions/isUnknownErrorCode.md) rather than comparing against a closed set.

## Example

```ts
import { isUnknownErrorCode, type UqpayErrorCode } from '@uqpay/react-native';

function retryable(code: UqpayErrorCode): boolean {
  if (isUnknownErrorCode(code)) return false;
  return code === 'network_error';
}
```
