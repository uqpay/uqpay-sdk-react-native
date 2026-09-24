/**
 * Tiny `.env` reader for the reference merchant backend.
 *
 * Deliberately dependency-free (no `dotenv`): it parses `KEY=value` lines and
 * nothing else. It NEVER logs, echoes or returns a formatted value — only
 * `mask*()` output may leave this module. Callers that need a real value ask
 * for it by name and pass it straight into a request header.
 *
 * AC: RN-SEC3 (no API key ever reaches the app), KICKOFF §7 (secrets protocol).
 */

import { readFileSync } from 'node:fs';

/**
 * Parses the contents of a `.env` file.
 *
 * Supported: `KEY=value`, `export KEY=value`, `#` comments, blank lines,
 * single/double quoted values, trailing `# comment` on unquoted values.
 * Unsupported on purpose: interpolation, multi-line values.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  if (typeof text !== 'string') return out;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ')
      ? line.slice('export '.length).trim()
      : line;

    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue; // no `=`, or a line starting with `=`

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      // strip an inline comment from an unquoted value
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }

    out[key] = value;
  }
  return out;
}

/**
 * Reads a `.env` file if it exists. A missing or unreadable file is NOT an
 * error — the caller reports "not configured" through `/health` instead of
 * crashing (see `server.mjs`).
 *
 * @param {string} filePath
 * @returns {{ values: Record<string, string>, loaded: boolean, reason?: string }}
 */
export function loadEnvFile(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    const code = /** @type {{ code?: string }} */ (err)?.code;
    return {
      values: {},
      loaded: false,
      reason: code === 'ENOENT' ? 'file not found' : `unreadable (${code ?? 'error'})`,
    };
  }
  return { values: parseEnv(text), loaded: true };
}

/**
 * Merges a parsed `.env` with `process.env`. Real process environment wins, so
 * CI can override without editing the file.
 *
 * @param {Record<string, string>} fileValues
 * @param {Record<string, string | undefined>} [processEnv]
 * @returns {(name: string) => string | undefined}
 */
export function makeReader(fileValues, processEnv = process.env) {
  return (name) => {
    const fromProcess = processEnv[name];
    const raw = fromProcess !== undefined && fromProcess !== '' ? fromProcess : fileValues[name];
    if (raw === undefined) return undefined;
    const trimmed = String(raw).trim();
    return trimmed === '' ? undefined : trimmed;
  };
}

/** Placeholder shown wherever a secret would otherwise appear. */
export const UNSET = '<unset>';

/**
 * Masks keeping the LAST four characters — used in log lines, where the tail is
 * the part a support engineer can correlate against a dashboard.
 *
 * @param {string | undefined | null} value
 * @returns {string}
 */
export function maskTail(value) {
  if (value === undefined || value === null || value === '') return UNSET;
  const s = String(value);
  if (s.length <= 4) return '****';
  return `****${s.slice(-4)}`;
}

/**
 * Masks keeping the FIRST four characters — used for `clientIdMasked` in
 * `/health`, so a developer can eyeball "am I on the right merchant?" without
 * the full id landing in a screenshot.
 *
 * @param {string | undefined | null} value
 * @returns {string}
 */
export function maskHead(value) {
  if (value === undefined || value === null || value === '') return UNSET;
  const s = String(value);
  if (s.length <= 4) return '****';
  return `${s.slice(0, 4)}****`;
}
