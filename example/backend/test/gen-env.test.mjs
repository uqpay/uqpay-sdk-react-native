/**
 * `example/scripts/gen-env.mjs` is the ONLY bridge between `example/.env` and
 * the app bundle. These tests hold the allow-list shut (AC RN-SEC3).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  generate,
  renderEnvModule,
  APP_VARIABLES,
} from '../../scripts/gen-env.mjs';

const API_KEY_VALUE = 'this-would-be-the-merchant-api-key';

function withEnvFile(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'uqpay-genenv-'));
  const envFile = join(dir, '.env');
  const outFile = join(dir, 'src', 'env.generated.ts');
  writeFileSync(envFile, contents);
  return { envFile, outFile };
}

describe('gen-env', () => {
  test('exports exactly three names, in the allow-list', () => {
    assert.deepEqual(
      [...APP_VARIABLES],
      ['UQPAY_ENVIRONMENT', 'UQPAY_CLIENT_ID', 'UQPAY_MERCHANT_BACKEND_URL']
    );
    const source = renderEnvModule({});
    const exported = [...source.matchAll(/^export const (\w+):/gm)].map(
      (m) => m[1]
    );
    assert.deepEqual(exported, [...APP_VARIABLES]);
  });

  test('the API key in .env never reaches the generated file', () => {
    const { envFile, outFile } = withEnvFile(
      [
        'UQPAY_ENVIRONMENT=sandbox',
        'UQPAY_CLIENT_ID=client_1234567890',
        `UQPAY_API_KEY=${API_KEY_VALUE}`,
        'UQPAY_MERCHANT_BACKEND_URL=http://localhost:8787',
        'UQPAY_ON_BEHALF_OF=sub_1',
        'UQPAY_WEBHOOK_URL=https://example.test/hook',
      ].join('\n')
    );
    generate({ envFile, outFile });
    const written = readFileSync(outFile, 'utf8');

    assert.ok(
      !written.includes(API_KEY_VALUE),
      'the key value must not appear'
    );
    assert.ok(
      !written.includes('UQPAY_API_KEY'),
      'the key NAME must not appear either'
    );
    assert.ok(!written.includes('sub_1'), 'UQPAY_ON_BEHALF_OF is backend-only');
    assert.ok(
      !written.includes('example.test/hook'),
      'UQPAY_WEBHOOK_URL is backend-only'
    );

    assert.ok(
      written.includes(
        'export const UQPAY_CLIENT_ID: string = "client_1234567890";'
      )
    );
    assert.ok(
      written.includes('export const UQPAY_ENVIRONMENT: string = "sandbox";')
    );
    assert.ok(
      written.includes(
        'export const UQPAY_MERCHANT_BACKEND_URL: string = "http://localhost:8787";'
      )
    );
  });

  test('a missing .env yields safe defaults instead of a crash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uqpay-genenv-'));
    const result = generate({
      envFile: join(dir, 'nope', '.env'),
      outFile: join(dir, 'src', 'env.generated.ts'),
    });
    assert.equal(result.loaded, false);
    assert.equal(result.picked.UQPAY_ENVIRONMENT, 'sandbox');
    assert.equal(result.picked.UQPAY_CLIENT_ID, '');
    assert.equal(
      result.picked.UQPAY_MERCHANT_BACKEND_URL,
      'http://localhost:8787'
    );
    assert.ok(
      readFileSync(result.out, 'utf8').includes(
        'export const UQPAY_CLIENT_ID: string = "";'
      )
    );
  });

  test('values are JSON-escaped, so a stray quote cannot inject code', () => {
    const source = renderEnvModule({
      UQPAY_CLIENT_ID: 'a";process.exit(1);//',
    });
    assert.ok(
      source.includes(
        'export const UQPAY_CLIENT_ID: string = "a\\";process.exit(1);//";'
      )
    );
  });
});
