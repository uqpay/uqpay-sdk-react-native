/**
 * Server-side owner of the UQPAY auth token.
 *
 * UQPAY issues **one active token per merchant**: minting a new one silently
 * invalidates the previous one (flutter_analysis §2.1, Appendix C). That is
 * why this file — and nothing else in the merchant's estate — calls
 * `POST /api/v1/connect/token`, and why concurrent callers share one in-flight
 * request instead of racing to mint two tokens.
 *
 * Ported from the Dart reference backend's `TokenManager`.
 */

import { maskTail } from './env.mjs';

/** Refresh this long before expiry (matches the natives' credential margin). */
export const REFRESH_MARGIN_MS = 120_000;

/** Assumed lifetime when the response omits `expired_at`. UQPAY's real life is 30 min. */
export const ASSUMED_LIFETIME_MS = 20 * 60_000;

/** Values above this are already milliseconds; below it they are epoch seconds. */
const EPOCH_SECONDS_CEILING = 1e12;

export class TokenIssueError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   */
  constructor(statusCode, message) {
    super(message);
    this.name = 'TokenIssueError';
    this.statusCode = statusCode;
  }
}

/**
 * Normalises `expired_at` to epoch **milliseconds**.
 *
 * The wire ships epoch *seconds* as a number, but the field is optional and at
 * least one native decoder has been seen to send it as a string. Tolerate all
 * three, and fall back to a deliberately short assumed lifetime.
 *
 * @param {unknown} expiredAt
 * @param {number} nowMs
 * @returns {number} epoch milliseconds
 */
export function expiresAtMs(expiredAt, nowMs) {
  let n;
  if (typeof expiredAt === 'number') n = expiredAt;
  else if (typeof expiredAt === 'string' && expiredAt.trim() !== '') n = Number(expiredAt);
  else return nowMs + ASSUMED_LIFETIME_MS;

  if (!Number.isFinite(n) || n <= 0) return nowMs + ASSUMED_LIFETIME_MS;
  return n < EPOCH_SECONDS_CEILING ? Math.round(n * 1000) : Math.round(n);
}

export class TokenManager {
  /**
   * @param {object} opts
   * @param {import('./config.mjs').BackendConfig} opts.config
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {() => number} [opts.now]
   * @param {(line: string) => void} [opts.log]
   */
  constructor({ config, fetchImpl = fetch, now = Date.now, log = () => {} }) {
    this._config = config;
    this._fetch = fetchImpl;
    this._now = now;
    this._log = log;
    /** @type {{ value: string, expiresAt: number } | null} */
    this._cached = null;
    /** @type {Promise<{ value: string, expiresAt: number }> | null} */
    this._inFlight = null;
    /** Upstream mints so far — asserted by the single-flight test. */
    this.issueCount = 0;
  }

  /** The cached token if it is still fresh, otherwise null. Never fetches. */
  get cached() {
    const t = this._cached;
    if (t && this._now() + REFRESH_MARGIN_MS < t.expiresAt) return t;
    return null;
  }

  /** True when `/health` can honestly say a token is warm. */
  get hasFreshToken() {
    return this.cached !== null;
  }

  /** Drops the cached token; the next `getToken()` mints a new one. */
  invalidate() {
    this._cached = null;
  }

  /**
   * Returns a fresh token, minting one only when needed. Concurrent callers
   * during a mint all await the SAME promise (single-flight) — two parallel
   * `POST /client-token` requests must never invalidate each other's token.
   *
   * @param {{ force?: boolean }} [opts]
   * @returns {Promise<{ value: string, expiresAt: number }>}
   */
  getToken({ force = false } = {}) {
    if (force) this.invalidate();
    else {
      const fresh = this.cached;
      if (fresh) return Promise.resolve(fresh);
    }
    if (this._inFlight) return this._inFlight;

    this._inFlight = this._issue().finally(() => {
      this._inFlight = null;
    });
    return this._inFlight;
  }

  /** @returns {Promise<{ value: string, expiresAt: number }>} */
  async _issue() {
    const { clientId, apiKey, apiBaseUrl } = this._config;
    if (!clientId || !apiKey) {
      throw new TokenIssueError(0, 'UQPAY_CLIENT_ID / UQPAY_API_KEY are not set');
    }

    this.issueCount += 1;
    this._log(`token: minting (client ${maskTail(clientId)}, key ${maskTail(apiKey)})`);

    // flutter_analysis §2.1: POST, headers x-client-id + x-api-key, NO body.
    const response = await this._fetch(new URL('/api/v1/connect/token', apiBaseUrl).toString(), {
      method: 'POST',
      headers: {
        'x-client-id': clientId,
        'x-api-key': apiKey,
        'accept': 'application/json',
      },
    });

    const text = await response.text();
    if (response.status !== 200) {
      throw new TokenIssueError(response.status, errorMessage(text));
    }

    let decoded;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new TokenIssueError(200, 'token response was not JSON');
    }
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new TokenIssueError(200, 'token response was not a JSON object');
    }
    const value = decoded.auth_token;
    if (typeof value !== 'string' || value === '') {
      throw new TokenIssueError(200, 'token response lacked auth_token');
    }

    const token = { value, expiresAt: expiresAtMs(decoded.expired_at, this._now()) };
    this._cached = token;
    // The token itself is masked: a log line is not a place for a credential.
    this._log(
      `token: minted ${maskTail(value)}, expires ${new Date(token.expiresAt).toISOString()}`
    );
    return token;
  }
}

/**
 * Extracts a one-line, non-sensitive reason from an upstream error body.
 *
 * @param {string} body
 * @returns {string}
 */
export function errorMessage(body) {
  try {
    const decoded = JSON.parse(body);
    if (decoded && typeof decoded === 'object') {
      if (typeof decoded.message === 'string' && decoded.message !== '') return decoded.message;
      if (typeof decoded.code === 'string' && decoded.code !== '') return decoded.code;
    }
  } catch {
    // fall through to the truncated raw body
  }
  const oneLine = String(body).replace(/\s+/g, ' ').trim();
  return oneLine.length > 300 ? oneLine.slice(0, 300) : oneLine;
}
