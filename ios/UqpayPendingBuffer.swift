//
//  UqpayPendingBuffer.swift
//  uqpay-react-native
//
//  In-memory, exactly-once buffer for a result that arrived while no JS promise
//  was attached — a Metro reload or Fast Refresh mid-sheet (AC RN-CB6, RN-CB1,
//  bridge-contract §4).
//
//  iOS buffers **in memory only**, never on disk: the payload names a payment
//  intent and its outcome, and the app process surviving is the only case iOS
//  has to cover (unlike Android, where the OS result registry replays across
//  process death).
//
//  All access happens on the bridge's serial queue; the type carries no locking
//  of its own and must not be touched from anywhere else.
//

import Foundation

final class UqpayPendingBuffer {

    private var stored: [String: Any]?

    /// The intent id of the buffered result, if any. Diagnostics/tests only.
    var bufferedIntentId: String? {
        stored?["paymentIntentId"] as? String
    }

    var isEmpty: Bool { stored == nil }

    /// Stores a result that had no promise to resolve. A newer result replaces
    /// an older one — the natives deliver at most one result per launch, so this
    /// only happens when a merchant presented twice across a reload.
    func store(_ result: [String: Any]) {
        stored = result
    }

    /// Returns the buffered result and clears it. Exactly-once: a second call
    /// returns `nil` (AC RN-CB6, `getPendingResult()`).
    func take() -> [String: Any]? {
        defer { stored = nil }
        return stored
    }

    /// Returns and clears the buffered result **only** when it belongs to
    /// `paymentIntentId`. Used by `presentPaymentSheet` to re-attach instead of
    /// presenting a second sheet for an intent that already settled.
    func take(forIntentId paymentIntentId: String) -> [String: Any]? {
        guard let stored, stored["paymentIntentId"] as? String == paymentIntentId else {
            return nil
        }
        self.stored = nil
        return stored
    }

    func clear() {
        stored = nil
    }
}
