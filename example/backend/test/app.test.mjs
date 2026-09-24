import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeReader } from '../lib/env.mjs';
import { configFromReader } from '../lib/config.mjs';
import { TokenManager } from '../lib/token-manager.mjs';
import {
  UqpayClient,
  buildCreateIntentBody,
  summariseIntent,
  DESCRIPTION_MAX_LENGTH,
} from '../lib/uqpay-client.mjs';
import { createApp } from '../lib/app.mjs';
import { WebhookStore, webhookEventFromPayload, WEBHOOK_CAPACITY } from '../lib/webhook-store.mjs';

const NOW = 1_800_000_000_000;

const INTENT = {
  payment_intent_id: 'pi_abc123',
  intent_status: 'REQUIRES_PAYMENT_METHOD',
  amount: '8.98',
  currency: 'SGD',
  merchant_order_id: 'order-1',
};

/**
 * Builds an app wired to a scripted upstream.
 * `routes` maps a path suffix to `{ status, json }`.
 */
function makeHarness({ env = { UQPAY_CLIENT_ID: 'client-abcd', UQPAY_API_KEY: 'key-wxyz' }, routes = {} } = {}) {
  const config = configFromReader(makeReader(env, {}));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    if (url.endsWith('/api/v1/connect/token')) {
      return new Response(JSON.stringify({ auth_token: 'tok', expired_at: 2_000_000_000 }), {
        status: 200,
      });
    }
    for (const [suffix, reply] of Object.entries(routes)) {
      if (url.includes(suffix)) {
        return new Response(JSON.stringify(reply.json ?? {}), {
          status: reply.status ?? 200,
          headers: { 'x-trace-id': 'trace-1' },
        });
      }
    }
    return new Response(JSON.stringify(INTENT), { status: 200, headers: { 'x-trace-id': 'trace-1' } });
  };
  const tokens = new TokenManager({ config, fetchImpl, now: () => NOW });
  const uqpay = new UqpayClient({ config, tokens, fetchImpl });
  const logs = [];
  const app = createApp({ config, tokens, uqpay, now: () => NOW, log: (l) => logs.push(l) });
  return { app, calls, logs, config, tokens };
}

const body = (reply) => JSON.parse(reply.body);

describe('GET /health', () => {
  test('reports ok with a masked client id and no token cached yet', async () => {
    const { app } = makeHarness();
    const reply = await app.handle({ method: 'GET', url: '/health' });
    assert.equal(reply.status, 200);
    assert.deepEqual(body(reply), {
      ok: true,
      environment: 'sandbox',
      clientIdMasked: 'clie****',
      tokenCached: false,
      webhookUrl: null,
    });
  });

  test('flips tokenCached once a token has been minted', async () => {
    const { app } = makeHarness();
    await app.handle({ method: 'POST', url: '/client-token' });
    assert.equal(body(await app.handle({ method: 'GET', url: '/health' })).tokenCached, true);
  });

  test('with no credentials: ok:false and a message naming both variables', async () => {
    const { app } = makeHarness({ env: {} });
    const reply = await app.handle({ method: 'GET', url: '/health' });
    assert.equal(reply.status, 200, 'health must answer, not crash');
    const h = body(reply);
    assert.equal(h.ok, false);
    assert.equal(h.clientIdMasked, '<unset>');
    assert.match(h.message, /set UQPAY_CLIENT_ID and UQPAY_API_KEY in example\/\.env/);
  });

  test('payment routes answer 503 while unconfigured', async () => {
    const { app, calls } = makeHarness({ env: {} });
    for (const req of [
      { method: 'POST', url: '/client-token' },
      { method: 'POST', url: '/payment-intents', body: '{"amount":"1.00","currency":"SGD"}' },
      { method: 'GET', url: '/payment-intents/pi_x' },
    ]) {
      const reply = await app.handle(req);
      assert.equal(reply.status, 503, `${req.method} ${req.url}`);
      assert.equal(body(reply).code, 'backend_not_configured');
    }
    assert.equal(calls.length, 0, 'nothing reaches UQPAY without credentials');
  });
});

describe('POST /client-token', () => {
  test('returns authToken, expiresAt in epoch ms and clientId', async () => {
    const { app } = makeHarness();
    const reply = await app.handle({ method: 'POST', url: '/client-token' });
    assert.equal(reply.status, 200);
    const b = body(reply);
    assert.equal(b.authToken, 'tok');
    assert.equal(b.expiresAt, 2_000_000_000_000, 'epoch seconds converted to ms');
    assert.equal(b.clientId, 'client-abcd');
  });

  test('repeated calls reuse one token; ?force=1 mints a new one', async () => {
    const { app, tokens } = makeHarness();
    await app.handle({ method: 'POST', url: '/client-token' });
    await app.handle({ method: 'POST', url: '/client-token' });
    assert.equal(tokens.issueCount, 1, 'one active token per merchant');
    await app.handle({ method: 'POST', url: '/client-token?force=1' });
    assert.equal(tokens.issueCount, 2);
  });

  test('two concurrent requests still mint only one token', async () => {
    const { app, tokens } = makeHarness();
    await Promise.all([
      app.handle({ method: 'POST', url: '/client-token' }),
      app.handle({ method: 'POST', url: '/client-token' }),
    ]);
    assert.equal(tokens.issueCount, 1);
  });

  test('log lines never carry the token value', async () => {
    const { app, logs } = makeHarness();
    await app.handle({ method: 'POST', url: '/client-token' });
    assert.ok(!logs.join('\n').includes('"tok"'));
  });
});

describe('create-intent body building', () => {
  test('accepts a decimal string amount and passes it through unchanged', () => {
    const built = buildCreateIntentBody({ amount: '8.98', currency: 'sgd', description: 'Tee' });
    assert.equal(built.ok, true);
    assert.equal(built.body.amount, '8.98');
    assert.equal(built.body.currency, 'SGD');
    assert.equal(built.body.description, 'Tee');
    assert.equal(typeof built.body.merchant_order_id, 'string');
  });

  test('rejects a numeric amount, cents, and a bad currency', () => {
    assert.equal(buildCreateIntentBody({ amount: 898, currency: 'SGD' }).code, 'invalid_amount');
    assert.equal(buildCreateIntentBody({ amount: '', currency: 'SGD' }).code, 'invalid_amount');
    assert.equal(buildCreateIntentBody({ amount: '8.98', currency: 'SG' }).code, 'invalid_currency');
    assert.equal(buildCreateIntentBody('nope').code, 'invalid_json');
  });

  test(`description is validated at ${DESCRIPTION_MAX_LENGTH} characters`, () => {
    const at = 'x'.repeat(DESCRIPTION_MAX_LENGTH);
    const over = 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1);
    assert.equal(buildCreateIntentBody({ amount: '1.00', currency: 'SGD', description: at }).ok, true);
    const rejected = buildCreateIntentBody({ amount: '1.00', currency: 'SGD', description: over });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'invalid_description');
    assert.match(rejected.message, new RegExp(String(DESCRIPTION_MAX_LENGTH)));
    assert.equal(
      buildCreateIntentBody({ amount: '1.00', currency: 'SGD', description: '   ' }).code,
      'invalid_description'
    );
  });

  test('a missing description is generated and still fits the limit', () => {
    const built = buildCreateIntentBody({
      amount: '1.00',
      currency: 'SGD',
      merchantOrderId: 'a-very-long-merchant-order-identifier-indeed',
    });
    assert.ok(built.body.description.length <= DESCRIPTION_MAX_LENGTH);
  });

  test('returnUrl is forwarded as return_url', () => {
    const built = buildCreateIntentBody({
      amount: '1.00',
      currency: 'SGD',
      returnUrl: 'uqpayexample://return',
    });
    assert.equal(built.body.return_url, 'uqpayexample://return');
  });
});

describe('POST /payment-intents', () => {
  test('summarises the upstream intent and sets the auth headers', async () => {
    const { app, calls } = makeHarness();
    const reply = await app.handle({
      method: 'POST',
      url: '/payment-intents',
      body: JSON.stringify({ amount: '8.98', currency: 'SGD', description: 'Tee' }),
    });
    assert.equal(reply.status, 200);
    const b = body(reply);
    assert.equal(b.paymentIntentId, 'pi_abc123');
    assert.equal(b.status, 'REQUIRES_PAYMENT_METHOD');
    assert.equal(b.amount, '8.98');
    assert.equal(b.currency, 'SGD');
    assert.equal(b.raw.merchant_order_id, 'order-1');
    assert.equal(reply.headers['x-trace-id'], 'trace-1');

    const create = calls.find((c) => c.url.endsWith('/api/v2/payment_intents/create'));
    assert.equal(create.headers['x-auth-token'], 'Bearer tok');
    assert.equal(create.headers['x-client-id'], 'client-abcd');
    assert.match(
      create.headers['x-idempotency-key'],
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    assert.equal(create.headers['x-on-behalf-of'], undefined);
  });

  test('x-on-behalf-of is sent when configured', async () => {
    const { app, calls } = makeHarness({
      env: { UQPAY_CLIENT_ID: 'c', UQPAY_API_KEY: 'k', UQPAY_ON_BEHALF_OF: 'sub_1' },
    });
    await app.handle({
      method: 'POST',
      url: '/payment-intents',
      body: JSON.stringify({ amount: '1.00', currency: 'SGD' }),
    });
    const create = calls.find((c) => c.url.endsWith('/payment_intents/create'));
    assert.equal(create.headers['x-on-behalf-of'], 'sub_1');
  });

  test('a bad request is caught here, not upstream', async () => {
    const { app, calls } = makeHarness();
    const reply = await app.handle({
      method: 'POST',
      url: '/payment-intents',
      body: JSON.stringify({ amount: 898, currency: 'SGD' }),
    });
    assert.equal(reply.status, 400);
    assert.equal(body(reply).code, 'invalid_amount');
    assert.equal(calls.filter((c) => c.url.includes('payment_intents')).length, 0);
  });

  test('a 401 invalidates the token and retries once with the same idempotency key', async () => {
    let attempts = 0;
    const config = configFromReader(makeReader({ UQPAY_CLIENT_ID: 'c', UQPAY_API_KEY: 'k' }, {}));
    const seen = [];
    const fetchImpl = async (url, init = {}) => {
      if (url.endsWith('/connect/token')) {
        return new Response(JSON.stringify({ auth_token: `tok-${attempts}`, expired_at: 2e9 }), {
          status: 200,
        });
      }
      seen.push(init.headers['x-idempotency-key']);
      attempts += 1;
      if (attempts === 1) return new Response('{"message":"expired"}', { status: 401 });
      return new Response(JSON.stringify(INTENT), { status: 200 });
    };
    const tokens = new TokenManager({ config, fetchImpl, now: () => NOW });
    const uqpay = new UqpayClient({ config, tokens, fetchImpl });
    const app = createApp({ config, tokens, uqpay, now: () => NOW });
    const reply = await app.handle({
      method: 'POST',
      url: '/payment-intents',
      body: JSON.stringify({ amount: '1.00', currency: 'SGD' }),
    });
    assert.equal(reply.status, 200);
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1], 'the retry reuses the same idempotency key');
    assert.equal(tokens.issueCount, 2, 'the token was re-minted after the 401');
  });
});

describe('GET /payment-intents/:id', () => {
  test('retrieves by id', async () => {
    const { app, calls } = makeHarness();
    const reply = await app.handle({ method: 'GET', url: '/payment-intents/pi_abc123' });
    assert.equal(reply.status, 200);
    assert.equal(body(reply).paymentIntentId, 'pi_abc123');
    assert.ok(calls.some((c) => c.url.endsWith('/api/v2/payment_intents/pi_abc123')));
  });

  test('an upstream 404 surfaces as an upstream_error, not a crash', async () => {
    const { app } = makeHarness({ routes: { '/payment_intents/pi_missing': { status: 404, json: { message: 'no' } } } });
    const reply = await app.handle({ method: 'GET', url: '/payment-intents/pi_missing' });
    assert.equal(reply.status, 404);
    assert.equal(body(reply).code, 'upstream_error');
  });
});

describe('webhooks', () => {
  test('stores payloads newest-first and caps at 50', () => {
    const store = new WebhookStore();
    for (let i = 0; i < 60; i += 1) {
      store.add(webhookEventFromPayload({ type: 'payment.updated', data: { id: `pi_${i}` } }, NOW + i));
    }
    assert.equal(store.size, WEBHOOK_CAPACITY);
    assert.equal(store.recent[0].paymentIntentId, 'pi_59');
    assert.equal(store.recent.at(-1).paymentIntentId, 'pi_10');
  });

  test('extracts type / intent id / status from several envelope shapes', () => {
    const a = webhookEventFromPayload(
      { type: 'payment_intent.succeeded', data: { payment_intent_id: 'pi_1', status: 'SUCCEEDED' } },
      NOW
    );
    assert.equal(a.eventType, 'payment_intent.succeeded');
    assert.equal(a.paymentIntentId, 'pi_1');
    assert.equal(a.status, 'SUCCEEDED');

    const b = webhookEventFromPayload(
      { event: 'x', object: { payment_intent: { id: 'pi_2' }, intent_status: 'FAILED' } },
      NOW
    );
    assert.equal(b.paymentIntentId, 'pi_2');
    assert.equal(b.status, 'FAILED');

    const c = webhookEventFromPayload('not an object', NOW);
    assert.equal(c.paymentIntentId, null);
    assert.equal(c.payload, 'not an object');
  });

  test('POST /webhooks/uqpay accepts anything and GET /webhooks/recent lists it', async () => {
    const { app } = makeHarness();
    await app.handle({
      method: 'POST',
      url: '/webhooks/uqpay',
      body: JSON.stringify({ type: 'payment_intent.succeeded', data: { payment_intent_id: 'pi_1' } }),
    });
    await app.handle({ method: 'POST', url: '/webhooks/uqpay', body: 'not json at all' });
    const reply = await app.handle({ method: 'GET', url: '/webhooks/recent' });
    assert.equal(reply.status, 200);
    const b = body(reply);
    assert.equal(b.events.length, 2);
    assert.equal(b.events[0].payload._unparsed, true, 'newest first');
    assert.equal(b.events[1].paymentIntentId, 'pi_1');
    assert.equal(b.signatureVerified, false, 'no signature verification at this stage');
  });

  test('webhook routes work even when the backend is unconfigured', async () => {
    const { app } = makeHarness({ env: {} });
    assert.equal((await app.handle({ method: 'POST', url: '/webhooks/uqpay', body: '{}' })).status, 200);
    assert.equal((await app.handle({ method: 'GET', url: '/webhooks/recent' })).status, 200);
  });
});

describe('routing and errors', () => {
  test('an unknown route is a 404 JSON envelope', async () => {
    const { app } = makeHarness();
    const reply = await app.handle({ method: 'GET', url: '/nope' });
    assert.equal(reply.status, 404);
    assert.equal(body(reply).code, 'not_found');
  });

  test('OPTIONS is answered for CORS preflight', async () => {
    const { app } = makeHarness();
    const reply = await app.handle({ method: 'OPTIONS', url: '/payment-intents' });
    assert.equal(reply.status, 204);
    assert.equal(reply.headers['access-control-allow-origin'], '*');
  });

  test('an upstream transport failure becomes a 502, never a throw', async () => {
    const config = configFromReader(makeReader({ UQPAY_CLIENT_ID: 'c', UQPAY_API_KEY: 'k' }, {}));
    const fetchImpl = async (url) => {
      if (url.endsWith('/connect/token')) {
        return new Response(JSON.stringify({ auth_token: 'tok', expired_at: 2e9 }), { status: 200 });
      }
      throw new TypeError('fetch failed');
    };
    const tokens = new TokenManager({ config, fetchImpl, now: () => NOW });
    const uqpay = new UqpayClient({ config, tokens, fetchImpl });
    const app = createApp({ config, tokens, uqpay, now: () => NOW });
    const reply = await app.handle({ method: 'GET', url: '/payment-intents/pi_1' });
    assert.equal(reply.status, 502);
    assert.equal(body(reply).code, 'upstream_error');
  });

  test('a token mint failure becomes a 502 token_issue_failed', async () => {
    const config = configFromReader(makeReader({ UQPAY_CLIENT_ID: 'c', UQPAY_API_KEY: 'k' }, {}));
    const fetchImpl = async () => new Response('{"message":"bad key"}', { status: 403 });
    const tokens = new TokenManager({ config, fetchImpl, now: () => NOW });
    const uqpay = new UqpayClient({ config, tokens, fetchImpl });
    const app = createApp({ config, tokens, uqpay, now: () => NOW });
    const reply = await app.handle({ method: 'POST', url: '/client-token' });
    assert.equal(reply.status, 502);
    assert.equal(body(reply).code, 'token_issue_failed');
    assert.ok(!reply.body.includes('x-api-key'));
  });
});

describe('summariseIntent', () => {
  test('tolerates a non-JSON upstream body', () => {
    const s = summariseIntent('<html>gateway error</html>');
    assert.equal(s.paymentIntentId, null);
    assert.equal(s.raw, '<html>gateway error</html>');
  });
});
