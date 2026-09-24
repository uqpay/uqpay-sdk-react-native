/**
 * The one error class the SDK throws. Programmer error only — expected payment
 * outcomes resolve.
 */

/**
 * Thrown (and therefore rejected from the async entry points) when the SDK is
 * called wrongly: a missing `init`, a blank or malformed field, a plain-HTTP
 * `returnUrl`, an option the running platform does not support, or an
 * unsupported platform, or a native module that is missing from the app
 * binary. The message always names the exact field or condition. A rejection
 * from the native layer is wrapped in this class too.
 *
 * It is the **only** error type the SDK's functions reject or throw with. A
 * decline, a cancel, a timeout and a pending payment are resolved results,
 * never exceptions, so anything you catch from this SDK is a bug in the
 * calling code or in the app build.
 *
 * @example
 * ```ts
 * import { UqpayConfigurationError, presentPaymentSheet } from '@uqpay/react-native';
 *
 * try {
 *   const result = await presentPaymentSheet({ paymentIntentId, returnUrl });
 *   handle(result);
 * } catch (err) {
 *   if (err instanceof UqpayConfigurationError) {
 *     // err.code is 'invalid_configuration' | 'not_initialized' | 'unsupported_platform'
 *     reportToSentry(err.code, err.message);
 *     return;
 *   }
 *   throw err;
 * }
 * ```
 */
export class UqpayConfigurationError extends Error {
  /**
   * Which class of programmer error this is:
   *
   * - `invalid_configuration` — a field is missing, blank, malformed or not
   *   supported on this platform (the message names it), the native module is
   *   not in the app binary, or the native layer refused the call,
   * - `not_initialized` — `init()` has not resolved yet,
   * - `unsupported_platform` — web, macOS, Windows or Expo Go.
   */
  public readonly code:
    'invalid_configuration' | 'not_initialized' | 'unsupported_platform';

  /**
   * @param code - the configuration error class
   * @param message - a message naming the exact field or condition
   */
  public constructor(
    code: 'invalid_configuration' | 'not_initialized' | 'unsupported_platform',
    message: string
  ) {
    super(message);
    this.name = 'UqpayConfigurationError';
    this.code = code;
    // Restore the prototype chain: `extends Error` is unreliable once the
    // class is downlevelled by Metro/Babel for older JSC runtimes.
    Object.setPrototypeOf(this, UqpayConfigurationError.prototype);
  }
}
