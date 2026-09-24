/**
 * `@uqpay/react-native` — the UQPAY payment sheet for React Native.
 *
 * This module is the **entire** public surface: nothing from the
 * Turbo Module spec, the native bridges or the internal helpers is re-exported,
 * and the list below is frozen in `etc/uqpay-react-native.api.md`.
 *
 * @example
 * ```ts
 * import { init, presentPaymentSheet } from '@uqpay/react-native';
 *
 * async function pay(paymentIntentId: string) {
 *   await init({ environment: 'sandbox', clientId, tokenProvider });
 *   return presentPaymentSheet({ paymentIntentId, returnUrl: 'myapp://pay/return' });
 * }
 * ```
 *
 * @packageDocumentation
 */

export {
  addPaymentListener,
  cancelPaymentSheet,
  getPendingResult,
  init,
  notifyReturnedFromBank,
  presentPaymentSheet,
  useUqpay,
} from './client';
export { UqpayConfigurationError } from './errors/configurationError';
export { isUnknownErrorCode } from './errors/mapper';
export type {
  Appearance,
  BillingDetails,
  CancelReason,
  InitOptions,
  IntentStatus,
  PaymentEvent,
  PaymentMethodType,
  PresentOptions,
  UqpayError,
  UqpayErrorCode,
  UqpayPaymentResult,
} from './types';
