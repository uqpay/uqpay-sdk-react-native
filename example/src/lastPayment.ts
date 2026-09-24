/**
 * Where the sample app remembers "the payment I last started".
 *
 * This is a **module variable**, deliberately. It survives a re-render and a
 * screen switch, and it is lost on a cold start — which is exactly the failure
 * this file is here to demonstrate:
 *
 *   A real merchant MUST persist `paymentIntentId` durably (MMKV,
 *   AsyncStorage, SQLite, or the merchant's own server against the user's
 *   order) at the moment the intent is created — not when the result arrives.
 *   After a process death or a force-quit mid-3DS, that id is the only handle
 *   left on the payment, and `pending.reconcile()` / `getPendingResult()`
 *   need it (AC RN-CB7).
 *
 * The sample keeps it in memory to stay dependency-free; the README says so.
 */

export type StartedPayment = {
  paymentIntentId: string;
  amount: string;
  currency: string;
  startedAt: string;
};

let lastStarted: StartedPayment | null = null;

export function rememberStartedPayment(payment: StartedPayment): void {
  lastStarted = payment;
}

export function getLastStartedPayment(): StartedPayment | null {
  return lastStarted;
}

export function forgetStartedPayment(): void {
  lastStarted = null;
}
