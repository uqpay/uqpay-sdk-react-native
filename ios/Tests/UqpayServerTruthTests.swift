//
//  UqpayServerTruthTests.swift
//  issues.md row 10 · AC RN-FLOW6, RN-ERR5, RN-CB1, RN-CB3, RN-PAR1
//
//  The native sheet abandons a confirm it cannot drive and reports `.unknown`
//  with the intent status as `declineCode`. The bridge must then report the
//  server's view of the intent, never the sheet's guess.
//

import XCTest
import UqpayPaymentSheet

@testable import uqpay_react_native

final class UqpayServerTruthTests: XCTestCase {

    private var machine: UqpayOutcomeMachine!
    private var scheduler: UqpayFakeScheduler!
    private var settles: [[String: Any]] = []
    private var reconciled: [[String: Any]] = []
    private var releases = 0
    private var reads: [String] = []
    private var script: [Result<UqpayIntentSnapshot, Error>] = []

    private let nativeError: [String: Any] = UqpayErrorMapper.nativeError(
        code: "unknown",
        developerMessage: "Unexpected payment status: REQUIRES_CUSTOMER_ACTION. Please try again.",
        declineCode: "REQUIRES_CUSTOMER_ACTION",
        raw: "unknown"
    )

    private struct ReadFailed: Error {}

    override func setUp() {
        super.setUp()
        machine = UqpayOutcomeMachine()
        scheduler = UqpayFakeScheduler()
        settles = []
        reconciled = []
        releases = 0
        reads = []
        script = []
        machine.onSettle = { self.settles.append($0) }
        machine.onReconciled = { self.reconciled.append($0) }
        machine.onRelease = { self.releases += 1 }
    }

    private func makeTruth() -> UqpayServerTruth {
        UqpayServerTruth(
            paymentIntentId: "pi_10",
            nativeError: nativeError,
            machine: machine,
            read: { id, completion in
                self.reads.append(id)
                let next = self.script.isEmpty
                    ? .success(UqpayIntentSnapshot(status: "REQUIRES_CUSTOMER_ACTION"))
                    : self.script.removeFirst()
                completion(next)
            },
            scheduler: scheduler,
            now: { Date(timeIntervalSince1970: 1_700_000_000) }
        )
    }

    private func inFlight(_ n: Int) -> [Result<UqpayIntentSnapshot, Error>] {
        Array(repeating: .success(UqpayIntentSnapshot(status: "REQUIRES_CUSTOMER_ACTION")), count: n)
    }

    // MARK: Detection

    func testOnlyTheSheetsAbandonMarkersOnAnUnknownCodeQualify() {
        for marker in UqpayServerTruth.abandonedMarkers {
            XCTAssertTrue(
                UqpayServerTruth.isAbandonedConfirm(rawCode: "unknown", declineCode: marker), marker
            )
        }
        XCTAssertTrue(
            UqpayServerTruth.isAbandonedConfirm(rawCode: "unknown", declineCode: " requires_customer_action ")
        )
        // A gateway decline the sheet could not classify is a known outcome.
        XCTAssertFalse(UqpayServerTruth.isAbandonedConfirm(rawCode: "unknown", declineCode: "do_not_honor"))
        XCTAssertFalse(UqpayServerTruth.isAbandonedConfirm(rawCode: "unknown", declineCode: nil))
        XCTAssertFalse(UqpayServerTruth.isAbandonedConfirm(rawCode: "unknown", declineCode: ""))
        // Canonical failures never qualify, whatever the decline code says.
        XCTAssertFalse(
            UqpayServerTruth.isAbandonedConfirm(rawCode: "card_declined", declineCode: "REQUIRES_CUSTOMER_ACTION")
        )
        XCTAssertFalse(
            UqpayServerTruth.isAbandonedConfirm(rawCode: "3ds_failed", declineCode: "PENDING")
        )
    }

    func testATimedOutOrLostThreeDSPollIsAnUnobservedOutcomeWhateverTheDeclineCode() {
        // The card sheet raises these only after the confirm was sent
        // (PaymentCardViewController.swift:1162-1166, 2981-2985).
        XCTAssertTrue(UqpayServerTruth.isAbandonedConfirm(rawCode: "timeout", declineCode: nil))
        XCTAssertTrue(UqpayServerTruth.isAbandonedConfirm(rawCode: "network_error", declineCode: nil))
        XCTAssertTrue(UqpayServerTruth.isAbandonedConfirm(rawCode: "timeout", declineCode: "anything"))
    }

    func testAServerFailedIntentAfterATimeoutReportsTheGatewaysCanonicalCode() {
        let timeoutError = UqpayErrorMapper.nativeError(
            code: "timeout", developerMessage: "authentication timed out"
        )
        script = [.success(UqpayIntentSnapshot(status: "FAILED", failureCode: "3ds_failed"))]
        let truth = UqpayServerTruth(
            paymentIntentId: "pi_10", nativeError: timeoutError, machine: machine,
            read: { _, completion in completion(self.script.removeFirst()) },
            scheduler: scheduler
        )
        truth.start()
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["kind"] as? String, "failed")
        let error = settles[0]["error"] as? [String: Any]
        XCTAssertEqual(error?["code"] as? String, "3ds_failed")
        XCTAssertEqual(error?["declineCode"] as? String, "3ds_failed")
        XCTAssertEqual(error?["isOutcomeUnknown"] as? Bool, false)
        XCTAssertNil(error?["raw"])
    }

    func testATimeoutStillInFlightSettlesPendingWithTimeoutAsTheCause() {
        let timeoutError = UqpayErrorMapper.nativeError(
            code: "timeout", developerMessage: "authentication timed out"
        )
        script = inFlight(UqpayServerTruth.preSettleReads)
        let truth = UqpayServerTruth(
            paymentIntentId: "pi_10", nativeError: timeoutError, machine: machine,
            read: { _, completion in completion(self.script.removeFirst()) },
            scheduler: scheduler
        )
        truth.start()
        for _ in 1..<UqpayServerTruth.preSettleReads { scheduler.fire() }
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["kind"] as? String, "pending", "Android reports PENDING + TIMEOUT here")
        let cause = settles[0]["error"] as? [String: Any]
        XCTAssertEqual(cause?["code"] as? String, "timeout")
        XCTAssertEqual(cause?["isOutcomeUnknown"] as? Bool, true)
    }

    func testTheDelegateHandsATimeoutToTheBridgeToo() {
        let session = UqpaySheetSession(paymentIntentId: "pi_10", queue: .main)
        var handed: [[String: Any]] = []
        var settled: [[String: Any]] = []
        session.machine.onSettle = { settled.append($0) }
        session.onAbandonedConfirm = { error, _ in handed.append(error) }
        let sheet = PaymentSheet(configuration: PaymentSheet.Configuration())

        session.paymentSheet(sheet, didFailWithError: PaymentError(
            code: .timeout, message: "authentication timed out", paymentMethodType: "card"
        ))
        let done = expectation(description: "queue drained")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 1)

        XCTAssertTrue(settled.isEmpty)
        XCTAssertEqual(handed.count, 1)
        XCTAssertEqual(handed[0]["code"] as? String, "timeout")
        XCTAssertEqual(handed[0]["isOutcomeUnknown"] as? Bool, true)
    }

    // MARK: The live defect (issues.md row 10)

    func testAServerSucceededIntentSettlesCompletedWithTheServersFields() {
        script = inFlight(2) + [.success(UqpayIntentSnapshot(
            status: "SUCCEEDED", amount: "8.98", currency: "SGD",
            paymentMethodType: "card", attemptId: "PA_1"
        ))]
        let truth = makeTruth()
        truth.start()
        XCTAssertEqual(reads.count, 1, "the first read is immediate")
        XCTAssertTrue(settles.isEmpty)

        scheduler.fire()
        scheduler.fire()

        XCTAssertEqual(reads, ["pi_10", "pi_10", "pi_10"])
        XCTAssertEqual(settles.count, 1)
        let result = settles[0]
        XCTAssertEqual(result["kind"] as? String, "completed")
        XCTAssertEqual(result["status"] as? String, "SUCCEEDED")
        XCTAssertEqual(result["paymentIntentId"] as? String, "pi_10")
        XCTAssertEqual(result["amount"] as? String, "8.98")
        XCTAssertEqual(result["currency"] as? String, "SGD")
        XCTAssertEqual(result["paymentMethodType"] as? String, "card")
        XCTAssertEqual(result["transactionId"] as? String, "PA_1")
        XCTAssertEqual(result["completedAt"] as? String, "2023-11-14T22:13:20.000Z")
        XCTAssertNil(result["error"])
        XCTAssertEqual(releases, 1)
        XCTAssertEqual(scheduler.liveCount, 0, "no further reads after a terminal outcome")
    }

    func testTheSheetsPaymentMethodTypeFillsInWhenTheIntentReadHasNone() {
        // The intent read's `payment_method` lives inside the attempt, which the
        // SDK model does not decode (tester.md Part 5 anomaly 1).
        script = [.success(UqpayIntentSnapshot(
            status: "SUCCEEDED", amount: "8.98", currency: "SGD", attemptId: "PA_1", merchantOrderId: "order-77"
        ))]
        let truth = UqpayServerTruth(
            paymentIntentId: "pi_10", nativeError: nativeError, paymentMethodType: "card", machine: machine,
            read: { _, completion in completion(self.script.removeFirst()) },
            scheduler: scheduler
        )
        truth.start()
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["paymentMethodType"] as? String, "card")
        XCTAssertEqual(settles[0]["merchantOrderId"] as? String, "order-77")
        XCTAssertEqual(settles[0]["transactionId"] as? String, "PA_1")
    }

    func testTheIntentReadsPaymentMethodTypeWinsOverTheSheets() {
        let snapshot = UqpayIntentSnapshot(status: "SUCCEEDED", paymentMethodType: "unionpay")
        let result = UqpayServerTruth.terminalResult(
            from: snapshot, paymentIntentId: "pi_10", nativeError: nativeError,
            paymentMethodType: "card", now: Date()
        )
        XCTAssertEqual(result?["paymentMethodType"] as? String, "unionpay")
    }

    func testTheDelegatePassesThePaymentMethodTypeAlong() {
        let session = UqpaySheetSession(paymentIntentId: "pi_10", queue: .main)
        var types: [String?] = []
        session.onAbandonedConfirm = { _, type in types.append(type) }
        session.paymentSheet(PaymentSheet(), didFailWithError: PaymentError(
            code: .timeout, message: "authentication timed out", paymentMethodType: "card"
        ))
        let done = expectation(description: "queue drained")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 1)
        XCTAssertEqual(types, ["card"])
    }

    func testRequiresCaptureIsASuccessTooAndKeepsItsStatus() {
        script = [.success(UqpayIntentSnapshot(status: "requires_capture"))]
        let truth = makeTruth()
        truth.start()
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["kind"] as? String, "completed")
        XCTAssertEqual(settles[0]["status"] as? String, "REQUIRES_CAPTURE")
    }

    func testAServerFailedIntentSettlesFailedWithAKnownOutcomeAndTheGatewaysCode() {
        script = [.success(UqpayIntentSnapshot(status: "FAILED", failureCode: "card_declined"))]
        let truth = makeTruth()
        truth.start()
        XCTAssertEqual(settles.count, 1)
        let result = settles[0]
        XCTAssertEqual(result["kind"] as? String, "failed")
        XCTAssertEqual(result["status"] as? String, "FAILED")
        let error = result["error"] as? [String: Any]
        // The gateway's canonical failure code replaces the sheet's `unknown`.
        XCTAssertEqual(error?["code"] as? String, "card_declined")
        XCTAssertEqual(error?["declineCode"] as? String, "card_declined")
        XCTAssertEqual(error?["isOutcomeUnknown"] as? Bool, false)
        XCTAssertNil(error?["raw"])
    }

    func testAServerFailedIntentWithoutAFailureCodeKeepsTheSheetsMarker() {
        script = [.success(UqpayIntentSnapshot(status: "FAILED", failureCode: ""))]
        let truth = makeTruth()
        truth.start()
        let error = settles[0]["error"] as? [String: Any]
        XCTAssertEqual(error?["declineCode"] as? String, "REQUIRES_CUSTOMER_ACTION")
        XCTAssertEqual(error?["isOutcomeUnknown"] as? Bool, false)
    }

    func testAServerCancelledIntentSettlesCanceledWithIntentCancelled() {
        script = [.success(UqpayIntentSnapshot(status: "CANCELLED"))]
        let truth = makeTruth()
        truth.start()
        XCTAssertEqual(settles[0]["kind"] as? String, "canceled")
        XCTAssertEqual(settles[0]["reason"] as? String, "intent_cancelled")
        XCTAssertEqual(settles[0]["status"] as? String, "CANCELLED")
    }

    // MARK: Outcome still unknown

    func testStillInFlightAfterTheReadBudgetSettlesPendingWithOutcomeUnknown() {
        script = inFlight(UqpayServerTruth.preSettleReads)
        let truth = makeTruth()
        truth.start()
        for _ in 1..<UqpayServerTruth.preSettleReads {
            XCTAssertTrue(settles.isEmpty)
            scheduler.fire()
        }
        XCTAssertEqual(reads.count, UqpayServerTruth.preSettleReads)
        XCTAssertEqual(settles.count, 1)
        let result = settles[0]
        XCTAssertEqual(result["kind"] as? String, "pending")
        XCTAssertEqual(result["status"] as? String, "REQUIRES_CUSTOMER_ACTION")
        let cause = result["error"] as? [String: Any]
        XCTAssertEqual(cause?["code"] as? String, "unknown")
        XCTAssertEqual(cause?["declineCode"] as? String, "REQUIRES_CUSTOMER_ACTION")
        XCTAssertEqual(cause?["isOutcomeUnknown"] as? Bool, true)
        XCTAssertTrue(machine.settledAsPending)
        XCTAssertEqual(releases, 0, "the reconciliation window is open")
        XCTAssertEqual(scheduler.liveCount, 1, "reads continue under the watchdog")
    }

    func testALateSucceededAfterPendingArrivesAsReconciledNotASecondSettle() {
        script = inFlight(UqpayServerTruth.preSettleReads)
            + [.success(UqpayIntentSnapshot(status: "SUCCEEDED", amount: "1.00", currency: "SGD"))]
        let truth = makeTruth()
        truth.start()
        for _ in 1..<UqpayServerTruth.preSettleReads { scheduler.fire() }
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["kind"] as? String, "pending")

        scheduler.fire()

        XCTAssertEqual(settles.count, 1, "the promise settles exactly once")
        XCTAssertEqual(reconciled.count, 1)
        XCTAssertEqual(reconciled[0]["kind"] as? String, "completed")
        XCTAssertEqual(reconciled[0]["amount"] as? String, "1.00")
        XCTAssertEqual(releases, 1)
        XCTAssertEqual(scheduler.liveCount, 0)
    }

    func testAReadThatThrowsCountsAsInFlightNeverAsFailed() {
        script = [.failure(ReadFailed()), .failure(ReadFailed()), .success(UqpayIntentSnapshot(status: "SUCCEEDED"))]
        let truth = makeTruth()
        truth.start()
        scheduler.fire()
        XCTAssertTrue(settles.isEmpty, "a transport failure is not a payment failure")
        scheduler.fire()
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["kind"] as? String, "completed")
    }

    func testAllReadsFailingSettlesPendingWithNoLastKnownStatus() {
        script = Array(repeating: .failure(ReadFailed()), count: UqpayServerTruth.preSettleReads)
        let truth = makeTruth()
        truth.start()
        for _ in 1..<UqpayServerTruth.preSettleReads { scheduler.fire() }
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["kind"] as? String, "pending")
        XCTAssertNil(settles[0]["status"])
        XCTAssertEqual((settles[0]["error"] as? [String: Any])?["isOutcomeUnknown"] as? Bool, true)
    }

    func testTheWatchdogClosingTheWindowStopsTheReads() {
        script = inFlight(UqpayServerTruth.preSettleReads + 3)
        let truth = makeTruth()
        truth.start()
        for _ in 1..<UqpayServerTruth.preSettleReads { scheduler.fire() }
        XCTAssertTrue(machine.settledAsPending)
        scheduler.fire()
        let readsSoFar = reads.count

        machine.watchdogFired()
        scheduler.fire()

        XCTAssertEqual(reads.count, readsSoFar, "no read after release")
        XCTAssertTrue(reconciled.isEmpty)
    }

    func testCancelStopsTheReadsAndNeverSettles() {
        script = inFlight(3)
        let truth = makeTruth()
        truth.start()
        scheduler.fire()
        truth.cancel()
        scheduler.fire()
        XCTAssertEqual(reads.count, 2)
        XCTAssertTrue(settles.isEmpty)
        XCTAssertEqual(scheduler.liveCount, 0)
    }

    func testATerminalOutcomeFromElsewhereWinsAndTheReadsStop() {
        script = inFlight(3)
        let truth = makeTruth()
        truth.start()
        // e.g. the merchant-cancel fallback settled the promise first.
        machine.terminal(UqpayResultEncoder.encode(
            kind: .canceled, paymentIntentId: "pi_10", reason: .merchantCancelled
        ))
        scheduler.fire()
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["kind"] as? String, "canceled")
        XCTAssertEqual(reads.count, 1, "released: no further reads")
    }

    // MARK: Delegate wiring

    func testTheDelegateHandsAnAbandonedConfirmToTheBridgeInsteadOfSettlingFailed() {
        let session = UqpaySheetSession(paymentIntentId: "pi_10", queue: .main)
        var handed: [[String: Any]] = []
        var settled: [[String: Any]] = []
        session.machine.onSettle = { settled.append($0) }
        session.onAbandonedConfirm = { error, _ in handed.append(error) }
        let sheet = PaymentSheet(configuration: PaymentSheet.Configuration())

        session.paymentSheet(sheet, didFailWithError: PaymentError(
            code: .unknown,
            message: "Unexpected payment status: REQUIRES_CUSTOMER_ACTION. Please try again.",
            declineCode: "REQUIRES_CUSTOMER_ACTION",
            paymentMethodType: "card"
        ))
        let done = expectation(description: "queue drained")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 1)

        XCTAssertTrue(settled.isEmpty, "the sheet's guess must not settle the promise")
        XCTAssertEqual(handed.count, 1)
        XCTAssertEqual(handed[0]["code"] as? String, "unknown")
        XCTAssertEqual(handed[0]["declineCode"] as? String, "REQUIRES_CUSTOMER_ACTION")
        XCTAssertTrue(session.isConfirmInFlight, "a merchant cancel must not force `canceled` now")
    }

    func testTheDelegateStillSettlesAnOrdinaryUnknownFailure() {
        let session = UqpaySheetSession(paymentIntentId: "pi_10", queue: .main)
        var handed = 0
        var settled: [[String: Any]] = []
        session.machine.onSettle = { settled.append($0) }
        session.onAbandonedConfirm = { _, _ in handed += 1 }
        let sheet = PaymentSheet(configuration: PaymentSheet.Configuration())

        session.paymentSheet(sheet, didFailWithError: PaymentError(
            code: .unknown, message: "declined", declineCode: "do_not_honor", paymentMethodType: "card"
        ))
        let done = expectation(description: "queue drained")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 1)

        XCTAssertEqual(handed, 0)
        XCTAssertEqual(settled.count, 1)
        XCTAssertEqual(settled[0]["kind"] as? String, "failed")
        XCTAssertEqual((settled[0]["error"] as? [String: Any])?["isOutcomeUnknown"] as? Bool, false)
    }

    // MARK: REQUIRES_PAYMENT_METHOD (audit-3 item 1)

    /// A 3DS failure does not move the intent to FAILED: it falls back to
    /// REQUIRES_PAYMENT_METHOD with the attempt's `failure_code` set. After a
    /// timed-out 3DS poll that is a definite failure, not "still in flight".
    func testRequiresPaymentMethodWithAFailureCodeSettlesFailedLikeFailed() {
        let timeoutError = UqpayErrorMapper.nativeError(
            code: "timeout", developerMessage: "authentication timed out", isOutcomeUnknown: true
        )
        script = [.success(UqpayIntentSnapshot(status: "REQUIRES_PAYMENT_METHOD", failureCode: "3ds_failed"))]
        let truth = UqpayServerTruth(
            paymentIntentId: "pi_10", nativeError: timeoutError, machine: machine,
            read: { _, completion in completion(self.script.removeFirst()) },
            scheduler: scheduler
        )
        truth.start()
        XCTAssertEqual(settles.count, 1, "one read is enough: no 20 s wait, no `pending`")
        XCTAssertEqual(settles[0]["kind"] as? String, "failed")
        XCTAssertEqual(settles[0]["status"] as? String, "REQUIRES_PAYMENT_METHOD")
        let error = settles[0]["error"] as? [String: Any]
        XCTAssertEqual(error?["code"] as? String, "3ds_failed")
        XCTAssertEqual(error?["declineCode"] as? String, "3ds_failed")
        XCTAssertEqual(error?["isOutcomeUnknown"] as? Bool, false)
        XCTAssertNil(error?["raw"])
        XCTAssertEqual(releases, 1)
        XCTAssertEqual(scheduler.liveCount, 0, "no further reads after a known failure")
    }

    func testRequiresPaymentMethodWithANonCanonicalFailureCodeKeepsTheSheetsCode() {
        let result = UqpayServerTruth.terminalResult(
            from: UqpayIntentSnapshot(status: "requires_payment_method", failureCode: "do_not_honor"),
            paymentIntentId: "pi_10", nativeError: nativeError, now: Date()
        )
        XCTAssertEqual(result?["kind"] as? String, "failed")
        let error = result?["error"] as? [String: Any]
        XCTAssertEqual(error?["code"] as? String, "unknown")
        XCTAssertEqual(error?["declineCode"] as? String, "do_not_honor")
        XCTAssertEqual(error?["isOutcomeUnknown"] as? Bool, false)
    }

    func testRequiresPaymentMethodWithoutAFailureCodeIsStillUnknown() {
        for failureCode in [nil, "", "  "] as [String?] {
            XCTAssertNil(UqpayServerTruth.terminalResult(
                from: UqpayIntentSnapshot(status: "REQUIRES_PAYMENT_METHOD", failureCode: failureCode),
                paymentIntentId: "pi_10", nativeError: nativeError, now: Date()
            ), String(describing: failureCode))
        }
        script = [.success(UqpayIntentSnapshot(status: "REQUIRES_PAYMENT_METHOD"))]
        let truth = makeTruth()
        truth.start()
        XCTAssertTrue(settles.isEmpty)
        XCTAssertEqual(scheduler.liveCount, 1, "keeps reading")
    }

    // MARK: A failure reported while the server is being asked (audit-3 item 2)

    private var cardDeclined: [String: Any] {
        UqpayErrorMapper.nativeError(code: "card_declined", developerMessage: "declined")
    }

    /// The live hazard: the sheet shows "failed, try again", the customer taps
    /// Pay, and the second confirm is refused because the first one SUCCEEDED.
    func testAFailureDuringResolutionReadsTheServerNowAndItsSuccessWins() {
        script = inFlight(1) + [.success(UqpayIntentSnapshot(status: "SUCCEEDED", amount: "8.98"))]
        let truth = makeTruth()
        truth.start()
        XCTAssertEqual(reads.count, 1)
        XCTAssertEqual(scheduler.liveCount, 1)

        truth.recheck(observedFailure: cardDeclined)

        XCTAssertEqual(reads.count, 2, "the re-read is immediate, not after the poll interval")
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["kind"] as? String, "completed", "never `failed` for a paid intent")
        XCTAssertEqual(scheduler.liveCount, 0)
        XCTAssertEqual(releases, 1)
    }

    func testAFailureDuringResolutionThatTheServerConfirmsReportsTheObservedError() {
        script = inFlight(1) + [.success(UqpayIntentSnapshot(status: "FAILED"))]
        let truth = makeTruth()
        truth.start()
        truth.recheck(observedFailure: cardDeclined)
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["kind"] as? String, "failed")
        let error = settles[0]["error"] as? [String: Any]
        XCTAssertEqual(error?["code"] as? String, "card_declined")
        XCTAssertEqual(error?["isOutcomeUnknown"] as? Bool, false)
    }

    func testAFailureDuringResolutionWhileTheServerIsStillInFlightDoesNotSettle() {
        script = inFlight(5)
        let truth = makeTruth()
        truth.start()
        truth.recheck(observedFailure: cardDeclined)
        XCTAssertTrue(settles.isEmpty, "the sheet's failure alone never settles")
        XCTAssertEqual(reads.count, 2)
        XCTAssertEqual(scheduler.liveCount, 1, "one poll chain, not two")
    }

    func testARecheckWhileAReadIsOutReadsAgainAsSoonAsItLands() {
        var outstanding: [(Result<UqpayIntentSnapshot, Error>) -> Void] = []
        let truth = UqpayServerTruth(
            paymentIntentId: "pi_10", nativeError: nativeError, machine: machine,
            read: { _, completion in outstanding.append(completion) },
            scheduler: scheduler
        )
        truth.start()
        truth.recheck(observedFailure: cardDeclined)
        XCTAssertEqual(outstanding.count, 1, "no overlapping read")

        outstanding.removeFirst()(.success(UqpayIntentSnapshot(status: "REQUIRES_CUSTOMER_ACTION")))
        XCTAssertEqual(outstanding.count, 1, "re-read immediately after the outstanding one")
        XCTAssertEqual(scheduler.liveCount, 0)

        outstanding.removeFirst()(.success(UqpayIntentSnapshot(status: "SUCCEEDED")))
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles[0]["kind"] as? String, "completed")
    }

    func testAFailureAfterAPendingSettleReconcilesWithTheServersAnswer() {
        script = inFlight(UqpayServerTruth.preSettleReads)
            + [.success(UqpayIntentSnapshot(status: "SUCCEEDED"))]
        let truth = makeTruth()
        truth.start()
        for _ in 1..<UqpayServerTruth.preSettleReads { scheduler.fire() }
        XCTAssertTrue(machine.settledAsPending)

        truth.recheck(observedFailure: cardDeclined)

        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(reconciled.count, 1)
        XCTAssertEqual(reconciled[0]["kind"] as? String, "completed")
    }

    func testTheDelegateHandsAnOrdinaryFailureToTheBridgeWhileItIsResolving() {
        let session = UqpaySheetSession(paymentIntentId: "pi_10", queue: .main)
        var settled: [[String: Any]] = []
        var intercepted: [[String: Any]] = []
        session.machine.onSettle = { settled.append($0) }
        session.onFailureWhileResolving = { error in intercepted.append(error); return true }

        session.paymentSheet(PaymentSheet(), didFailWithError: PaymentError(
            code: .cardDeclined, message: "declined", paymentMethodType: "card"
        ))
        let done = expectation(description: "queue drained")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 1)

        XCTAssertTrue(settled.isEmpty)
        XCTAssertEqual(intercepted.count, 1)
        XCTAssertEqual(intercepted[0]["code"] as? String, "card_declined")
    }

    func testTheDelegateSettlesAnOrdinaryFailureWhenNothingIsResolving() {
        let session = UqpaySheetSession(paymentIntentId: "pi_10", queue: .main)
        var settled: [[String: Any]] = []
        session.machine.onSettle = { settled.append($0) }
        session.onFailureWhileResolving = { _ in false }

        session.paymentSheet(PaymentSheet(), didFailWithError: PaymentError(
            code: .cardDeclined, message: "declined", paymentMethodType: "card"
        ))
        let done = expectation(description: "queue drained")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 1)

        XCTAssertEqual(settled.count, 1)
        XCTAssertEqual(settled[0]["kind"] as? String, "failed")
    }

    /// The session and the resolver wired the way the bridge wires them: an
    /// abandoned confirm starts the server read, then a refused second confirm
    /// arrives, then a success — the promise settles once, `completed`.
    func testAbandonThenRefusedRetrySettlesOnceWithTheServersAnswer() {
        let session = UqpaySheetSession(paymentIntentId: "pi_10", queue: .main)
        var settled: [[String: Any]] = []
        session.machine.onSettle = { settled.append($0) }
        var truth: UqpayServerTruth?
        var outstanding: [(Result<UqpayIntentSnapshot, Error>) -> Void] = []
        session.onAbandonedConfirm = { error, type in
            truth = UqpayServerTruth(
                paymentIntentId: "pi_10", nativeError: error, paymentMethodType: type,
                machine: session.machine,
                read: { _, completion in outstanding.append(completion) },
                scheduler: self.scheduler
            )
            truth?.start()
        }
        session.onFailureWhileResolving = { error in
            guard let truth, !session.machine.isReleased else { return false }
            truth.recheck(observedFailure: error)
            return true
        }
        session.machine.onRelease = { truth?.cancel() }
        let sheet = PaymentSheet()

        session.paymentSheet(sheet, didFailWithError: PaymentError(
            code: .timeout, message: "authentication timed out", paymentMethodType: "card"
        ))
        session.paymentSheet(sheet, didFailWithError: PaymentError(
            code: .invalidPaymentMethod, message: "intent already succeeded", paymentMethodType: "card"
        ))
        let done = expectation(description: "queue drained")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 1)
        XCTAssertTrue(settled.isEmpty, "the refused retry must not settle `failed`")

        outstanding.removeFirst()(.success(UqpayIntentSnapshot(status: "SUCCEEDED")))
        XCTAssertEqual(settled.count, 1)
        XCTAssertEqual(settled[0]["kind"] as? String, "completed")
        XCTAssertTrue(outstanding.isEmpty)
    }
}
