/**
 * Backend configuration, read from `example/.env` with the exact variable
 * names KICKOFF §7 fixes (and that the Flutter example already uses).
 *
 * Unlike the Dart reference backend, a missing credential does NOT stop the
 * server: it starts anyway, `/health` answers `ok: false` with a message that
 * names the variables to fill, and every payment route answers 503 with the
 * same message. A developer who runs `node example/backend/server.mjs` before
 * pasting credentials gets a useful page, not a stack trace.
 */

import { loadEnvFile, makeReader, maskHead, maskTail } from './env.mjs';

/** Sandbox / production hosts (flutter_analysis §2.1, AC WIRE §1). */
export const BASE_URLS = Object.freeze({
  sandbox: 'https://api-sandbox.uqpaytech.com',
  production: 'https://api.uqpay.com',
});

export const DEFAULT_PORT = 8787;

/**
 * @typedef {object} BackendConfig
 * @property {'sandbox' | 'production'} environment
 * @property {string | undefined} clientId
 * @property {string | undefined} apiKey
 * @property {string} apiBaseUrl
 * @property {number} port
 * @property {string | undefined} onBehalfOf
 * @property {string | undefined} webhookUrl
 * @property {string[]} problems   Human-readable, value-free reasons the server is not ready.
 * @property {boolean} ready       True when the server can talk to UQPAY.
 */

/**
 * Builds the config from a parsed env map. Never throws; never includes a
 * secret value in `problems`.
 *
 * @param {(name: string) => string | undefined} read
 * @returns {BackendConfig}
 */
export function configFromReader(read) {
  /** @type {string[]} */
  const problems = [];

  const rawEnvironment = (read('UQPAY_ENVIRONMENT') ?? 'sandbox').toLowerCase();
  /** @type {'sandbox' | 'production'} */
  let environment = 'sandbox';
  if (rawEnvironment === 'sandbox' || rawEnvironment === 'production') {
    environment = rawEnvironment;
  } else {
    problems.push(
      `UQPAY_ENVIRONMENT must be "sandbox" or "production" (got "${rawEnvironment}"); falling back to sandbox.`
    );
  }

  if (environment === 'production' && read('UQPAY_ALLOW_PRODUCTION') !== '1') {
    problems.push(
      'UQPAY_ENVIRONMENT=production refused: this is a demo server. Set UQPAY_ALLOW_PRODUCTION=1 in example/.env to override (not recommended).'
    );
  }

  const clientId = read('UQPAY_CLIENT_ID');
  const apiKey = read('UQPAY_API_KEY');
  const missing = [];
  if (clientId === undefined) missing.push('UQPAY_CLIENT_ID');
  if (apiKey === undefined) missing.push('UQPAY_API_KEY');
  if (missing.length > 0) {
    problems.push(`set ${missing.join(' and ')} in example/.env (copy example/.env.template)`);
  }

  // The app config URL doubles as the port source: the app and the server must
  // agree, so there is one variable, not two.
  const backendUrl = read('UQPAY_MERCHANT_BACKEND_URL');
  let port = DEFAULT_PORT;
  if (backendUrl !== undefined) {
    try {
      const parsed = new URL(backendUrl);
      if (parsed.port !== '') port = Number(parsed.port);
      else if (parsed.protocol === 'https:') port = 443;
    } catch {
      problems.push(`UQPAY_MERCHANT_BACKEND_URL is not a URL; listening on ${DEFAULT_PORT}.`);
    }
  }
  const portOverride = read('PORT');
  if (portOverride !== undefined) {
    const n = Number(portOverride);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) port = n;
    else problems.push('PORT must be an integer between 1 and 65535; ignored.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) port = DEFAULT_PORT;

  return {
    environment,
    clientId,
    apiKey,
    apiBaseUrl: BASE_URLS[environment],
    port,
    onBehalfOf: read('UQPAY_ON_BEHALF_OF'),
    webhookUrl: read('UQPAY_WEBHOOK_URL'),
    problems,
    ready: problems.length === 0,
  };
}

/**
 * Reads `example/.env` (optional) merged over `process.env`.
 *
 * @param {string} envFilePath
 * @param {Record<string, string | undefined>} [processEnv]
 * @returns {{ config: BackendConfig, envFileLoaded: boolean, envFileReason?: string }}
 */
export function loadConfig(envFilePath, processEnv = process.env) {
  const { values, loaded, reason } = loadEnvFile(envFilePath);
  const config = configFromReader(makeReader(values, processEnv));
  return { config, envFileLoaded: loaded, envFileReason: reason };
}

/**
 * One startup banner with nothing sensitive in it.
 *
 * @param {BackendConfig} config
 * @returns {string}
 */
export function describeConfig(config) {
  return [
    `environment=${config.environment}`,
    `api=${config.apiBaseUrl}`,
    `client=${maskHead(config.clientId)}`,
    `key=${maskTail(config.apiKey)}`,
    `on_behalf_of=${config.onBehalfOf ? maskTail(config.onBehalfOf) : '-'}`,
    `webhook_url=${config.webhookUrl ?? '-'}`,
  ].join(' ');
}

/** The single message the app shows when the backend is not configured. */
export function notReadyMessage(config) {
  return config.problems.join(' · ');
}
