import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeReader } from '../lib/env.mjs';
import { configFromReader } from '../lib/config.mjs';
import {
  TokenManager,
  TokenIssueError,
  expiresAtMs,
  ASSUMED_LIFETIME_MS,
  REFRESH_MARGIN_MS,
} from '../lib/token-manager.mjs';

const NOW = 1_800_000_000_000; // 2027-01-15T08:00:00Z, arbitrary but fixed

function makeConfig(extra = {}) {
  return configFromReader(
    makeReader({ UQPAY_CLIENT_ID: 'client-abcd', UQPAY_API_KEY: 'key-wxyz', ...extra }, {})
  );
}

/** A fetch stand-in that records calls and can be released on demand. */
function fakeFetch(bodies) {
  const calls = [];
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const impl = async (url, init) => {
    calls.push({ url, init });
    await gate;
    const body = bodies[calls.length - 1] ?? bodies[bodies.length - 1];
    return new Response(JSON.stringify(body.json ?? body), {
      status: body.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { impl, calls, release: () => release() };
}

describe('expiry conversion', () => {
  test('epoch seconds become epoch milliseconds', () => {
    assert.equal(expiresAtMs(1_800_001_800, NOW), 1_800_001_800_000);
  });

  test('a value already in milliseconds is left alone', () => {
    assert.equal(expiresAtMs(1_800_001_800_000, NOW), 1_800_001_800_000);
  });

  test('a numeric string is tolerated', () => {
    assert.equal(expiresAtMs('1800001800', NOW), 1_800_001_800_000);
  });

  test('absent, null or nonsense falls back to a 20-minute assumed lifetime', () => {
    assert.equal(expiresAtMs(undefined, NOW), NOW + ASSUMED_LIFETIME_MS);
    assert.equal(expiresAtMs(null, NOW), NOW + ASSUMED_LIFETIME_MS);
    assert.equal(expiresAtMs('not a number', NOW), NOW + ASSUMED_LIFETIME_MS);
    assert.equal(expiresAtMs(-5, NOW), NOW + ASSUMED_LIFETIME_MS);
  });
});

describe('TokenManager', () => {
  test('single-flight: two concurrent calls mint exactly one token', async () => {
    const { impl, calls, release } = fakeFetch([
      { auth_token: 'tok-1', expired_at: (NOW + 1_800_000) / 1000 },
    ]);
    const tokens = new TokenManager({ config: makeConfig(), fetchImpl: impl, now: () => NOW });

    const a = tokens.getToken();
    const b = tokens.getToken();
    // Both callers are queued behind the same in-flight request.
    assert.equal(calls.length, 1, 'only one upstream request may be in flight');
    release();
    const [ra, rb] = await Promise.all([a, b]);

    assert.equal(tokens.issueCount, 1, 'exactly one mint');
    assert.equal(calls.length, 1);
    assert.equal(ra.value, 'tok-1');
    assert.equal(rb.value, 'tok-1');
    assert.equal(ra, rb, 'both callers get the same token object');
  });

  test('sends x-client-id and x-api-key with no body', async () => {
    const { impl, calls, release } = fakeFetch([{ auth_token: 'tok', expired_at: 2_000_000_000 }]);
    const tokens = new TokenManager({ config: makeConfig(), fetchImpl: impl, now: () => NOW });
    release();
    await tokens.getToken();
    const [call] = calls;
    assert.equal(call.url, 'https://api-sandbox.uqpaytech.com/api/v1/connect/token');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['x-client-id'], 'client-abcd');
    assert.equal(call.init.headers['x-api-key'], 'key-wxyz');
    assert.equal(call.init.body, undefined, 'the token endpoint takes no body');
  });

  test('caches until expiry minus 120 s, then re-mints', async () => {
    const expiresAtSeconds = (NOW + 10 * 60_000) / 1000;
    const { impl, calls, release } = fakeFetch([
      { auth_token: 'tok-1', expired_at: expiresAtSeconds },
      { auth_token: 'tok-2', expired_at: expiresAtSeconds + 600 },
    ]);
    let clock = NOW;
    const tokens = new TokenManager({ config: makeConfig(), fetchImpl: impl, now: () => clock });
    release();

    const first = await tokens.getToken();
    assert.equal(first.value, 'tok-1');

    // Still comfortably inside the margin → served from cache.
    clock = first.expiresAt - REFRESH_MARGIN_MS - 1_000;
    assert.equal((await tokens.getToken()).value, 'tok-1');
    assert.equal(tokens.issueCount, 1);
    assert.equal(tokens.hasFreshToken, true);

    // Inside the 120 s margin → a new mint.
    clock = first.expiresAt - REFRESH_MARGIN_MS + 1;
    assert.equal(tokens.hasFreshToken, false);
    assert.equal((await tokens.getToken()).value, 'tok-2');
    assert.equal(tokens.issueCount, 2);
    assert.equal(calls.length, 2);
  });

  test('force=1 re-mints even when the cache is fresh', async () => {
    const { impl, release } = fakeFetch([
      { auth_token: 'tok-1', expired_at: 2_000_000_000 },
      { auth_token: 'tok-2', expired_at: 2_000_000_000 },
    ]);
    const tokens = new TokenManager({ config: makeConfig(), fetchImpl: impl, now: () => NOW });
    release();
    assert.equal((await tokens.getToken()).value, 'tok-1');
    assert.equal((await tokens.getToken()).value, 'tok-1');
    assert.equal((await tokens.getToken({ force: true })).value, 'tok-2');
    assert.equal(tokens.issueCount, 2);
  });

  test('a non-200 becomes a TokenIssueError carrying the upstream message', async () => {
    const { impl, release } = fakeFetch([
      { status: 401, json: { code: 'authentication_failed', message: 'bad api key' } },
    ]);
    const tokens = new TokenManager({ config: makeConfig(), fetchImpl: impl, now: () => NOW });
    release();
    await assert.rejects(() => tokens.getToken(), (err) => {
      assert.ok(err instanceof TokenIssueError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.message, 'bad api key');
      return true;
    });
  });

  test('a failed mint does not poison the single-flight slot', async () => {
    let attempt = 0;
    const impl = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('network down');
      return new Response(JSON.stringify({ auth_token: 'tok-ok', expired_at: 2_000_000_000 }), {
        status: 200,
      });
    };
    const tokens = new TokenManager({ config: makeConfig(), fetchImpl: impl, now: () => NOW });
    await assert.rejects(() => tokens.getToken());
    assert.equal((await tokens.getToken()).value, 'tok-ok');
  });

  test('a response without auth_token is rejected', async () => {
    const { impl, release } = fakeFetch([{ expired_at: 2_000_000_000 }]);
    const tokens = new TokenManager({ config: makeConfig(), fetchImpl: impl, now: () => NOW });
    release();
    await assert.rejects(() => tokens.getToken(), /lacked auth_token/);
  });

  test('log lines never contain the token or the api key', async () => {
    const { impl, release } = fakeFetch([
      { auth_token: 'super-secret-token-value', expired_at: 2_000_000_000 },
    ]);
    const lines = [];
    const tokens = new TokenManager({
      config: makeConfig(),
      fetchImpl: impl,
      now: () => NOW,
      log: (l) => lines.push(l),
    });
    release();
    await tokens.getToken();
    const all = lines.join('\n');
    assert.ok(lines.length > 0, 'the manager does log something');
    assert.ok(!all.includes('super-secret-token-value'));
    assert.ok(!all.includes('key-wxyz'));
    assert.ok(all.includes('****'));
  });

  test('missing credentials fail loudly instead of calling UQPAY', async () => {
    let called = false;
    const tokens = new TokenManager({
      config: configFromReader(makeReader({}, {})),
      fetchImpl: async () => {
        called = true;
        return new Response('{}');
      },
      now: () => NOW,
    });
    await assert.rejects(() => tokens.getToken(), /UQPAY_CLIENT_ID/);
    assert.equal(called, false, 'no request is made without credentials');
  });
});
