/**
 * HTTP surface consumed by the React Native sample app.
 *
 * Routes:
 *   GET  /health                 → { ok, environment, clientIdMasked, tokenCached }
 *   POST /client-token[?force=1] → { authToken, expiresAt, clientId }
 *   POST /payment-intents        → { paymentIntentId, status, amount, currency, raw }
 *   GET  /payment-intents/:id    → same shape
 *   POST /webhooks/uqpay         → { received: true }   (last 50 kept in memory)
 *   GET  /webhooks/recent        → { events: [...] }
 *
 * Logging rule: method, path, status and masked ids only. The API key, the
 * auth token and full request/response bodies NEVER reach a log line.
 */

import { maskHead, maskTail } from './env.mjs';
import { notReadyMessage } from './config.mjs';
import { TokenIssueError } from './token-manager.mjs';
import { buildCreateIntentBody, summariseIntent } from './uqpay-client.mjs';
import { WebhookStore, webhookEventFromPayload, webhookSummary } from './webhook-store.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, accept',
  'access-control-expose-headers': 'x-trace-id',
  'access-control-max-age': '86400',
};

const MAX_BODY_BYTES = 256 * 1024;

/**
 * @typedef {{ status: number, body: string, headers: Record<string, string> }} Reply
 */

/** @returns {Reply} */
function json(status, body, extraHeaders = {}) {
  return {
    status,
    body: JSON.stringify(body),
    headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...extraHeaders },
  };
}

/** @returns {Reply} */
function fail(status, code, message) {
  return json(status, {
    code,
    type: status >= 500 ? 'api_error' : 'invalid_request_error',
    message: message ?? code,
  });
}

/**
 * Builds a framework-free request handler.
 *
 * @param {object} deps
 * @param {import('./config.mjs').BackendConfig} deps.config
 * @param {import('./token-manager.mjs').TokenManager} deps.tokens
 * @param {import('./uqpay-client.mjs').UqpayClient} deps.uqpay
 * @param {WebhookStore} [deps.webhooks]
 * @param {() => number} [deps.now]
 * @param {(line: string) => void} [deps.log]
 * @returns {{ handle: (req: { method: string, url: string, body: string }) => Promise<Reply>, webhooks: WebhookStore }}
 */
export function createApp({
  config,
  tokens,
  uqpay,
  webhooks = new WebhookStore(),
  now = Date.now,
  log = () => {},
}) {
  /** Payment routes refuse to run until credentials exist. */
  function readinessGuard() {
    if (config.ready) return null;
    return fail(503, 'backend_not_configured', notReadyMessage(config));
  }

  /** @returns {Promise<Reply>} */
  async function route(method, pathname, search, body) {
    if (method === 'OPTIONS') return { status: 204, body: '', headers: CORS_HEADERS };

    if (method === 'GET' && pathname === '/health') {
      return json(200, {
        ok: config.ready,
        environment: config.environment,
        clientIdMasked: maskHead(config.clientId),
        tokenCached: tokens.hasFreshToken,
        // Present only when something needs fixing; the app shows it verbatim.
        ...(config.ready ? {} : { message: notReadyMessage(config), problems: config.problems }),
        webhookUrl: config.webhookUrl ?? null,
      });
    }

    if (method === 'POST' && pathname === '/client-token') {
      const blocked = readinessGuard();
      if (blocked) return blocked;
      const force = search.get('force') === '1';
      const token = await tokens.getToken({ force });
      log(`token: served ${maskTail(token.value)} (mints so far: ${tokens.issueCount})`);
      return json(200, {
        authToken: token.value,
        // Epoch MILLISECONDS — what the JS tokenProvider contract expects.
        expiresAt: token.expiresAt,
        clientId: config.clientId,
      });
    }

    if (method === 'POST' && pathname === '/payment-intents') {
      const blocked = readinessGuard();
      if (blocked) return blocked;
      let parsed;
      try {
        parsed = JSON.parse(body === '' ? '{}' : body);
      } catch {
        return fail(400, 'invalid_json', 'request body must be JSON');
      }
      const built = buildCreateIntentBody(parsed);
      if (!built.ok) return fail(400, built.code, built.message);

      const upstream = await uqpay.createPaymentIntent(JSON.stringify(built.body));
      const summary = summariseIntent(upstream.body);
      log(
        `intent: create -> ${upstream.status} id=${summary.paymentIntentId ?? '?'}` +
          (upstream.traceId ? ` trace=${upstream.traceId}` : '')
      );
      return json(
        upstream.status,
        upstream.status >= 400 ? { code: 'upstream_error', message: 'UQPAY rejected the create-intent request', raw: summary.raw } : summary,
        upstream.traceId ? { 'x-trace-id': upstream.traceId } : {}
      );
    }

    const intentMatch = /^\/payment-intents\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && intentMatch) {
      const blocked = readinessGuard();
      if (blocked) return blocked;
      const id = decodeURIComponent(intentMatch[1]);
      const upstream = await uqpay.getPaymentIntent(id);
      const summary = summariseIntent(upstream.body);
      log(
        `intent: get ${id} -> ${upstream.status}` +
          (upstream.traceId ? ` trace=${upstream.traceId}` : '')
      );
      return json(
        upstream.status,
        upstream.status >= 400 ? { code: 'upstream_error', message: 'UQPAY rejected the retrieve request', raw: summary.raw } : summary,
        upstream.traceId ? { 'x-trace-id': upstream.traceId } : {}
      );
    }

    if (method === 'POST' && pathname === '/webhooks/uqpay') {
      let payload;
      try {
        payload = JSON.parse(body === '' ? 'null' : body);
      } catch {
        payload = { _unparsed: true };
      }
      // NOTE: no signature verification at this stage (see webhook-store.mjs).
      const event = webhooks.add(webhookEventFromPayload(payload, now()));
      log(webhookSummary(event));
      return json(200, { received: true });
    }

    if (method === 'GET' && pathname === '/webhooks/recent') {
      return json(200, {
        events: webhooks.recent,
        capacity: webhooks.capacity,
        signatureVerified: false,
      });
    }

    return fail(404, 'not_found', `no route for ${method} ${pathname}`);
  }

  /**
   * @param {{ method: string, url: string, body?: string }} req
   * @returns {Promise<Reply>}
   */
  async function handle(req) {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const body = req.body ?? '';
    try {
      const reply = await route(method, url.pathname, url.searchParams, body);
      log(`${method} ${url.pathname} -> ${reply.status}`);
      return reply;
    } catch (err) {
      if (err instanceof TokenIssueError) {
        log(`token: upstream refused (${err.statusCode})`);
        return fail(
          502,
          'token_issue_failed',
          `UQPAY refused to issue a token (${err.statusCode}): ${err.message}`
        );
      }
      // Never echo request contents; the message here is our own.
      const name = err instanceof Error ? err.name : 'Error';
      log(`error: ${method} ${url.pathname} -> ${name}`);
      return fail(502, 'upstream_error', `${name} while calling UQPAY`);
    }
  }

  return { handle, webhooks };
}

/**
 * Reads a request body with a hard cap, so a stray large POST cannot exhaust
 * memory on a developer machine.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
