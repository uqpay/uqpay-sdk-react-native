/**
 * Typed client for the reference merchant backend (`example/backend/`).
 *
 * Every network call the app makes goes through here, and every one of them
 * targets the merchant backend. The app never calls the UQPAY API host and
 * never polls an intent on its own — status comes from the native SDK, or
 * from the merchant's server (AC RN-FLOW4, RN-CB5). A tripwire test fails the
 * build if the UQPAY host ever appears under `example-expo/src`.
 */

import { backendUrl } from './config';

const DEFAULT_TIMEOUT_MS = 15_000;

export class BackendError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.code = code;
  }
}

export type HealthResponse = {
  ok: boolean;
  environment: string;
  clientIdMasked: string;
  tokenCached: boolean;
  message?: string;
  problems?: string[];
  webhookUrl?: string | null;
};

export type ClientTokenResponse = {
  authToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  clientId: string;
};

export type IntentSummary = {
  paymentIntentId: string | null;
  status: string | null;
  amount: string | null;
  currency: string | null;
  raw: unknown;
};

export type WebhookEvent = {
  receivedAt: string;
  eventType: string | null;
  paymentIntentId: string | null;
  status: string | null;
  payload: unknown;
};

export type RecentWebhooks = {
  events: WebhookEvent[];
  capacity: number;
  signatureVerified: boolean;
};

export type CreateIntentRequest = {
  /** Decimal string in MAJOR units, e.g. `"8.98"`. Never cents, never a number. */
  amount: string;
  currency: string;
  description?: string;
  merchantOrderId?: string;
  returnUrl?: string;
  metadata?: Record<string, string>;
};

const TIMED_OUT = Symbol('timed-out');

/**
 * A dev backend that is not running should fail fast rather than hang the UI.
 *
 * `setTimeout` is fine here — this is the sample app, not the SDK (the SDK's
 * own tripwire test bans timers in `src/`; time is native there).
 */
function withTimeout<T>(work: Promise<T>): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof TIMED_OUT>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(TIMED_OUT), DEFAULT_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function request<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' }
): Promise<T> {
  const unreachable = (reason: string) =>
    new BackendError(
      0,
      'backend_unreachable',
      `Merchant backend ${reason} at ${backendUrl}${path}. Is \`node example/backend/server.mjs\` running?`
    );

  let raced: Response | typeof TIMED_OUT;
  try {
    raced = await withTimeout(
      fetch(`${backendUrl}${path}`, {
        method: init.method,
        headers: {
          accept: 'application/json',
          ...(init.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      })
    );
  } catch {
    throw unreachable('unreachable');
  }
  if (raced === TIMED_OUT) throw unreachable('timed out');
  const response = raced;

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    throw new BackendError(
      response.status,
      'invalid_json',
      `Backend returned non-JSON (${response.status}).`
    );
  }

  if (!response.ok) {
    const body = (parsed ?? {}) as { code?: string; message?: string };
    throw new BackendError(
      response.status,
      body.code ?? 'backend_error',
      body.message ?? `Backend returned ${response.status}.`
    );
  }
  return parsed as T;
}

/** `GET /health` — also the "is my `.env` filled in?" check. */
export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

/**
 * `POST /client-token` — what `init({ tokenProvider })` calls.
 *
 * The backend holds the API key and mints the token; the app only ever sees
 * the short-lived token. That is the whole shape of D7 / RN-SEC3.
 */
export function fetchClientToken(): Promise<ClientTokenResponse> {
  return request<ClientTokenResponse>('/client-token', { method: 'POST' });
}

/** `POST /payment-intents` — intent creation is a SERVER job; it needs the API key. */
export function createPaymentIntent(
  body: CreateIntentRequest
): Promise<IntentSummary> {
  return request<IntentSummary>('/payment-intents', { method: 'POST', body });
}

/**
 * `GET /payment-intents/:id` — the server-side truth for an intent.
 *
 * This is the merchant-side check RN-CB5 is about: the client result is a UX
 * signal; this (or the webhook) is what you fulfil an order from.
 */
export function retrievePaymentIntent(id: string): Promise<IntentSummary> {
  return request<IntentSummary>(`/payment-intents/${encodeURIComponent(id)}`);
}

/** `GET /webhooks/recent` — the Webhooks screen polls this every 3 s. */
export function fetchRecentWebhooks(): Promise<RecentWebhooks> {
  return request<RecentWebhooks>('/webhooks/recent');
}
