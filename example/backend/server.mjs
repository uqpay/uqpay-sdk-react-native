#!/usr/bin/env node
/**
 * UQPAY reference merchant backend for the React Native sample app.
 *
 *   node example/backend/server.mjs
 *
 * This is the ONLY place the API key lives (AC RN-SEC3, D7). The app talks to
 * this server; this server talks to UQPAY. If you are reading this because you
 * are about to put `UQPAY_API_KEY` in the app: don't — that ships your
 * merchant credential to every phone that installs it.
 *
 * A missing `example/.env` is not fatal: the server starts, `/health` answers
 * `ok:false` and names the variables to fill.
 */

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadConfig, describeConfig, notReadyMessage } from './lib/config.mjs';
import { TokenManager } from './lib/token-manager.mjs';
import { UqpayClient } from './lib/uqpay-client.mjs';
import { createApp, readBody } from './lib/app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(here, '..', '.env');

function log(line) {
  // eslint-disable-next-line no-console -- this IS the server log
  console.log(`${new Date().toISOString()} ${line}`);
}

export function start({ envFile = ENV_FILE } = {}) {
  const { config, envFileLoaded, envFileReason } = loadConfig(envFile);

  const tokens = new TokenManager({ config, log });
  const uqpay = new UqpayClient({ config, tokens });
  const app = createApp({ config, tokens, uqpay, log });

  const server = createServer(async (req, res) => {
    let body = '';
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'payload_too_large', message: 'request body too large' }));
      return;
    }
    const reply = await app.handle({ method: req.method ?? 'GET', url: req.url ?? '/', body });
    res.writeHead(reply.status, reply.headers);
    res.end(reply.body);
  });

  server.listen(config.port, '0.0.0.0', () => {
    log(`uqpay reference backend listening on http://localhost:${config.port}`);
    log(`  Android emulator: http://10.0.2.2:${config.port}   iOS simulator: http://localhost:${config.port}`);
    log(describeConfig(config));
    if (!envFileLoaded) log(`example/.env ${envFileReason ?? 'not loaded'} — using process environment only`);
    if (!config.ready) {
      log('NOT READY: ' + notReadyMessage(config));
      log('  /health reports ok:false; payment routes answer 503 until this is fixed.');
    }
  });

  const shutdown = () => {
    log('shutting down');
    server.close(() => process.exit(0));
    // Do not wait forever for keep-alive sockets on a dev machine.
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return server;
}

// Only start when run directly, so tests can import `start` without listening.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  start();
}
