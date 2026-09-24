import { TurboModuleRegistry, type TurboModule } from 'react-native';

/**
 * Codegen spec for the `Uqpay` Turbo Module — the only contract between JavaScript and the
 * Swift / Kotlin bridges.
 *
 * Every field crosses the bridge as its wire type: amounts are decimal strings in major
 * units, statuses and codes keep their casing, dates are ISO-8601 strings, `httpStatus`
 * and `expiresAtEpochMs` are numbers. Nothing card-derived ever appears here.
 *
 * @internal
 */

export type NativeAppearance = {
  colorMode?: string;
  primaryColor?: string;
  backgroundColor?: string;
  surfaceColor?: string;
  textColor?: string;
  secondaryTextColor?: string;
  errorColor?: string;
  cornerRadius?: number;
  iosExtras?: string;
  androidExtras?: string;
};

export type NativeInitConfig = {
  environment: string;
  clientId: string;
  onBehalfOf?: string;
  appearance?: NativeAppearance;
  debugLogging: boolean;
  configId: string;
};

export type NativeBillingDetails = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
};

export type NativePresentOptions = {
  paymentIntentId: string;
  returnUrl: string;
  presentationMode: string;
  singleWalletMethod?: string;
  allowedPaymentMethods?: ReadonlyArray<string>;
  billingDetails?: NativeBillingDetails;
  merchantDisplayName?: string;
};

export type NativeError = {
  code: string;
  developerMessage: string;
  declineCode?: string;
  httpStatus?: number;
  traceId?: string;
  raw?: string;
  isOutcomeUnknown: boolean;
};

export type NativePaymentResult = {
  kind: string;
  paymentIntentId: string;
  status?: string;
  amount?: string;
  currency?: string;
  paymentMethodType?: string;
  transactionId?: string;
  merchantOrderId?: string;
  completedAt?: string;
  reason?: string;
  error?: NativeError;
  platform: string;
  resultId: string;
};

export type NativeRequiresAction = {
  type: string;
  url?: string;
};

export type NativeTokenRequest = {
  requestId: string;
  reason: string;
};

export type NativeInfo = {
  platform: string;
  nativeSdkVersion: string;
  isInitialized: boolean;
  isPresenting: boolean;
};

export interface Spec extends TurboModule {
  initialize(config: NativeInitConfig): Promise<void>;
  presentPaymentSheet(
    options: NativePresentOptions
  ): Promise<NativePaymentResult>;
  cancelPaymentSheet(): Promise<void>;
  notifyReturnedFromBank(): void;
  getPendingResult(): Promise<NativePaymentResult | null>;
  provideToken(
    requestId: string,
    authToken: string,
    expiresAtEpochMs: number
  ): void;
  failToken(requestId: string, developerMessage: string): void;
  getNativeInfo(): Promise<NativeInfo>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

/**
 * The native module, or `null` when this binary does not contain it (Expo Go, web, a build
 * made before the package was installed, or a Jest run without the mock). `get` rather
 * than `getEnforcing`: importing the SDK must never throw — callers go through
 * `requireNative()` in `client.ts`, which explains what is missing.
 */
export default TurboModuleRegistry.get<Spec>('Uqpay');
