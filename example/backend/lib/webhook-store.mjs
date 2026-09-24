/**
 * In-memory ring buffer of recent webhook deliveries (last 50).
 *
 * UQPAY delivers the real payment outcome by webhook, not in the client
 * result (AC RN-CB5). A real merchant persists these and fulfils orders from
 * them; this demo keeps the last few so a developer can watch the 3DS outcome
 * arrive server-side at `GET /webhooks/recent` while the sheet is still open.
 *
 * NOTE: signature verification is NOT implemented at this stage — UQPAY's
 * webhook signing scheme is not yet documented for this SDK. A production
 * merchant MUST verify the signature before trusting a payload. Tracked as an
 * open question in docs/internal/progress/builder-example.md.
 */

export const WEBHOOK_CAPACITY = 50;

/**
 * Best-effort extraction of the interesting fields. The webhook envelope is
 * not specified in the wire contract, so several plausible key names are tried
 * and everything else stays in `payload`.
 *
 * @param {unknown} payload
 * @param {number} receivedAtMs
 */
export function webhookEventFromPayload(payload, receivedAtMs) {
  const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
  const map = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null);

  const root = map(payload) ?? {};
  const data = map(root.data) ?? map(root.object) ?? root;
  const intent = map(data.payment_intent);

  return {
    receivedAt: new Date(receivedAtMs).toISOString(),
    eventType:
      str(root.type) ?? str(root.event_type) ?? str(root.event) ?? str(root.name) ?? null,
    paymentIntentId:
      str(data.payment_intent_id) ??
      (intent ? str(intent.id) : null) ??
      str(data.id) ??
      str(root.payment_intent_id) ??
      null,
    status: str(data.status) ?? str(data.intent_status) ?? str(root.status) ?? null,
    payload,
  };
}

/** One log line with nothing sensitive in it. */
export function webhookSummary(event) {
  return `webhook: type=${event.eventType ?? '?'} intent=${event.paymentIntentId ?? '?'} status=${event.status ?? '?'}`;
}

export class WebhookStore {
  /** @param {number} [capacity] */
  constructor(capacity = WEBHOOK_CAPACITY) {
    this.capacity = capacity;
    /** @type {ReturnType<typeof webhookEventFromPayload>[]} */
    this._events = [];
  }

  add(event) {
    this._events.push(event);
    while (this._events.length > this.capacity) this._events.shift();
    return event;
  }

  /** Newest first. */
  get recent() {
    return this._events.slice().reverse();
  }

  get size() {
    return this._events.length;
  }
}
