//
//  UqpayServerTruth.swift
//  uqpay-react-native
//
//  issues.md row 10. The native iOS sheet gives up on a confirm it cannot drive
//  — `REQUIRES_CUSTOMER_ACTION` with no `next_action`, a `next_action` payload it
//  does not understand, or an intent status outside its switch
//  (`PaymentCardViewController.swift` `handleUnexpectedStatus`, lines 1528-1532,
//  1538-1757 and 1918 at UqpaySDKiOS 1.1.0) — and reports
//  `didFailWithError(code: .unknown, declineCode: <status or marker>)`.
//
//  By then the confirm has already left the device, so that "failure" is a
//  guess. Live (2026-09-22, UnionPay test card) the gateway settled the very same
//  intent `SUCCEEDED` four seconds after the sheet reported failure, and the
//  Android sheet — which polls the intent instead — reported `completed`.
//
//  The same is true of the sheet's `.timeout` and `.networkError` on the card
//  path: both are raised only after the confirm was sent, when the 3DS poll
//  timed out or lost transport (`PaymentCardViewController.swift:1162-1166`,
//  `2981-2985`). Android holds a failed read and keeps polling, ending in
//  `PENDING` + `TIMEOUT`; reporting `failed` on iOS was a live RN-PAR1 gap
//  (tester.md Part 4, cell C run 2).
//
//  AC RN-FLOW6: the result is the **server's** view of the intent. So when the
//  sheet abandons an in-flight confirm the bridge asks the server:
//
//   * up to `preSettleReads` reads, `pollInterval` apart, while the promise is
//     still open. A terminal status settles the promise with the server's answer
//     (`completed` / `failed` / `canceled`) — what Android reports.
//   * still in flight after that → the promise settles `pending`, `status` = the
//     last intent status read, cause = the native's error with
//     `isOutcomeUnknown: true` (bridge-contract §3). Polling continues under the
//     ordinary 75 s reconciliation watchdog and a later terminal status arrives
//     as `uqpay_paymentReconciled` (AC RN-CB3).
//   * a read that throws counts as "still in flight": the outcome is not known,
//     and saying `failed` would be a lie (AC RN-ERR5).
//   * `REQUIRES_PAYMENT_METHOD` with an attempt `failure_code` (e.g.
//     `3ds_failed`) is how the gateway reports a failed attempt, so it settles
//     `failed`; without a failure code it is still unknown.
//   * while this runs, the sheet shows "failed, try again" with Pay enabled. A
//     failure the sheet reports for a second confirm is not an answer about the
//     payment (the first may already have SUCCEEDED): it triggers an immediate
//     re-read (`recheck(observedFailure:)`) and the server's answer wins.
//
//  Pure over an injected reader and the timer scheduler, so it is unit-tested
//  with no network and no SDK. Queue-confined: the bridge drives it only on its
//  serial queue, and the reader must call back on that queue.
//

import Foundation
import UqpayCore
import UqpayPayments

/// The few fields of an intent read the bridge acts on.
struct UqpayIntentSnapshot: Equatable {
    let status: String
    var amount: String? = nil
    var currency: String? = nil
    var paymentMethodType: String? = nil
    var attemptId: String? = nil
    var failureCode: String? = nil
    var merchantOrderId: String? = nil

    init(
        status: String,
        amount: String? = nil,
        currency: String? = nil,
        paymentMethodType: String? = nil,
        attemptId: String? = nil,
        failureCode: String? = nil,
        merchantOrderId: String? = nil
    ) {
        self.status = status
        self.amount = amount
        self.currency = currency
        self.paymentMethodType = paymentMethodType
        self.attemptId = attemptId
        self.failureCode = failureCode
        self.merchantOrderId = merchantOrderId
    }

    /// The intent read carries `payment_method` only inside
    /// `latest_payment_attempt`, which the SDK's `PaymentAttempt` model does not
    /// decode, so `paymentMethodType` is usually nil here; the resolver falls
    /// back to the type the sheet reported with its error.
    init(_ response: PaymentIntentCreateResponse) {
        self.init(
            status: response.intentStatus,
            amount: response.amount,
            currency: response.currency,
            paymentMethodType: response.paymentMethod?.type,
            attemptId: response.latestPaymentAttempt?.attemptId,
            failureCode: response.latestPaymentAttempt?.failureCode,
            merchantOrderId: response.merchantOrderId
        )
    }
}

/// One `GET /api/v2/payment_intents/{id}`. The completion is called on the
/// bridge queue.
typealias UqpayIntentRead = (
    _ paymentIntentId: String,
    _ completion: @escaping (Result<UqpayIntentSnapshot, Error>) -> Void
) -> Void

/// The live reader: the same public `getPaymentIntentById` the RN-FLOW2
/// terminal guard already spends one call on.
enum UqpayLiveIntentReader {
    static func make(queue: DispatchQueue) -> UqpayIntentRead {
        return { paymentIntentId, completion in
            Task {
                let outcome: Result<UqpayIntentSnapshot, Error>
                do {
                    let client = try ApiClient.forConfiguredEnvironment()
                    let intent = try await client.getPaymentIntentById(paymentIntentId)
                    outcome = .success(UqpayIntentSnapshot(intent))
                } catch {
                    outcome = .failure(error)
                }
                queue.async { completion(outcome) }
            }
        }
    }
}

/// Resolves one abandoned confirm against the server. One instance per
/// session; the bridge cancels it when the session is released.
final class UqpayServerTruth {

    /// Seconds between reads — the natives' own poll cadence.
    static let pollInterval: TimeInterval = 2

    /// Reads made while the promise is still open before settling `pending`.
    /// 10 × 2 s ≈ 20 s: live, the gateway needed ~4 s; a 3DS-less UnionPay
    /// confirm on Android needed ~10 s end to end.
    static let preSettleReads = 10

    /// `declineCode` values the sheet attaches to the `.unknown` error it raises
    /// when it abandons a confirm it cannot drive (`handleUnexpectedStatus`).
    /// Intent statuses are those the sheet treats as unexpected after a confirm
    /// (`REQUIRES_CUSTOMER_ACTION` without `next_action`; `PENDING` is handled,
    /// listed defensively); the rest are the sheet's own synthetic markers.
    static let abandonedMarkers: Set<String> = [
        "REQUIRES_CUSTOMER_ACTION",
        "PENDING",
        "MISSING_REDIRECT",
        "INVALID_REDIRECT_URL",
        "MISSING_QR_CODE",
        "MISSING_IFRAME",
        "UNKNOWN_ACTION",
    ]

    /// Delegate-path codes the sheet only raises after a confirm was sent (the
    /// 3DS poll timed out or lost transport), so the outcome is unobserved.
    static let unobservedOutcomeCodes: Set<String> = ["timeout", "network_error"]

    /// True when a delegate failure means "the confirm left the device and the
    /// sheet stopped tracking it", i.e. the outcome is not known on the device.
    static func isAbandonedConfirm(rawCode: String, declineCode: String?) -> Bool {
        if unobservedOutcomeCodes.contains(rawCode) { return true }
        guard rawCode == "unknown", let declineCode else { return false }
        let marker = declineCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return abandonedMarkers.contains(marker)
    }

    // MARK: - Pure result mapping

    /// The server's view as a `NativePaymentResult`, or `nil` while the intent
    /// is still in flight.
    static func terminalResult(
        from snapshot: UqpayIntentSnapshot,
        paymentIntentId: String,
        nativeError: [String: Any],
        paymentMethodType: String? = nil,
        now: Date
    ) -> [String: Any]? {
        let status = snapshot.status.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        switch status {
        case "SUCCEEDED", "REQUIRES_CAPTURE":
            return UqpayResultEncoder.encode(
                kind: .completed,
                paymentIntentId: paymentIntentId,
                status: status,
                amountDecimal: snapshot.amount.flatMap { Decimal(string: $0) },
                currency: snapshot.currency,
                paymentMethodType: snapshot.paymentMethodType ?? paymentMethodType,
                transactionId: snapshot.attemptId,
                merchantOrderId: snapshot.merchantOrderId,
                completedAt: now
            )
        case "FAILED":
            // The sheet's verdict was right after all. Keep its error so the
            // merchant sees the same shape as any other failure, but the
            // outcome is now known and the gateway's own failure code, when it
            // sent one, replaces the sheet's marker.
            return UqpayResultEncoder.encode(
                kind: .failed,
                paymentIntentId: paymentIntentId,
                status: "FAILED",
                error: knownFailureError(nativeError, failureCode: snapshot.failureCode)
            )
        case "REQUIRES_PAYMENT_METHOD":
            // A declined or failed-authentication attempt does not move the
            // intent to FAILED: the intent falls back to REQUIRES_PAYMENT_METHOD
            // with the attempt's `failure_code` set (e.g. `3ds_failed`) so the
            // customer can retry (SDK README "3DS failure", and
            // `awaitThreeDSOutcome`, UqpayPaymentSheet.swift:551-558). With a
            // failure code that is a definite failure. Without one the intent
            // may simply not have taken the confirm yet, so it stays unknown.
            guard let failureCode = snapshot.failureCode?
                .trimmingCharacters(in: .whitespacesAndNewlines), !failureCode.isEmpty
            else { return nil }
            return UqpayResultEncoder.encode(
                kind: .failed,
                paymentIntentId: paymentIntentId,
                status: status,
                error: knownFailureError(nativeError, failureCode: failureCode)
            )
        case "CANCELLED", "CANCELED":
            return UqpayResultEncoder.encode(
                kind: .canceled,
                paymentIntentId: paymentIntentId,
                status: "CANCELLED",
                reason: .intentCancelled
            )
        default:
            return nil
        }
    }

    /// The native error re-stamped as a known outcome. The gateway's failure
    /// code, when it sent one, becomes `declineCode`; when it is one of the
    /// canonical 14 (e.g. `3ds_failed` after a timed-out poll) it is the real
    /// reason and replaces the sheet's `timeout` / `unknown`, which was only its
    /// last observation.
    static func knownFailureError(_ nativeError: [String: Any], failureCode: String?) -> [String: Any] {
        var error = nativeError
        error["isOutcomeUnknown"] = false
        if let failureCode, !failureCode.isEmpty {
            error["declineCode"] = failureCode
            if UqpayCanonicalCode.all.contains(failureCode) {
                error["code"] = failureCode
                error.removeValue(forKey: "raw")
            }
        }
        return error
    }

    /// The `pending` shape used when the pre-settle reads run out: the native's
    /// error is the cause, flagged outcome-unknown, `status` = last known.
    static func pendingResult(
        paymentIntentId: String,
        lastKnownStatus: String?,
        nativeError: [String: Any]
    ) -> [String: Any] {
        var cause = nativeError
        cause["isOutcomeUnknown"] = true
        let observed = (cause["declineCode"] as? String) ?? (cause["code"] as? String) ?? "unknown"
        cause["developerMessage"] = "The native sheet stopped tracking a confirm that had already left "
            + "the device (last observation: \(observed)), and the server still reports the intent "
            + "in flight; the payment may still succeed. Reconcile with your webhook or wait for "
            + "the `paymentReconciled` event from `addPaymentListener`."
        return UqpayResultEncoder.encode(
            kind: .pending,
            paymentIntentId: paymentIntentId,
            status: lastKnownStatus,
            error: cause
        )
    }

    // MARK: - Instance

    private let paymentIntentId: String
    private let nativeError: [String: Any]
    /// The method the sheet was confirming when it gave up (from `PaymentError`).
    private let paymentMethodType: String?
    private let machine: UqpayOutcomeMachine
    private let read: UqpayIntentRead
    private let scheduler: UqpayTimerScheduler
    private let now: () -> Date

    private var readsBeforeSettle = 0
    private var lastKnownStatus: String?
    private var timer: UqpayCancelableTimer?
    private var isCancelled = false
    private(set) var readCount = 0
    /// A read is out and has not called back yet.
    private var isReading = false
    /// `recheck(observedFailure:)` arrived while a read was out: read again as
    /// soon as it lands instead of waiting `pollInterval`.
    private var recheckRequested = false
    /// The newest failure the sheet reported for this payment while the
    /// server was being asked. If the server confirms a failure, this is the
    /// error the merchant sees; it never decides the outcome by itself.
    private var observedFailure: [String: Any]?

    init(
        paymentIntentId: String,
        nativeError: [String: Any],
        paymentMethodType: String? = nil,
        machine: UqpayOutcomeMachine,
        read: @escaping UqpayIntentRead,
        scheduler: UqpayTimerScheduler,
        now: @escaping () -> Date = Date.init
    ) {
        self.paymentIntentId = paymentIntentId
        self.nativeError = nativeError
        self.paymentMethodType = paymentMethodType
        self.machine = machine
        self.read = read
        self.scheduler = scheduler
        self.now = now
    }

    /// Starts with an immediate read; every later read waits `pollInterval`.
    func start() {
        tick()
    }

    /// The sheet reported an ordinary failure while this resolution was still
    /// open — typically the customer tapped Pay again on the sheet's "failed,
    /// try again" screen and the second confirm was refused, possibly because
    /// the first one already SUCCEEDED. That failure is about the second
    /// confirm, not the payment, so it must not settle the promise: the server
    /// is read again now and its answer wins. The failure is kept only as the
    /// error to report if the server confirms a failure.
    func recheck(observedFailure error: [String: Any]) {
        guard !isCancelled, !machine.isReleased else { return }
        observedFailure = error
        if isReading {
            recheckRequested = true
            return
        }
        timer?.cancel()
        timer = nil
        tick()
    }

    /// Stops any further reads. Called by the bridge on session release.
    func cancel() {
        isCancelled = true
        timer?.cancel()
        timer = nil
    }

    private func tick() {
        guard !isCancelled, !machine.isReleased else { return }
        readCount += 1
        isReading = true
        read(paymentIntentId) { [weak self] outcome in
            self?.handle(outcome)
        }
    }

    private func handle(_ outcome: Result<UqpayIntentSnapshot, Error>) {
        isReading = false
        guard !isCancelled, !machine.isReleased else { return }

        if case .success(let snapshot) = outcome {
            lastKnownStatus = snapshot.status
            if let result = Self.terminalResult(
                from: snapshot,
                paymentIntentId: paymentIntentId,
                nativeError: observedFailure ?? nativeError,
                paymentMethodType: paymentMethodType,
                now: now()
            ) {
                // Settles the promise, or — after a `pending` settle — emits
                // `uqpay_paymentReconciled`. Either way the machine releases.
                machine.terminal(result)
                return
            }
        }

        if !machine.isSettled {
            readsBeforeSettle += 1
            if readsBeforeSettle >= Self.preSettleReads {
                machine.pending(Self.pendingResult(
                    paymentIntentId: paymentIntentId,
                    lastKnownStatus: lastKnownStatus,
                    nativeError: nativeError
                ))
                // `pending` armed the 75 s watchdog; keep reading under it.
            }
        }

        if recheckRequested {
            recheckRequested = false
            tick()
            return
        }
        timer = scheduler.schedule(after: Self.pollInterval) { [weak self] in
            self?.timer = nil
            self?.tick()
        }
    }
}
