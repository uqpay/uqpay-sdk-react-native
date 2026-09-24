import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseEnv, loadEnvFile, makeReader, maskHead, maskTail, UNSET } from '../lib/env.mjs';
import { configFromReader, BASE_URLS, DEFAULT_PORT } from '../lib/config.mjs';

describe('env loader', () => {
  test('parses KEY=value, comments, quotes and export', () => {
    const values = parseEnv(
      [
        '# a comment',
        '',
        'UQPAY_ENVIRONMENT=sandbox',
        'export UQPAY_CLIENT_ID=abcd1234',
        'UQPAY_API_KEY="quoted value"',
        "UQPAY_ON_BEHALF_OF='single'",
        'UQPAY_MERCHANT_BACKEND_URL=http://localhost:8787 # trailing comment',
        '=nokey',
        '1BAD=x',
        'NOEQUALS',
      ].join('\n')
    );
    assert.equal(values.UQPAY_ENVIRONMENT, 'sandbox');
    assert.equal(values.UQPAY_CLIENT_ID, 'abcd1234');
    assert.equal(values.UQPAY_API_KEY, 'quoted value');
    assert.equal(values.UQPAY_ON_BEHALF_OF, 'single');
    assert.equal(values.UQPAY_MERCHANT_BACKEND_URL, 'http://localhost:8787');
    assert.equal(values['1BAD'], undefined);
    assert.equal(values.NOEQUALS, undefined);
  });

  test('never throws on a missing file and reports why', () => {
    const result = loadEnvFile('/definitely/not/a/real/path/.env');
    assert.equal(result.loaded, false);
    assert.equal(result.reason, 'file not found');
    assert.deepEqual(result.values, {});
  });

  test('never throws on missing optional keys', () => {
    const read = makeReader({});
    assert.equal(read('UQPAY_ON_BEHALF_OF'), undefined);
    assert.equal(read('UQPAY_WEBHOOK_URL'), undefined);
    const config = configFromReader(read);
    assert.equal(config.onBehalfOf, undefined);
    assert.equal(config.webhookUrl, undefined);
    // Only the two required credentials are reported missing.
    assert.equal(config.problems.length, 1);
    assert.match(config.problems[0], /UQPAY_CLIENT_ID and UQPAY_API_KEY/);
  });

  test('process env overrides the file, empty values are treated as unset', () => {
    const read = makeReader({ UQPAY_CLIENT_ID: 'fromfile' }, { UQPAY_CLIENT_ID: 'fromproc' });
    assert.equal(read('UQPAY_CLIENT_ID'), 'fromproc');
    const read2 = makeReader({ UQPAY_CLIENT_ID: 'fromfile' }, { UQPAY_CLIENT_ID: '' });
    assert.equal(read2('UQPAY_CLIENT_ID'), 'fromfile');
  });

  test('masking never reveals the middle of a secret', () => {
    assert.equal(maskTail('abcdefghijkl'), '****ijkl');
    assert.equal(maskHead('abcdefghijkl'), 'abcd****');
    assert.equal(maskTail('abc'), '****');
    assert.equal(maskHead('abc'), '****');
    assert.equal(maskTail(undefined), UNSET);
    assert.equal(maskHead(''), UNSET);
    // The masked forms must not contain the original string.
    const secret = 'sk_live_0123456789';
    assert.ok(!maskTail(secret).includes(secret));
    assert.ok(!maskHead(secret).includes(secret));
  });
});

describe('config', () => {
  test('sandbox is the default and maps to the sandbox host', () => {
    const c = configFromReader(makeReader({ UQPAY_CLIENT_ID: 'c', UQPAY_API_KEY: 'k' }, {}));
    assert.equal(c.environment, 'sandbox');
    assert.equal(c.apiBaseUrl, BASE_URLS.sandbox);
    assert.equal(c.ready, true);
    assert.equal(c.port, DEFAULT_PORT);
  });

  test('production is refused without UQPAY_ALLOW_PRODUCTION=1', () => {
    const base = { UQPAY_ENVIRONMENT: 'production', UQPAY_CLIENT_ID: 'c', UQPAY_API_KEY: 'k' };
    const refused = configFromReader(makeReader(base, {}));
    assert.equal(refused.ready, false);
    assert.match(refused.problems.join(' '), /UQPAY_ALLOW_PRODUCTION=1/);

    const allowed = configFromReader(makeReader({ ...base, UQPAY_ALLOW_PRODUCTION: '1' }, {}));
    assert.equal(allowed.ready, true);
    assert.equal(allowed.apiBaseUrl, BASE_URLS.production);
  });

  test('an unknown environment falls back to sandbox and says so', () => {
    const c = configFromReader(
      makeReader({ UQPAY_ENVIRONMENT: 'staging', UQPAY_CLIENT_ID: 'c', UQPAY_API_KEY: 'k' }, {})
    );
    assert.equal(c.environment, 'sandbox');
    assert.equal(c.ready, false);
    assert.match(c.problems.join(' '), /must be "sandbox" or "production"/);
  });

  test('the port comes from UQPAY_MERCHANT_BACKEND_URL', () => {
    const c = configFromReader(
      makeReader(
        { UQPAY_CLIENT_ID: 'c', UQPAY_API_KEY: 'k', UQPAY_MERCHANT_BACKEND_URL: 'http://localhost:9999' },
        {}
      )
    );
    assert.equal(c.port, 9999);
  });

  test('problems never contain a credential value', () => {
    const secret = 'super-secret-key-value';
    const c = configFromReader(makeReader({ UQPAY_API_KEY: secret, UQPAY_ENVIRONMENT: 'nope' }, {}));
    assert.ok(!JSON.stringify(c.problems).includes(secret));
  });
});
