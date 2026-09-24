/**
 * The single place this sample app touches `@uqpay/react-native`.
 *
 * Everything re-exported here is the public surface frozen in
 * `ACCEPTANCE_CRITERIA.md` §2.1 — nothing more. Keeping it in one file means
 * that while `src/` is still being written, exactly one module fails to
 * type-check, and the rest of the app is already checked against the contract.
 */

export {
  init,
  presentPaymentSheet,
  cancelPaymentSheet,
  notifyReturnedFromBank,
  getPendingResult,
  addPaymentListener,
  useUqpay,
  isUnknownErrorCode,
} from '@uqpay/react-native';

export type {
  UqpayPaymentResult,
  UqpayError,
  UqpayErrorCode,
  PaymentMethodType,
  CancelReason,
  IntentStatus,
  BillingDetails,
  Appearance,
  PaymentEvent,
  InitOptions,
  PresentOptions,
} from '@uqpay/react-native';
