/**
 * Call-time validation.
 *
 * Every check throws a {@link UqpayConfigurationError} whose message names the
 * exact field, so a misconfiguration is a programmer error at call time rather
 * than a runtime failure in the middle of a payment.
 *
 * @internal
 */
import { UqpayConfigurationError } from './errors/configurationError';
import { warnOnce } from './log';
import type {
  Appearance,
  BillingDetails,
  InitOptions,
  PresentOptions,
  UqpayPlatform,
} from './types';

/** `#RGB` is not accepted: both natives want 6 or 8 hex digits. */
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Matches a plain-HTTP URL. Written as a regular expression so the literal
 * scheme string never appears in `src/` (the tripwire test forbids it).
 */
const INSECURE_URL = /^http:\/\//i;

/**
 * UQPAY ids are short ASCII tokens (`PI2102058574451576832`, `ck_live_…`).
 * Anything else is refused before it reaches native: the payment intent id is
 * placed into a request path, so a `/`, `?`, `%` or `..` must never get through.
 */
const PAYMENT_INTENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Printable ASCII with no whitespace — a header value must not carry a line break. */
const CLIENT_ID = /^[\x21-\x7E]{1,256}$/;

function fail(message: string): never {
  throw new UqpayConfigurationError('invalid_configuration', message);
}

function requireNonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${field} must be a non-empty string.`);
  }
  return value;
}

function requireHexColour(value: unknown, field: string): void {
  if (typeof value !== 'string' || !HEX_COLOUR.test(value)) {
    fail(
      `${field} must be a hex colour like "#0A84FF" or "#0A84FFCC" (6 or 8 hex digits), received ${JSON.stringify(value)}.`
    );
  }
}

function validateColourMap(
  map: Record<string, string> | undefined,
  field: string
): void {
  if (map === undefined) return;
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    fail(`${field} must be an object of hex colour strings.`);
  }
  for (const key of Object.keys(map)) {
    requireHexColour(map[key], `${field}.${key}`);
  }
}

function validateAppearance(appearance: Appearance | undefined): void {
  if (appearance === undefined) return;
  if (
    appearance === null ||
    typeof appearance !== 'object' ||
    Array.isArray(appearance)
  ) {
    fail('appearance must be an object.');
  }

  const { colorMode, cornerRadius } = appearance;
  if (
    colorMode !== undefined &&
    colorMode !== 'system' &&
    colorMode !== 'light' &&
    colorMode !== 'dark'
  ) {
    fail(
      `appearance.colorMode must be "system", "light" or "dark", received ${JSON.stringify(colorMode)}.`
    );
  }

  const colourFields = [
    'primaryColor',
    'backgroundColor',
    'surfaceColor',
    'textColor',
    'secondaryTextColor',
    'errorColor',
  ] as const;
  for (const field of colourFields) {
    const value = appearance[field];
    if (value !== undefined) requireHexColour(value, `appearance.${field}`);
  }

  if (cornerRadius !== undefined) {
    if (
      typeof cornerRadius !== 'number' ||
      !Number.isFinite(cornerRadius) ||
      cornerRadius < 0
    ) {
      fail(
        `appearance.cornerRadius must be a finite, non-negative number, received ${JSON.stringify(cornerRadius)}.`
      );
    }
  }

  validateColourMap(appearance.ios, 'appearance.ios');
  validateColourMap(appearance.android?.light, 'appearance.android.light');
  validateColourMap(appearance.android?.dark, 'appearance.android.dark');
}

/**
 * Validate {@link InitOptions}. The `tokenProvider` is checked for being a
 * function only — it is never called here and its value is never inspected.
 *
 * @internal
 */
export function validateInitOptions(options: InitOptions): void {
  if (typeof options !== 'object' || options === null) {
    fail('init(options) requires an options object.');
  }

  const { environment } = options;
  if (environment !== 'sandbox' && environment !== 'production') {
    fail(
      `environment must be "sandbox" or "production", received ${JSON.stringify(environment)}.`
    );
  }

  const clientId = requireNonBlank(options.clientId, 'clientId');
  if (!CLIENT_ID.test(clientId)) {
    fail(
      'clientId must be your UQPAY client id exactly as issued: printable characters only, with no spaces, tabs or line breaks.'
    );
  }

  if (typeof options.tokenProvider !== 'function') {
    fail(
      'tokenProvider must be a function returning Promise<{ authToken: string }>.'
    );
  }

  if (
    options.debugLogging !== undefined &&
    typeof options.debugLogging !== 'boolean'
  ) {
    fail(
      `debugLogging must be a boolean, received ${JSON.stringify(options.debugLogging)}.`
    );
  }

  validateAppearance(options.appearance);
}

function validateBillingDetails(
  billingDetails: BillingDetails | undefined
): void {
  if (billingDetails === undefined) return;
  if (
    billingDetails === null ||
    typeof billingDetails !== 'object' ||
    Array.isArray(billingDetails)
  ) {
    fail('billingDetails must be an object.');
  }
  for (const key of Object.keys(billingDetails)) {
    const value = (billingDetails as Record<string, unknown>)[key];
    if (value !== undefined && typeof value !== 'string') {
      fail(`billingDetails.${key} must be a string when present.`);
    }
  }
}

/**
 * Validate {@link PresentOptions}, including the two iOS limitations that the
 * JS layer has to enforce because the iOS native SDK cannot yet honour them.
 * This is the SDK's only platform-dependent behaviour, and it is
 * documented on the fields themselves.
 *
 * @internal
 */
export function validatePresentOptions(
  options: PresentOptions,
  platform: UqpayPlatform
): void {
  if (typeof options !== 'object' || options === null) {
    fail('presentPaymentSheet(options) requires an options object.');
  }

  const paymentIntentId = requireNonBlank(
    options.paymentIntentId,
    'paymentIntentId'
  );
  if (!PAYMENT_INTENT_ID.test(paymentIntentId)) {
    fail(
      'paymentIntentId must be the id your server received from UQPAY (letters, digits, "_" and "-" only, at most 128 characters).'
    );
  }

  const returnUrl = requireNonBlank(options.returnUrl, 'returnUrl');
  if (INSECURE_URL.test(returnUrl.trim())) {
    fail(
      'returnUrl must not use plain, unencrypted HTTP; use an https URL or a custom scheme such as "myapp://pay/return".'
    );
  }

  const { presentation } = options;
  let singleWallet: string | undefined;
  if (presentation !== undefined) {
    if (typeof presentation === 'object') {
      singleWallet = requireNonBlank(
        presentation.singleWallet,
        'presentation.singleWallet'
      );
      if (singleWallet === 'card') {
        fail(
          'presentation.singleWallet must be a wallet method, not "card"; use presentation: "cardOnly" instead.'
        );
      }
    } else if (presentation !== 'methodList' && presentation !== 'cardOnly') {
      fail(
        `presentation must be "methodList", "cardOnly" or { singleWallet }, received ${JSON.stringify(presentation)}.`
      );
    }
  }

  const { allowedPaymentMethods } = options;
  if (allowedPaymentMethods !== undefined) {
    if (!Array.isArray(allowedPaymentMethods)) {
      fail('allowedPaymentMethods must be an array of payment-method types.');
    }
    if (allowedPaymentMethods.length === 0) {
      fail(
        'allowedPaymentMethods must not be empty: an empty list means no method may be used. Omit the field to allow every method the intent supports.'
      );
    }
    allowedPaymentMethods.forEach((method, index) => {
      requireNonBlank(method, `allowedPaymentMethods[${index}]`);
    });
  }

  validateBillingDetails(options.billingDetails);

  if (options.merchantDisplayName !== undefined) {
    requireNonBlank(options.merchantDisplayName, 'merchantDisplayName');
  }

  if (platform === 'ios') {
    if (singleWallet !== undefined) {
      fail(
        'presentation.singleWallet is not supported by the iOS native SDK yet. ' +
          'Use "methodList" or "cardOnly" on iOS, or branch on the running platform in your app.'
      );
    }
    if (allowedPaymentMethods !== undefined) {
      fail(
        'allowedPaymentMethods is not supported by the iOS native SDK yet: iOS has no ' +
          'client-side allow-list, so the backend must restrict the intent instead.'
      );
    }
    if (options.billingDetails !== undefined) {
      // A prefill is cosmetic, so an ignored one warns instead of rejecting.
      warnOnce(
        'ios-billing-details',
        'billingDetails is ignored on iOS: the iOS native SDK has no billing prefill yet. ' +
          'The payment continues normally.'
      );
    }
  }
}
