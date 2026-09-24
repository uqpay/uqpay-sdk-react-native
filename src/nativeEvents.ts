/**
 * Event names emitted by the native bridges. This file and `NativeUqpay.ts` are the only
 * places these strings are spelled. Kept out of the spec file so React Native
 * Codegen only ever parses type declarations there.
 *
 * @internal
 */
export const UQPAY_EVENT_TOKEN_REQUESTED = 'uqpay_tokenRequested';
export const UQPAY_EVENT_PAYMENT_RECONCILED = 'uqpay_paymentReconciled';
export const UQPAY_EVENT_REQUIRES_ACTION = 'uqpay_requiresAction';
