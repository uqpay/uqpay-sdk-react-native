//
//  UqpayBridge.swift
//  uqpay-react-native
//
//  The Swift half of the `Uqpay` Turbo Module. `ios/Uqpay.mm` is a thin ObjC++
//  shim that converts the Codegen C++ structs into `NSDictionary` and forwards
//  here; every decision and every piece of state lives in this file
//  (bridge-contract §6, AC RN-BR2/3/4/7).
//
//  Threading contract
//  ------------------
//  * All mutable state is confined to `queue`, one serial queue. Public `@objc`
//    entry points hop onto it immediately and never block the caller.
//  * The UQPAY iOS SDK requires main for `loadViewController` and presentation;
//    those hops are explicit and are the only main-thread work the bridge does
//    (AC RN-BR4).
//  * The token broker's 10 s wait happens on `queue`, never on main
//    (bridge-contract §2).
//
//  Nothing here logs a token, a PAN, an expiry, an ACS URL or a QR payload
//  (AC RN-SEC1, RN-SEC7).
//

import Foundation
import UIKit
import UqpayCore
import UqpayPayments
import UqpayPaymentSheet
import os

// MARK: - Event names

/// The three event names, spelled here and in `src/nativeEvents.ts` only
/// (AC RN-BR8).
enum UqpayEvents {
    static let tokenRequested = "uqpay_tokenRequested"
    static let paymentReconciled = "uqpay_paymentReconciled"
    static let requiresAction = "uqpay_requiresAction"

    static let all = [tokenRequested, paymentReconciled, requiresAction]
}

// MARK: - Logging

/// Bridge-level diagnostics. Only ever used for developer-facing warnings about
/// configuration; never for payment data. Uses `os_log` (not `print`/`NSLog`) so
/// output is subject to the system's privacy rules.
enum UqpayBridgeLog {
    private static let log = OSLog(subsystem: "com.uqpay.reactnative", category: "bridge")

    static func warn(_ message: StaticString) {
        os_log(.default, log: log, "%{public}@", String(describing: message))
    }

    static func warn(_ message: String) {
        os_log(.default, log: log, "%{public}@", message)
    }
}

// MARK: - Bridge

@objc(UqpayBridge)
public final class UqpayBridge: NSObject {

    @objc public static let shared = UqpayBridge()

    /// How long the bridge keeps a `PaymentSheet` alive after a `pending`
    /// settle so the SDK's detached reconciliation (12 × 5 s) can report a late
    /// outcome. See the header of `UqpayDelegate.swift`.
    static let reconciliationWindowSeconds: TimeInterval = 75

    /// Belt-and-braces window after a merchant `cancelPaymentSheet()`: the SDK's
    /// own dismissal path reports the cancel, but the promise must settle even
    /// if a future SDK stops doing so (AC RN-CB1).
    static let merchantCancelFallbackSeconds: TimeInterval = 5

    /// The pod pins `UqpaySDKiOS ~> 1.1.0`. Used only when the resource bundle
    /// cannot be found (e.g. an unusual linkage); keep in step with the podspec.
    static let fallbackNativeSdkVersion = "1.1.0"

    private let queue = DispatchQueue(label: "com.uqpay.reactnative.bridge")
    private lazy var scheduler: UqpayTimerScheduler = UqpayQueueTimerScheduler(queue: queue)
    private lazy var tokenBroker = UqpayTokenBroker(scheduler: scheduler)

    // MARK: State (queue-confined)

    private var isInitialized = false
    private var configId: String?
    private var environment: UqpayEnvironment?
    private var clientId: String?
    private var onBehalfOf: String?
    private var appearance = PaymentSheet.Appearance()

    /// True from the moment a present is accepted until its result has been
    /// delivered — i.e. after the sheet has finished dismissing, so a second
    /// present cannot race the first sheet's dismiss animation.
    private var isPresenting = false
    /// `cancelPaymentSheet()` arrived after the present started but before a
    /// sheet session existed (token fetch, pre-read). Checked right before the
    /// session starts; reset when a present starts and when it finishes, so it
    /// can never reach a later present.
    private var pendingMerchantCancel = false
    private var activeResolver: ((NSDictionary) -> Void)?
    private var lastPreReadError: Error?

    private let registry = UqpaySessionRegistry()
    private let pendingBuffer = UqpayPendingBuffer()
    private var watchdogs: [ObjectIdentifier: UqpayCancelableTimer] = [:]
    /// Load / present guards, one set per live session (issues.md rows 4 and 5).
    private var guards: [ObjectIdentifier: UqpayPresentationGuards] = [:]
    /// Server-side resolution of a confirm the sheet abandoned (issues.md row 10).
    private var truths: [ObjectIdentifier: UqpayServerTruth] = [:]
    /// Seam for tests; the live reader spends the same public GET as the guard.
    lazy var intentReader: UqpayIntentRead = UqpayLiveIntentReader.make(queue: queue)

    private var isListening = false
    private var eventSink: ((NSString, NSDictionary) -> Void)?

    override private init() {
        super.init()
        tokenBroker.emit = { [weak self] requestId, reason in
            guard let self, self.isListening, let sink = self.eventSink else { return false }
            sink(UqpayEvents.tokenRequested as NSString, ["requestId": requestId, "reason": reason])
            return true
        }
    }

    // MARK: - Events plumbing (called by the ObjC++ shim)

    @objc(setEventSink:)
    public func setEventSink(_ sink: ((NSString, NSDictionary) -> Void)?) {
        queue.async { self.eventSink = sink }
    }

    @objc(setListening:)
    public func setListening(_ listening: Bool) {
        queue.async {
            self.isListening = listening
            if listening { self.tokenBroker.listenersDidAttach() }
        }
    }

    /// The RN module is going away (Metro reload, bridge teardown). The sheet
    /// may still be on screen, so the session is left alone — only the JS-facing
    /// plumbing is dropped, which makes the next result land in the buffer
    /// (AC RN-CB6).
    @objc(invalidate)
    public func invalidate() {
        queue.async {
            self.isListening = false
            self.eventSink = nil
            self.activeResolver = nil
            self.tokenBroker.cancelAll(
                developerMessage: "the JavaScript bridge was torn down before the token arrived"
            )
        }
    }

    private func emit(_ name: String, _ body: [String: Any]) {
        guard isListening, let sink = eventSink else { return }
        sink(name as NSString, body as NSDictionary)
    }

    // MARK: - initialize

    @objc(initializeWithConfig:onSuccess:onError:)
    public func initializeBridge(
        _ config: NSDictionary,
        onSuccess: @escaping () -> Void,
        onError: @escaping (String, String) -> Void
    ) {
        let cfg = (config as? [String: Any]) ?? [:]
        queue.async {
            let incomingConfigId = (cfg["configId"] as? String) ?? ""

            // Re-init with the same config is a no-op so a Fast Refresh does not
            // churn native state (AC RN-IDEM1).
            if self.isInitialized, !incomingConfigId.isEmpty, self.configId == incomingConfigId {
                onSuccess()
                return
            }
            if self.isPresenting {
                onError(
                    "invalid_configuration",
                    "`init()` was called with a different configuration while a payment sheet is presented."
                )
                return
            }
            guard let environmentRaw = cfg["environment"] as? String,
                  let environment = UqpayEnvironment(rawValue: environmentRaw)
            else {
                onError("invalid_configuration", "`environment` must be 'sandbox' or 'production'.")
                return
            }
            let clientId = ((cfg["clientId"] as? String) ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !clientId.isEmpty else {
                onError("invalid_configuration", "`clientId` must not be blank.")
                return
            }

            self.environment = environment
            self.clientId = clientId
            // Stored for diagnostics only: `UqpayConfiguration` has no
            // `onBehalfOf` field and the sheet path never sends the header.
            // Documented iOS gap — see `builder-ios.md` open questions.
            self.onBehalfOf = cfg["onBehalfOf"] as? String
            self.appearance = UqpayAppearanceMapper.appearance(from: cfg["appearance"] as? [String: Any])
            self.configId = incomingConfigId
            self.isInitialized = true
            Self.applyDebugLogging((cfg["debugLogging"] as? Bool) ?? false)
            onSuccess()
        }
    }

    /// AC RN-SEC12: the native logger is only ever switched **on** in a DEBUG
    /// build, is forced off in release, and `logHandler` — which receives
    /// unredacted messages — is never touched.
    private static func applyDebugLogging(_ enabled: Bool) {
        #if DEBUG
        UqpayLogger.shared.isEnabled = enabled
        #else
        UqpayLogger.shared.isEnabled = false
        #endif
    }

    // MARK: - presentPaymentSheet

    @objc(presentPaymentSheetWithOptions:onResult:onError:)
    public func presentPaymentSheet(
        _ options: NSDictionary,
        onResult: @escaping (NSDictionary) -> Void,
        onError: @escaping (String, String) -> Void
    ) {
        let opts = (options as? [String: Any]) ?? [:]
        queue.async {
            guard self.isInitialized, self.environment != nil, let clientId = self.clientId else {
                onError("not_initialized", "Call `init()` before `presentPaymentSheet()`.")
                return
            }
            let paymentIntentId = ((opts["paymentIntentId"] as? String) ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !paymentIntentId.isEmpty else {
                onError("invalid_configuration", "`paymentIntentId` must not be blank.")
                return
            }
            let returnUrl = ((opts["returnUrl"] as? String) ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !returnUrl.isEmpty else {
                onError("invalid_configuration", "`returnUrl` must not be blank.")
                return
            }
            guard !returnUrl.lowercased().hasPrefix("http://") else {
                onError("invalid_configuration", "`returnUrl` must not use plain `http://`.")
                return
            }

            let presentationMode = (opts["presentationMode"] as? String) ?? "methodList"

            // iOS parity gaps (RN-DEP7). JS rejects these too; the bridge is
            // defensive and resolves `failed` rather than rejecting, so the
            // merchant sees one result shape on both platforms.
            if presentationMode == "singleWallet" {
                onResult(self.unsupportedOptionResult(
                    paymentIntentId: paymentIntentId,
                    detail: "`presentationMode: 'singleWallet'` is not supported on iOS"
                ))
                return
            }
            if opts["allowedPaymentMethods"] != nil {
                onResult(self.unsupportedOptionResult(
                    paymentIntentId: paymentIntentId,
                    detail: "`allowedPaymentMethods` is not supported on iOS"
                ))
                return
            }
            if opts["billingDetails"] != nil {
                UqpayBridgeLog.warn(
                    "presentPaymentSheet: `billingDetails` prefill is not supported by the iOS native SDK "
                        + "and was ignored."
                )
            }

            guard !self.isPresenting else {
                onResult(UqpayResultEncoder.encode(
                    kind: .failed,
                    paymentIntentId: paymentIntentId,
                    error: UqpayErrorMapper.bridgeError(
                        code: "invalid_configuration",
                        developerMessage: "a payment sheet is already presented"
                    )
                ) as NSDictionary)
                return
            }

            // A result that arrived while no promise was attached is handed back
            // instead of presenting a second sheet (bridge-contract §4).
            if let buffered = self.pendingBuffer.take(forIntentId: paymentIntentId) {
                onResult(buffered as NSDictionary)
                return
            }

            self.isPresenting = true
            self.pendingMerchantCancel = false
            self.activeResolver = onResult
            self.lastPreReadError = nil

            self.tokenBroker.request(reason: "present") { [weak self] result in
                guard let self else { return }
                // The merchant cancelled while the token was being fetched:
                // nothing has reached the server, so do not start at all.
                if self.pendingMerchantCancel {
                    self.finishPresentation(Self.merchantCancelledResult(paymentIntentId: paymentIntentId))
                    return
                }
                switch result {
                case .failure(let failure):
                    self.finishPresentation(UqpayResultEncoder.encode(
                        kind: .failed,
                        paymentIntentId: paymentIntentId,
                        error: UqpayErrorMapper.bridgeError(
                            code: "authentication_failed",
                            developerMessage: failure.developerMessage
                        )
                    ))
                case .success(let token):
                    self.applyConfigurationAndLoad(
                        paymentIntentId: paymentIntentId,
                        returnUrl: returnUrl,
                        presentationMode: presentationMode,
                        merchantDisplayName: opts["merchantDisplayName"] as? String,
                        clientId: clientId,
                        token: token
                    )
                }
            }
        }
    }

    /// Spike S3(d): write the five singleton fields (barrier writes), take one
    /// `queue.sync` read as a fence **and** a guard, then — and only then — hop
    /// to main. Never call the deprecated `configure(clientSecret:environment:)`
    /// and never set `clientSecret` (AC RN-SEC3).
    private func applyConfigurationAndLoad(
        paymentIntentId: String,
        returnUrl: String,
        presentationMode: String,
        merchantDisplayName: String?,
        clientId: String,
        token: String
    ) {
        guard let environment = self.environment else {
            finishPresentation(UqpayResultEncoder.encode(
                kind: .failed,
                paymentIntentId: paymentIntentId,
                error: UqpayErrorMapper.bridgeError(
                    code: "not_initialized", developerMessage: "the environment was cleared before presenting"
                )
            ))
            return
        }

        let configuration = UqpayConfiguration.shared
        configuration.environment = environment
        configuration.clientId = clientId
        configuration.headerToken = token
        configuration.paymentIntentId = paymentIntentId
        configuration.appReturnScheme = returnUrl

        // The getters are `queue.sync` on the SDK's concurrent queue, so this
        // read cannot return before the barrier writes above have landed.
        guard configuration.headerToken == token,
              configuration.paymentIntentId == paymentIntentId,
              configuration.clientId == clientId,
              configuration.environment != nil
        else {
            finishPresentation(UqpayResultEncoder.encode(
                kind: .failed,
                paymentIntentId: paymentIntentId,
                error: UqpayErrorMapper.bridgeError(
                    code: "invalid_configuration",
                    developerMessage: "the native configuration could not be applied before presenting"
                )
            ))
            return
        }

        preReadIntentThenPresent(
            paymentIntentId: paymentIntentId,
            presentationMode: presentationMode,
            merchantDisplayName: merchantDisplayName
        )
    }

    /// RN-FLOW2 terminal guard.
    ///
    /// `loadViewController` refuses only `SUCCEEDED` / `FAILED` / `CANCELLED`
    /// (`UqpayPaymentIntentModels.swift:49-54`); `REQUIRES_CAPTURE` is **not**
    /// terminal on iOS, so it would present a working payment form. The bridge
    /// therefore spends one public GET first (lead's go/no-go decision on S2-4).
    ///
    /// `getPaymentIntentById` is used rather than the sheet module's
    /// `getPaymentMethods()` because it returns `intentStatus` as a raw string —
    /// `REQUIRES_CAPTURE` included — whereas `getPaymentMethods()` only throws
    /// `.intentNotPayable` for the three statuses the SDK calls terminal, which
    /// is exactly the case this guard exists to widen.
    ///
    /// A network failure here **fails open**: the sheet is presented anyway and
    /// the SDK's own guard still applies.
    private func preReadIntentThenPresent(
        paymentIntentId: String,
        presentationMode: String,
        merchantDisplayName: String?
    ) {
        Task { [weak self] in
            var caught: Error?
            var terminal: [String: Any]?
            do {
                let client = try ApiClient.forConfiguredEnvironment()
                let intent = try await client.getPaymentIntentById(paymentIntentId)
                terminal = Self.terminalGuardResult(
                    intentStatus: intent.intentStatus, paymentIntentId: paymentIntentId
                )
            } catch {
                caught = error
            }
            // Hop back onto the serial queue through a synchronous method, so no
            // `@Sendable` closure inside this async context captures `self`.
            self?.finishPreRead(
                terminal: terminal,
                caught: caught,
                paymentIntentId: paymentIntentId,
                presentationMode: presentationMode,
                merchantDisplayName: merchantDisplayName
            )
        }
    }

    private func finishPreRead(
        terminal: [String: Any]?,
        caught: Error?,
        paymentIntentId: String,
        presentationMode: String,
        merchantDisplayName: String?
    ) {
        queue.async {
            self.lastPreReadError = caught
            // A server answer beats a merchant cancel: an intent that has
            // already SUCCEEDED must be reported as such.
            if let terminal {
                self.finishPresentation(terminal)
                return
            }
            // The merchant cancelled during the token fetch or this read:
            // settle now so the sheet never appears (audit-3 item 4).
            if self.pendingMerchantCancel {
                self.finishPresentation(Self.merchantCancelledResult(paymentIntentId: paymentIntentId))
                return
            }
            self.startSession(
                paymentIntentId: paymentIntentId,
                presentationMode: presentationMode,
                merchantDisplayName: merchantDisplayName
            )
        }
    }

    /// Maps an API `intent_status` to the RN-FLOW2 result, or `nil` when the
    /// intent is payable and the sheet should be presented.
    static func terminalGuardResult(
        intentStatus: String,
        paymentIntentId: String
    ) -> [String: Any]? {
        switch intentStatus.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
        case "SUCCEEDED":
            return UqpayResultEncoder.encode(
                kind: .completed, paymentIntentId: paymentIntentId, status: "SUCCEEDED"
            )
        case "REQUIRES_CAPTURE":
            return UqpayResultEncoder.encode(
                kind: .completed, paymentIntentId: paymentIntentId, status: "REQUIRES_CAPTURE"
            )
        case "FAILED":
            // No `status`: the shared RN-TEST3 fixture
            // (`ios/Tests/Fixtures/scenarios.json`, `terminal_failed`) carries the
            // reason in `error.code` only, and Android does the same.
            return UqpayResultEncoder.encode(
                kind: .failed,
                paymentIntentId: paymentIntentId,
                error: UqpayErrorMapper.bridgeError(
                    code: "intent_not_payable",
                    developerMessage: "the payment intent has already failed and cannot be paid"
                )
            )
        case "CANCELLED", "CANCELED":
            return UqpayResultEncoder.encode(
                kind: .canceled,
                paymentIntentId: paymentIntentId,
                reason: .intentCancelled
            )
        default:
            return nil
        }
    }

    // MARK: - Session

    private func startSession(
        paymentIntentId: String,
        presentationMode: String,
        merchantDisplayName: String?
    ) {
        let session = UqpaySheetSession(paymentIntentId: paymentIntentId, queue: queue)
        wire(session)
        registry.setActive(session)

        // RN-FLOW1: bound `loadViewController`. The SDK's own URLSession timeout
        // is the only other guard, and it does not cover a completion that is
        // simply never called (issues.md row 5).
        let sessionGuards = UqpayPresentationGuards(scheduler: scheduler)
        guards[ObjectIdentifier(session)] = sessionGuards
        sessionGuards.armLoad { [weak session] in
            guard let session, !session.machine.isSettled else { return }
            session.machine.terminal(Self.loadTimeoutResult(paymentIntentId: paymentIntentId))
        }

        let appearance = self.appearance
        let environment = self.environment

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let configuration = PaymentSheet.Configuration()
            if let merchantDisplayName, !merchantDisplayName.isEmpty {
                configuration.merchantDisplayName = merchantDisplayName
            }
            configuration.environment = environment

            let sheetType: PaymentSheetType = presentationMode == "cardOnly" ? .cardOnly : .paymentList
            let sheet = PaymentSheet(
                configuration: configuration, appearance: appearance, sheetType: sheetType
            )
            sheet.paymentDelegate = session
            session.sheet = sheet

            sheet.loadViewController { [weak self, weak session] loadResult in
                guard let self, let session else { return }
                switch loadResult {
                case .success(let viewController):
                    guard let presenter = UqpayPresenter.presentingViewController() else {
                        self.queue.async {
                            sessionGuards.cancelAll()
                            session.machine.terminal(UqpayResultEncoder.encode(
                                kind: .failed,
                                paymentIntentId: paymentIntentId,
                                error: UqpayErrorMapper.bridgeError(
                                    code: "invalid_configuration",
                                    developerMessage: "no presenting view controller: the app has no key window, "
                                        + "so the payment sheet cannot be shown"
                                )
                            ))
                        }
                        return
                    }
                    session.presentedController = viewController
                    self.queue.async {
                        sessionGuards.cancelLoad()
                        // Already settled (the 60 s load guard fired first):
                        // presenting now would show a sheet nobody listens to.
                        guard !session.machine.isSettled else { return }
                        // `cancelPaymentSheet()` landed while the sheet was
                        // loading. Nothing was shown and nothing was confirmed,
                        // so settle now instead of flashing the sheet up and
                        // waiting for the 5 s fallback.
                        if session.merchantCancelled {
                            sessionGuards.cancelAll()
                            session.machine.terminal(
                                Self.merchantCancelledResult(paymentIntentId: paymentIntentId)
                            )
                            return
                        }
                        // RN-UX12 / issues.md row 4: UIKit refuses a presentation
                        // from a controller that is mid-transition or out of the
                        // window hierarchy by logging and returning — the
                        // completion below never runs. Settle rather than hang.
                        sessionGuards.armPresent { [weak self, weak session] in
                            guard let self, let session, !session.machine.isSettled else { return }
                            self.failIfPresentationWasRefused(session)
                        }
                        DispatchQueue.main.async {
                            // Re-resolve: the top-most controller may have
                            // changed during the hop.
                            let target = UqpayPresenter.presentingViewController() ?? presenter
                            UqpayPresenter.present(viewController, from: target) {
                                self.queue.async { sessionGuards.cancelPresent() }
                            }
                        }
                    }
                case .failure(let error):
                    self.queue.async {
                        sessionGuards.cancelAll()
                        session.machine.terminal(
                            self.loadFailureResult(error, paymentIntentId: paymentIntentId)
                        )
                    }
                }
            }
        }
    }

    /// The 2 s guard fired. The check itself must run on main (it reads UIKit),
    /// and the settle goes back onto the bridge queue.
    private func failIfPresentationWasRefused(_ session: UqpaySheetSession) {
        let paymentIntentId = session.paymentIntentId
        DispatchQueue.main.async { [weak self, weak session] in
            guard let self, let session else { return }
            let refused = UqpayPresenter.isDetached(session.presentedController)
            self.queue.async {
                guard refused, !session.machine.isSettled else { return }
                session.machine.terminal(
                    Self.presentationRefusedResult(paymentIntentId: paymentIntentId)
                )
            }
        }
    }

    /// UIKit never started the presentation (issues.md row 4).
    static func presentationRefusedResult(paymentIntentId: String) -> [String: Any] {
        UqpayResultEncoder.encode(
            kind: .failed,
            paymentIntentId: paymentIntentId,
            error: UqpayErrorMapper.bridgeError(
                code: "invalid_configuration",
                developerMessage: "the payment sheet could not be presented "
                    + "(the presenting view controller was not in the window hierarchy)"
            )
        )
    }

    /// `loadViewController` never called back (issues.md row 5).
    static func loadTimeoutResult(paymentIntentId: String) -> [String: Any] {
        UqpayResultEncoder.encode(
            kind: .failed,
            paymentIntentId: paymentIntentId,
            error: UqpayErrorMapper.bridgeError(
                code: "network_error",
                developerMessage: "the payment sheet did not load within 60 s"
            )
        )
    }

    /// `PaymentSheetError` → a `NativePaymentResult` (bridge-contract §3).
    private func loadFailureResult(
        _ error: PaymentSheetError,
        paymentIntentId: String
    ) -> [String: Any] {
        switch error {
        case .intentNotPayable(let status):
            if let guarded = Self.terminalGuardResult(
                intentStatus: status.rawValue, paymentIntentId: paymentIntentId
            ) {
                return guarded
            }
            return UqpayResultEncoder.encode(
                kind: .failed,
                paymentIntentId: paymentIntentId,
                status: status.rawValue,
                error: UqpayErrorMapper.bridgeError(
                    code: "intent_not_payable",
                    developerMessage: "the payment intent is not payable (status \(status.rawValue))"
                )
            )
        case .failed(let message):
            return UqpayResultEncoder.encode(
                kind: .failed,
                paymentIntentId: paymentIntentId,
                error: UqpayErrorMapper.mapLoadFailure(
                    underlying: lastPreReadError, message: message
                )
            )
        case .notReady, .authenticationTimedOut:
            return UqpayResultEncoder.encode(
                kind: .pending,
                paymentIntentId: paymentIntentId,
                error: UqpayErrorMapper.bridgeError(
                    code: "timeout",
                    developerMessage: "the payment sheet did not become ready in time",
                    isOutcomeUnknown: true
                )
            )
        case .canceled:
            return UqpayResultEncoder.encode(
                kind: .canceled, paymentIntentId: paymentIntentId, reason: .userCancelled
            )
        @unknown default:
            return UqpayResultEncoder.encode(
                kind: .failed,
                paymentIntentId: paymentIntentId,
                error: UqpayErrorMapper.bridgeError(
                    code: "unknown", developerMessage: "the payment sheet failed to load"
                )
            )
        }
    }

    private func wire(_ session: UqpaySheetSession) {
        session.emitEvent = { [weak self] name, body in
            self?.emit(name, body)
        }
        session.machine.onSettle = { [weak self, weak session] result in
            guard let self else { return }
            // AC RN-CB2: the promise settles only after the sheet has finished
            // dismissing, so the merchant may navigate inside `.then`. The
            // dismiss wait is bounded (`UqpayPresenter.dismiss`), and
            // `isPresenting` stays set until then so a new present cannot race
            // this sheet's dismiss animation.
            DispatchQueue.main.async {
                UqpayPresenter.dismiss(session?.presentedController) {
                    self.queue.async { self.finishPresentation(result) }
                }
            }
        }
        session.machine.onReconciled = { [weak self] result in
            // AC RN-CB3: a late outcome after `pending` is an event, never a
            // second settle of the promise.
            self?.emit(UqpayEvents.paymentReconciled, result)
        }
        session.onAbandonedConfirm = { [weak self, weak session] nativeError, paymentMethodType in
            guard let self, let session, !session.machine.isSettled else { return }
            let key = ObjectIdentifier(session)
            guard self.truths[key] == nil else { return }
            let truth = UqpayServerTruth(
                paymentIntentId: session.paymentIntentId,
                nativeError: nativeError,
                paymentMethodType: paymentMethodType,
                machine: session.machine,
                read: self.intentReader,
                scheduler: self.scheduler
            )
            self.truths[key] = truth
            truth.start()
        }
        session.onFailureWhileResolving = { [weak self, weak session] nativeError in
            // Covers both "promise still open" and "settled `pending`, reads
            // continuing under the watchdog": in either case a failure the sheet
            // reports now must not beat the server's answer.
            guard let self, let session, !session.machine.isReleased,
                  let truth = self.truths[ObjectIdentifier(session)]
            else { return false }
            truth.recheck(observedFailure: nativeError)
            return true
        }
        session.machine.onArmWatchdog = { [weak self, weak session] in
            guard let self, let session else { return }
            self.registry.retainForReconciliation(session)
            let key = ObjectIdentifier(session)
            self.watchdogs[key] = self.scheduler.schedule(
                after: Self.reconciliationWindowSeconds
            ) { [weak session] in
                session?.machine.watchdogFired()
            }
        }
        session.machine.onRelease = { [weak self, weak session] in
            // Not `isPresenting`: every release follows a settle whose delivery
            // clears it, and a session released late (after a `pending` settle)
            // must not clear the flag of a newer present that is in progress.
            guard let self, let session else { return }
            self.watchdogs.removeValue(forKey: ObjectIdentifier(session))?.cancel()
            self.guards.removeValue(forKey: ObjectIdentifier(session))?.cancelAll()
            self.truths.removeValue(forKey: ObjectIdentifier(session))?.cancel()
            self.registry.release(session)
            self.clearTokenIfIdle()
            // Dropping the sheet cancels the SDK's detached reconciliation task
            // (`PaymentSheet.deinit`). It is touched only on main.
            DispatchQueue.main.async {
                session.sheet = nil
                session.presentedController = nil
            }
        }
    }

    /// The present is over: clear the in-progress state, hand the result to
    /// JavaScript, and drop the token if nothing else still needs it. Every
    /// present ends here exactly once.
    private func finishPresentation(_ result: [String: Any]) {
        isPresenting = false
        pendingMerchantCancel = false
        clearTokenIfIdle()
        deliver(result)
    }

    /// Security hygiene. The SDK reads the merchant token from
    /// `UqpayConfiguration.shared.headerToken` on every request, so it stays
    /// there after the present unless removed. It is still needed while a
    /// present is running and while a session settled `pending` is reconciling
    /// (the SDK's detached poll and `UqpayServerTruth` both read with it), so
    /// it is cleared only once neither is true. The next present asks JS for a
    /// fresh token anyway.
    private func clearTokenIfIdle() {
        guard !isPresenting, registry.retainedCount == 0 else { return }
        UqpayConfiguration.shared.headerToken = nil
    }

    /// The `canceled` result for a merchant `cancelPaymentSheet()`.
    static func merchantCancelledResult(paymentIntentId: String) -> [String: Any] {
        UqpayResultEncoder.encode(
            kind: .canceled, paymentIntentId: paymentIntentId, reason: .merchantCancelled
        )
    }

    /// Resolves the live promise, or buffers the result when JavaScript is not
    /// listening any more (AC RN-CB1, RN-CB6).
    private func deliver(_ result: [String: Any]) {
        if let resolver = activeResolver {
            activeResolver = nil
            resolver(result as NSDictionary)
        } else {
            pendingBuffer.store(result)
        }
    }

    private func unsupportedOptionResult(paymentIntentId: String, detail: String) -> NSDictionary {
        UqpayResultEncoder.encode(
            kind: .failed,
            paymentIntentId: paymentIntentId,
            error: UqpayErrorMapper.bridgeError(
                code: "invalid_configuration",
                developerMessage: "\(detail); the iOS native SDK has no equivalent yet. "
                    + "Use `presentationMode: 'methodList'` or `'cardOnly'` on iOS."
            )
        ) as NSDictionary
    }

    // MARK: - cancelPaymentSheet

    @objc(cancelPaymentSheetWithCompletion:)
    public func cancelPaymentSheet(onDone: @escaping () -> Void) {
        queue.async {
            guard let session = self.registry.active, !session.machine.isSettled else {
                // No live sheet session. If a present is still fetching its
                // token or pre-reading the intent, remember the cancel: the
                // present settles `canceled` / `merchant_cancelled` right before
                // it would have started the sheet, and the sheet never appears.
                // Resolved now rather than when that present settles, which can
                // take as long as the token budget plus one intent read; the
                // present's own promise carries the outcome.
                if self.isPresenting {
                    self.pendingMerchantCancel = true
                }
                onDone()
                return
            }
            session.merchantCancelled = true
            // A server-truth resolution in progress is a confirm in flight too:
            // it will settle the promise itself (issues.md row 10).
            let confirmInFlight = session.isConfirmInFlight
                || self.truths[ObjectIdentifier(session)] != nil
            DispatchQueue.main.async {
                UqpayPresenter.dismiss(session.presentedController) {
                    self.queue.async {
                        if !confirmInFlight {
                            self.armMerchantCancelFallback(session)
                        }
                        // A confirm already left the device: the native reports
                        // `paymentDidBecomePending`, which becomes `pending`
                        // (AC RN-UX6, RN-FLOW7). Nothing to force here.
                        onDone()
                    }
                }
            }
        }
    }

    private func armMerchantCancelFallback(_ session: UqpaySheetSession) {
        let key = ObjectIdentifier(session)
        guard watchdogs[key] == nil else { return }
        watchdogs[key] = scheduler.schedule(after: Self.merchantCancelFallbackSeconds) {
            [weak self, weak session] in
            guard let self, let session, !session.machine.isSettled else { return }
            self.watchdogs.removeValue(forKey: key)
            session.machine.terminal(Self.merchantCancelledResult(paymentIntentId: session.paymentIntentId))
        }
    }

    // MARK: - notifyReturnedFromBank

    @objc(notifyReturnedFromBank)
    public func notifyReturnedFromBank() {
        // AC RN-BR7. `PaymentCardViewController` observes this on main.
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: PaymentSheet.paymentReturnedFromBank, object: nil)
        }
    }

    // MARK: - getPendingResult

    @objc(getPendingResultWithCompletion:)
    public func getPendingResult(onResult: @escaping (NSDictionary?) -> Void) {
        queue.async {
            onResult(self.pendingBuffer.take() as NSDictionary?)
        }
    }

    // MARK: - Token answers

    /// `expiresAtEpochMs` is accepted for parity with Android but unused in 1.0:
    /// the lead's S3-1 decision rules out any mid-sheet timer refresh, and the
    /// bridge asks for a token before every present regardless.
    @objc(provideTokenWithRequestId:authToken:expiresAtEpochMs:)
    public func provideToken(
        _ requestId: String,
        authToken: String,
        expiresAtEpochMs: Double
    ) {
        queue.async {
            self.tokenBroker.provide(requestId: requestId, authToken: authToken)
        }
    }

    @objc(failTokenWithRequestId:developerMessage:)
    public func failToken(_ requestId: String, developerMessage: String) {
        queue.async {
            self.tokenBroker.fail(requestId: requestId, developerMessage: developerMessage)
        }
    }

    // MARK: - getNativeInfo

    @objc(getNativeInfoWithCompletion:)
    public func getNativeInfo(onResult: @escaping (NSDictionary) -> Void) {
        queue.async {
            onResult([
                "platform": UqpayResultEncoder.platform,
                "nativeSdkVersion": Self.nativeSdkVersion(),
                "isInitialized": self.isInitialized,
                "isPresenting": self.isPresenting,
            ])
        }
    }

    /// Reads `CFBundleShortVersionString` from the SDK's own resource bundle,
    /// which CocoaPods stamps with the pod version (verified: the example app's
    /// `ResourceBundle-UqpayPaymentSheet-…-Info.plist` carries `1.1.0`). Falls
    /// back to the compile-time constant when the bundle cannot be located.
    static func nativeSdkVersion() -> String {
        let candidates = [Bundle(for: PaymentSheet.self), Bundle.main]
        for candidate in candidates {
            guard let url = candidate.url(forResource: "UqpayPaymentSheet", withExtension: "bundle"),
                  let bundle = Bundle(url: url),
                  let version = bundle.infoDictionary?["CFBundleShortVersionString"] as? String,
                  !version.isEmpty
            else { continue }
            return version
        }
        return fallbackNativeSdkVersion
    }
}
