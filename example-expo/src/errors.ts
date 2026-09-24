/**
 * Turning a thrown value into something a screen can render.
 *
 * `presentPaymentSheet` **resolves** for every expected outcome — a decline, a
 * cancel, a timeout, a pending result, a 4xx (AC RN-API5). It rejects only for
 * programmer error: `not_initialized`, `invalid_configuration`,
 * `unsupported_platform`. So anything caught here is a bug in *this* app's
 * integration, and the dev panel is where it belongs.
 *
 * The split the SDK asks for (AC RN-ERR): `userMessage` goes to the user,
 * `developerMessage` + `code` go to a developer-only panel.
 */

import { BackendError } from './backend';

export type DisplayError = {
  /** Safe to show a customer. */
  userMessage: string;
  /** Developer-only: goes in the dev panel, never in the customer's face. */
  developerMessage: string;
  code: string;
  source: 'sdk' | 'backend' | 'app';
};

function hasStringProp<K extends string>(
  value: unknown,
  key: K
): value is Record<K, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[key] === 'string'
  );
}

/**
 * Narrows an unknown thrown value. A rejection from the SDK is an `Error`
 * subclass carrying the `UqpayError` fields, so the same reader works for both.
 */
export function describeThrown(err: unknown): DisplayError {
  if (err instanceof BackendError) {
    return {
      userMessage: 'We could not reach the store right now. Please try again.',
      developerMessage: err.message,
      code: err.code,
      source: 'backend',
    };
  }

  if (hasStringProp(err, 'code')) {
    const code = err.code;
    const userMessage = hasStringProp(err, 'userMessage')
      ? err.userMessage
      : 'Something went wrong. Please try again.';
    const developerMessage = hasStringProp(err, 'developerMessage')
      ? err.developerMessage
      : err instanceof Error
        ? err.message
        : String(err);
    return { userMessage, developerMessage, code, source: 'sdk' };
  }

  return {
    userMessage: 'Something went wrong. Please try again.',
    developerMessage:
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    code: 'unexpected',
    source: 'app',
  };
}

/** Compact JSON for the dev panel, with a hard size cap. */
export function prettyJson(value: unknown, maxChars = 2_000): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n… (truncated)`
    : text;
}

/**
 * Fire-and-forget for an async handler that already deals with its own
 * failures (every one in this app sets `error` state in a `catch`).
 *
 * The `.catch` here is a backstop against an unhandled rejection warning, not
 * error handling — if it ever runs, a handler forgot its own `try`.
 */
export function fireAndForget(work: Promise<unknown>): void {
  work.catch(() => {
    /* handled by the caller's own try/catch */
  });
}
