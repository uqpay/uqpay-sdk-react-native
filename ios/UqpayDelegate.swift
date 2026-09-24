//
//  UqpayDelegate.swift
//  uqpay-react-native
//
//  The strong `PaymentDelegate` object the SDK's weak `paymentDelegate` points
//  at, plus the outcome state machine that guarantees the JS promise settles
//  exactly once (AC RN-CB1, RN-CB2, RN-CB3, RN-BR2, RN-TEST8).
//
//  ## Ownership (the RN-BR2 / RN-TEST8 rule)
//
//  A `PaymentSheet` is single-use and owns its detached reconciliation task, so
//  releasing it stops the polling. This bridge therefore:
//
//   * releases the session (and with it the `PaymentSheet` and the delegate
//     object) as soon as a **terminal** delegate call arrives — complete, fail
//     or cancel; and
//   * after `paymentDidBecomePending`, keeps both alive until either a later
//     `didComplete`/`didFail` arrives (emitted as `uqpay_paymentReconciled`) or a
//     bounded **75 s** watchdog fires, whichever comes first.
//
//  75 s = the SDK's own detached window (12 polls × 5 s = 60 s,
//  `UqpayPaymentSheet.swift:126-158`) plus one poll interval of slack for a slow
//  final request. Holding it longer would leak; holding it shorter would cut off
//  a reconciliation the SDK was about to deliver.
//

import Foundation
import UIKit
import UqpayPaymentSheet

// MARK: - Outcome state machine

/// Pure state machine over the delegate's outcomes. No SDK types, no UIKit, no
/// dispatch — so it can be unit tested with injected callbacks (the SDK's
/// classes are `final` and must not be subclassed).
final class UqpayOutcomeMachine {

    private(set) var isSettled = false
    private(set) var settledAsPending = false
    private(set) var isReleased = false

    /// Delivers the single `NativePaymentResult` the JS promise resolves with.
    var onSettle: (([String: Any]) -> Void)?
    /// Delivers a late outcome after a `pending` settle (`uqpay_paymentReconciled`).
    var onReconciled: (([String: Any]) -> Void)?
    /// Asks the owner to start the bounded reconciliation watchdog.
    var onArmWatchdog: (() -> Void)?
    /// Asks the owner to drop the `PaymentSheet` and the delegate object.
    var onRelease: (() -> Void)?

    /// `didCompleteWithResult`, `didFailWithError`, `paymentSheetDidCancel`, or a
    /// bridge-produced terminal result (load failure, no presenting VC).
    func terminal(_ result: [String: Any]) {
        if !isSettled {
            isSettled = true
            onSettle?(result)
            release()
            return
        }
        // Settled as `pending` already: this is the SDK's detached
        // reconciliation catching up (AC RN-CB3).
        if settledAsPending, !isReleased {
            settledAsPending = false
            onReconciled?(result)
            release()
        }
    }

    /// `paymentDidBecomePending`. `pending` is final for the promise on both
    /// platforms; a later outcome arrives as an event, not a second settle.
    func pending(_ result: [String: Any]) {
        guard !isSettled else { return }
        isSettled = true
        settledAsPending = true
        onSettle?(result)
        onArmWatchdog?()
    }

    /// The 75 s window closed with the payment still unsettled upstream.
    func watchdogFired() {
        release()
    }

    private func release() {
        guard !isReleased else { return }
        isReleased = true
        onRelease?()
    }
}

// MARK: - Session

/// One payment. Owns the `PaymentSheet` instance, is the SDK's delegate, and
/// funnels every callback onto the bridge's serial queue.
final class UqpaySheetSession: NSObject, PaymentDelegate {

    let paymentIntentId: String
    let machine = UqpayOutcomeMachine()

    /// Strong on purpose: `PaymentSheet.paymentDelegate` is `weak`, and dropping
    /// the sheet cancels its detached reconciliation.
    var sheet: PaymentSheet?
    weak var presentedController: UIViewController?

    /// Set by `cancelPaymentSheet()` so the resulting cancel is attributed to the
    /// merchant rather than the customer (AC RN-FLOW7).
    var merchantCancelled = false

    /// The bridge's proxy for "a confirm has left the device": the SDK only tells
    /// us through `requiresAction`. Used by `cancelPaymentSheet()` to decide
    /// between `canceled` and letting the native report `pending` (RN-UX6).
    private(set) var sawRequiresAction = false

    /// Emits a bridge event. Always called on the bridge queue.
    var emitEvent: ((String, [String: Any]) -> Void)?

    /// The sheet reported `.unknown` for a confirm it had already sent and then
    /// stopped tracking (`UqpayServerTruth.isAbandonedConfirm`, issues.md row
    /// 10). The bridge answers with the server's view instead of settling the
    /// sheet's guess. Called on the bridge queue with the mapped native error
    /// and the payment method type the sheet was confirming; when unset the
    /// error settles as an ordinary failure.
    var onAbandonedConfirm: ((_ nativeError: [String: Any], _ paymentMethodType: String?) -> Void)?

    /// Asked before an ordinary (not abandoned) failure settles the promise.
    /// Returns `true` when the bridge is still asking the server about an
    /// abandoned confirm and has taken the failure over: while that resolution
    /// is open the sheet shows "failed, try again" with Pay re-enabled, so a
    /// failure here may be a refused *second* confirm on an intent that has
    /// already SUCCEEDED. Only the server may decide then (AC RN-FLOW6).
    /// Called on the bridge queue with the mapped native error.
    var onFailureWhileResolving: ((_ nativeError: [String: Any]) -> Bool)?

    private let queue: DispatchQueue

    init(paymentIntentId: String, queue: DispatchQueue) {
        self.paymentIntentId = paymentIntentId
        self.queue = queue
        super.init()
    }

    var isConfirmInFlight: Bool { sawRequiresAction }

    // MARK: PaymentDelegate (all calls arrive on main)

    func paymentSheet(_ paymentSheet: PaymentSheet, didCompleteWithResult result: PaymentResult) {
        // The SDK collapses SUCCEEDED and REQUIRES_CAPTURE into `.succeeded`;
        // bridge-contract §3 says report `SUCCEEDED` from this path.
        let encoded = UqpayResultEncoder.encode(
            result: result, kind: .completed, forcedStatus: "SUCCEEDED"
        )
        queue.async { [weak self] in self?.machine.terminal(encoded) }
    }

    func paymentSheet(_ paymentSheet: PaymentSheet, didFailWithError error: PaymentError) {
        queue.async { [weak self] in
            guard let self else { return }
            let encoded: [String: Any]
            if error.code == .cancelled {
                // The SDK reuses `.cancelled` for a server-side CANCELLED intent.
                // bridge-contract §3: that is a `canceled` result, not a failure.
                let reason: UqpayCancelReason = self.merchantCancelled
                    ? .merchantCancelled : .intentCancelled
                encoded = UqpayResultEncoder.encode(
                    kind: .canceled,
                    paymentIntentId: self.paymentIntentId,
                    status: "CANCELLED",
                    reason: reason
                )
            } else {
                let mapped = UqpayErrorMapper.map(paymentError: error)
                if let onAbandonedConfirm = self.onAbandonedConfirm,
                   UqpayServerTruth.isAbandonedConfirm(
                       rawCode: error.code.rawValue, declineCode: error.declineCode
                   )
                {
                    // The confirm left the device and the sheet gave up on it;
                    // the server, not the sheet, decides (AC RN-FLOW6).
                    self.sawRequiresAction = true
                    onAbandonedConfirm(mapped, error.paymentMethodType)
                    return
                }
                if self.onFailureWhileResolving?(mapped) == true {
                    return
                }
                encoded = UqpayResultEncoder.encode(
                    kind: .failed,
                    paymentIntentId: self.paymentIntentId,
                    error: mapped
                )
            }
            self.machine.terminal(encoded)
        }
    }

    func paymentSheetDidCancel(_ paymentSheet: PaymentSheet) {
        queue.async { [weak self] in
            guard let self else { return }
            let reason: UqpayCancelReason = self.merchantCancelled
                ? .merchantCancelled : .userCancelled
            self.machine.terminal(
                UqpayResultEncoder.encode(
                    kind: .canceled, paymentIntentId: self.paymentIntentId, reason: reason
                )
            )
        }
    }

    func paymentSheet(_ paymentSheet: PaymentSheet, requiresAction action: RequiredAction) {
        let body = UqpaySheetSession.encode(action: action)
        queue.async { [weak self] in
            guard let self else { return }
            self.sawRequiresAction = true
            self.emitEvent?(UqpayEvents.requiresAction, body)
        }
    }

    func paymentSheet(_ paymentSheet: PaymentSheet, paymentDidBecomePending result: PaymentResult) {
        let encoded = UqpayResultEncoder.encodePending(result: result)
        queue.async { [weak self] in self?.machine.pending(encoded) }
    }

    // MARK: Encoding

    /// `RequiredAction` → `NativeRequiresAction`. The URL/QR payload is carried
    /// but **never** logged (AC RN-SEC1); `displayBankDetails` payloads are
    /// dropped entirely because they are account PII.
    static func encode(action: RequiredAction) -> [String: Any] {
        switch action {
        case .authenticate3DS(let url):
            return ["type": "authenticate3DS", "url": url]
        case .scanQRCode(let qrCodeUrl):
            return ["type": "scanQRCode", "url": qrCodeUrl]
        case .displayBankDetails:
            return ["type": "displayBankDetails"]
        case .verifyOTP:
            return ["type": "verifyOTP"]
        case .custom:
            return ["type": "custom"]
        }
    }
}

// MARK: - Bounded guards for the two silent-failure steps

/// `loadViewController` and UIKit's `present(_:animated:completion:)` are the
/// only two steps in a payment that can complete **nothing** — no callback, no
/// delegate call, no error (issues.md rows 4 and 5, AC RN-FLOW1, RN-UX12):
///
///  * UIKit refuses a presentation whose presenter is mid-transition or whose
///    view is not in the window hierarchy. It logs and returns; the completion
///    block is never run.
///  * `loadViewController`'s completion is only as bounded as the SDK's own
///    `URLSession` timeout.
///
/// Each guard is a one-shot timer on the bridge queue that settles the promise
/// if the step never reports. Owned per session and cancelled on release, so a
/// normal payment pays nothing for them.
///
/// Queue-confined: the bridge touches this only on its serial queue.
final class UqpayPresentationGuards {

    /// UIKit either starts the presentation transition immediately or not at
    /// all, so two seconds is generously past "it was refused".
    static let presentSeconds: TimeInterval = 2

    /// Comfortably beyond the SDK's own request timeout, so this only fires when
    /// the SDK genuinely never calls back.
    static let loadSeconds: TimeInterval = 60

    private let scheduler: UqpayTimerScheduler
    private var loadTimer: UqpayCancelableTimer?
    private var presentTimer: UqpayCancelableTimer?

    init(scheduler: UqpayTimerScheduler) {
        self.scheduler = scheduler
    }

    var hasLoadGuard: Bool { loadTimer != nil }
    var hasPresentGuard: Bool { presentTimer != nil }

    func armLoad(_ onExpire: @escaping () -> Void) {
        loadTimer?.cancel()
        loadTimer = scheduler.schedule(after: Self.loadSeconds) { [weak self] in
            self?.loadTimer = nil
            onExpire()
        }
    }

    func cancelLoad() {
        loadTimer?.cancel()
        loadTimer = nil
    }

    func armPresent(_ onExpire: @escaping () -> Void) {
        presentTimer?.cancel()
        presentTimer = scheduler.schedule(after: Self.presentSeconds) { [weak self] in
            self?.presentTimer = nil
            onExpire()
        }
    }

    func cancelPresent() {
        presentTimer?.cancel()
        presentTimer = nil
    }

    func cancelAll() {
        cancelLoad()
        cancelPresent()
    }
}

// MARK: - Ownership registry

/// The only strong references the bridge keeps to a session. Separated out so
/// the leak test (AC RN-TEST8) can drive it directly: after a terminal outcome
/// the registry must hold nothing, and the session and its `PaymentSheet` must
/// deallocate.
///
/// Queue-confined: the bridge touches it only on its serial queue.
final class UqpaySessionRegistry {

    /// The session currently presenting, if any.
    private(set) var active: UqpaySheetSession?

    /// Sessions settled as `pending` whose reconciliation window is still open.
    private var reconciling: [ObjectIdentifier: UqpaySheetSession] = [:]

    /// How many **distinct** sessions the registry is keeping alive. A session
    /// settled as `pending` is both `active` and reconciling until a new present
    /// replaces it, so this deduplicates.
    var retainedCount: Int {
        var identifiers = Set(reconciling.keys)
        if let active { identifiers.insert(ObjectIdentifier(active)) }
        return identifiers.count
    }

    func setActive(_ session: UqpaySheetSession?) {
        active = session
    }

    func retainForReconciliation(_ session: UqpaySheetSession) {
        reconciling[ObjectIdentifier(session)] = session
    }

    func release(_ session: UqpaySheetSession) {
        reconciling.removeValue(forKey: ObjectIdentifier(session))
        if active === session { active = nil }
    }
}
