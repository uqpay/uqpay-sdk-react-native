/** Types for `gen-env.mjs` (plain JS so `node` can run it without a build). */

export declare const APP_VARIABLES: readonly [
  'UQPAY_ENVIRONMENT',
  'UQPAY_CLIENT_ID',
  'UQPAY_MERCHANT_BACKEND_URL',
];

export declare function renderEnvModule(values: Record<string, string>): string;

export declare function generate(options?: { envFile?: string; outFile?: string }): {
  out: string;
  loaded: boolean;
  reason?: string;
  picked: Record<string, string>;
};
