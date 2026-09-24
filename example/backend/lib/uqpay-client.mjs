/**
 * Authenticated calls to the UQPAY payment-intent endpoints, made with the
 * server-owned token from `TokenManager`.
 *
 * Ported from the Dart reference backend's `UqpayClient`.
 */

import { randomUUID } from 'node:crypto';

/** Lowercase RFC 4122 v4 UUID — the gateway rejects uppercase keys. */
export function newIdempotencyKey() {
  return randomUUID().toLowerCase();
}

/** The gateway's own limit on `description`, measured against sandbox 2026-09-15. */
export const DESCRIPTION_MAX_LENGTH = 32;

/** `amount` is a decimal string in MAJOR units — never cents, never a number. */
export const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

export class UqpayClient {
  /**
   * @param {object} opts
   * @param {import('./config.mjs').BackendConfig} opts.config
   * @param {import('./token-manager.mjs').TokenManager} opts.tokens
   * @param {typeof fetch} [opts.fetchImpl]
   */
  constructor({ config, tokens, fetchImpl = fetch }) {
    this._config = config;
    this._tokens = tokens;
    this._fetch = fetchImpl;
  }

  /**
   * `POST /api/v2/payment_intents/create`. `body` is already-encoded JSON;
   * this class never touches the amount.
   *
   * @param {string} body
   */
  createPaymentIntent(body) {
    return this._send('POST', '/api/v2/payment_intents/create', {
      body,
      idempotencyKey: newIdempotencyKey(),
    });
  }

  /** `GET /api/v2/payment_intents/{id}`. */
  getPaymentIntent(id) {
    return this._send('GET', `/api/v2/payment_intents/${encodeURIComponent(id)}`);
  }

  /**
   * Sends once; on 401 invalidates the token and retries **exactly once** with
   * the SAME idempotency key and the same bytes.
   *
   * @returns {Promise<{ status: number, body: string, traceId: string | null }>}
   */
  async _send(method, path, { body, idempotencyKey } = {}) {
    let response = await this._once(method, path, body, idempotencyKey);
    if (response.status === 401) {
      this._tokens.invalidate();
      response = await this._once(method, path, body, idempotencyKey);
    }
    const text = await response.text();
    return {
      status: response.status,
      body: text,
      traceId: response.headers?.get?.('x-trace-id') ?? null,
    };
  }

  async _once(method, path, body, idempotencyKey) {
    const token = await this._tokens.getToken();
    /** @type {Record<string, string>} */
    const headers = {
      // Custom header WITH the Bearer prefix — not `Authorization`.
      'x-auth-token': `Bearer ${token.value}`,
      'x-client-id': this._config.clientId ?? '',
      'accept': 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
    if (this._config.onBehalfOf) headers['x-on-behalf-of'] = this._config.onBehalfOf;

    return this._fetch(new URL(path, this._config.apiBaseUrl).toString(), {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
  }
}

/**
 * Validates the app's create-intent request and builds the upstream body.
 *
 * The gateway rejects a too-long `description` with a bare `invalid_parameter`
 * that does not name the offending field, so we catch it here where the error
 * can actually say what is wrong.
 *
 * @param {unknown} input
 * @returns {{ ok: true, body: Record<string, unknown> } | { ok: false, code: string, message: string }}
 */
export function buildCreateIntentBody(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'invalid_json', message: 'request body must be a JSON object' };
  }
  const src = /** @type {Record<string, unknown>} */ (input);

  const amount = src.amount;
  if (typeof amount !== 'string' || !AMOUNT_PATTERN.test(amount)) {
    return {
      ok: false,
      code: 'invalid_amount',
      message:
        'amount must be a decimal string in major units, e.g. "8.98" (never cents, never a JSON number)',
    };
  }

  const currency = src.currency;
  if (typeof currency !== 'string' || currency.length !== 3) {
    return { ok: false, code: 'invalid_currency', message: 'currency must be an ISO 4217 code' };
  }

  const description = src.description;
  if (description !== undefined && description !== null) {
    if (
      typeof description !== 'string' ||
      description.trim() === '' ||
      description.length > DESCRIPTION_MAX_LENGTH
    ) {
      return {
        ok: false,
        code: 'invalid_description',
        message: `description must be a non-empty string of at most ${DESCRIPTION_MAX_LENGTH} characters`,
      };
    }
  }

  const merchantOrderId =
    typeof src.merchantOrderId === 'string' && src.merchantOrderId.trim() !== ''
      ? src.merchantOrderId.trim()
      : typeof src.merchant_order_id === 'string' && src.merchant_order_id.trim() !== ''
        ? src.merchant_order_id.trim()
        : newIdempotencyKey();

  const returnUrl =
    typeof src.returnUrl === 'string' && src.returnUrl !== ''
      ? src.returnUrl
      : typeof src.return_url === 'string' && src.return_url !== ''
        ? src.return_url
        : undefined;

  /** @type {Record<string, unknown>} */
  const body = {
    // Forwarded byte-for-byte: no scaling, no rounding, no reformatting.
    amount,
    currency: currency.toUpperCase(),
    merchant_order_id: merchantOrderId,
    description: typeof description === 'string' ? description : defaultDescription(merchantOrderId),
  };
  if (returnUrl !== undefined) body.return_url = returnUrl;
  if (src.metadata !== undefined && src.metadata !== null) body.metadata = src.metadata;

  return { ok: true, body };
}

/** A stand-in description that always fits inside the 32-character limit. */
export function defaultDescription(merchantOrderId) {
  const prefix = 'Order ';
  const id = String(merchantOrderId);
  const room = DESCRIPTION_MAX_LENGTH - prefix.length;
  return `${prefix}${id.length <= room ? id : id.slice(0, room)}`;
}

/**
 * Projects an upstream intent object onto the small shape the sample app uses.
 * `raw` carries everything else so the app can show the full payload.
 *
 * @param {string} bodyText
 * @returns {{ paymentIntentId: string | null, status: string | null, amount: string | null, currency: string | null, raw: unknown }}
 */
export function summariseIntent(bodyText) {
  let raw;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    return { paymentIntentId: null, status: null, amount: null, currency: null, raw: bodyText };
  }
  const o = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
  return {
    paymentIntentId: str(o.payment_intent_id) ?? str(o.id),
    status: str(o.intent_status) ?? str(o.status),
    amount: str(o.amount),
    currency: str(o.currency),
    raw,
  };
}
