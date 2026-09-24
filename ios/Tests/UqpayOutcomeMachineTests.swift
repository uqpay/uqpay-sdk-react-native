//
//  UqpayOutcomeMachineTests.swift
//  AC RN-TEST5, RN-CB1, RN-CB3, RN-FLOW7, RN-UX6, RN-TEST8
//
//  The SDK's `PaymentSheet` and its view controllers are `final` and internal,
//  so the bridge's own state machine is tested directly with injected callbacks
//  (spike S3 "Also recorded for Phase 3").
//

import XCTest
import UqpayPaymentSheet

@testable import uqpay_react_native

final class UqpayOutcomeMachineTests: XCTestCase {

    private var machine: UqpayOutcomeMachine!
    private var settles: [[String: Any]] = []
    private var reconciled: [[String: Any]] = []
    private var armedWatchdog = 0
    private var releases = 0

    override func setUp() {
        super.setUp()
        machine = UqpayOutcomeMachine()
        settles = []
        reconciled = []
        armedWatchdog = 0
        releases = 0
        machine.onSettle = { self.settles.append($0) }
        machine.onReconciled = { self.reconciled.append($0) }
        machine.onArmWatchdog = { self.armedWatchdog += 1 }
        machine.onRelease = { self.releases += 1 }
    }

    private func result(_ kind: UqpayResultKind, reason: UqpayCancelReason? = nil) -> [String: Any] {
        UqpayResultEncoder.encode(kind: kind, paymentIntentId: "pi_1", reason: reason)
    }

    func testATerminalOutcomeSettlesOnceAndReleasesImmediately() {
        machine.terminal(result(.completed))
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(releases, 1)
        XCTAssertEqual(armedWatchdog, 0, "no reconciliation window after a terminal outcome")
        XCTAssertTrue(machine.isSettled)
        XCTAssertTrue(machine.isReleased)
    }

    func testASecondTerminalOutcomeIsIgnored() {
        machine.terminal(result(.completed))
        machine.terminal(result(.failed))
        XCTAssertEqual(settles.count, 1, "the promise must settle exactly once")
        XCTAssertEqual(reconciled.count, 0)
        XCTAssertEqual(releases, 1)
    }

    func testPendingSettlesThePromiseAndOpensTheReconciliationWindow() {
        machine.pending(result(.pending))
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles.first?["kind"] as? String, "pending")
        XCTAssertEqual(armedWatchdog, 1)
        XCTAssertEqual(releases, 0, "the sheet must stay alive for the detached reconciliation")
    }

    func testALateOutcomeAfterPendingIsEmittedAsAReconciliationNotASecondSettle() {
        machine.pending(result(.pending))
        machine.terminal(result(.completed))

        XCTAssertEqual(settles.count, 1, "`pending` is final for the promise (AC RN-CB3)")
        XCTAssertEqual(reconciled.count, 1)
        XCTAssertEqual(reconciled.first?["kind"] as? String, "completed")
        XCTAssertEqual(releases, 1)
    }

    func testOnlyOneReconciliationIsEmitted() {
        machine.pending(result(.pending))
        machine.terminal(result(.completed))
        machine.terminal(result(.failed))
        XCTAssertEqual(reconciled.count, 1)
        XCTAssertEqual(releases, 1)
    }

    func testTheWatchdogReleasesWhenNoLateOutcomeArrives() {
        machine.pending(result(.pending))
        machine.watchdogFired()
        XCTAssertEqual(releases, 1)
        XCTAssertEqual(reconciled.count, 0)
        XCTAssertEqual(settles.count, 1)
    }

    func testPendingAfterATerminalOutcomeIsIgnored() {
        machine.terminal(result(.canceled, reason: .userCancelled))
        machine.pending(result(.pending))
        XCTAssertEqual(settles.count, 1)
        XCTAssertEqual(settles.first?["reason"] as? String, "user_cancelled")
    }

    func testTheReconciliationWindowIsSeventyFiveSeconds() {
        // The SDK polls 12 × 5 s after a pending report; the bridge allows one
        // extra interval of slack before it drops the sheet.
        XCTAssertEqual(UqpayBridge.reconciliationWindowSeconds, 75)
    }
}

// MARK: - Delegate wiring

final class UqpaySheetSessionTests: XCTestCase {

    private func session() -> UqpaySheetSession {
        UqpaySheetSession(paymentIntentId: "pi_matrix_0001", queue: DispatchQueue(label: "test"))
    }

    func testAServerCancelledIntentBecomesCanceledWithIntentCancelled() throws {
        let subject = session()
        var settled: [String: Any]?
        let done = expectation(description: "settled")
        subject.machine.onSettle = { settled = $0; done.fulfill() }

        subject.paymentSheet(
            PaymentSheet(),
            didFailWithError: PaymentError(code: .cancelled, message: "the intent was cancelled")
        )
        wait(for: [done], timeout: 2)

        let expected = try UqpayFixtures.iosPayload("terminal_cancelled")
        XCTAssertEqual(settled?["kind"] as? String, expected["kind"] as? String)
        XCTAssertEqual(settled?["reason"] as? String, expected["reason"] as? String)
    }

    func testAMerchantCancelIsAttributedToTheMerchant() throws {
        let subject = session()
        subject.merchantCancelled = true
        var settled: [String: Any]?
        let done = expectation(description: "settled")
        subject.machine.onSettle = { settled = $0; done.fulfill() }

        subject.paymentSheetDidCancel(PaymentSheet())
        wait(for: [done], timeout: 2)

        let expected = try UqpayFixtures.iosPayload("merchant_cancel")
        XCTAssertEqual(settled?["reason"] as? String, expected["reason"] as? String)
    }

    func testACustomerCancelIsAttributedToTheCustomer() throws {
        let subject = session()
        var settled: [String: Any]?
        let done = expectation(description: "settled")
        subject.machine.onSettle = { settled = $0; done.fulfill() }

        subject.paymentSheetDidCancel(PaymentSheet())
        wait(for: [done], timeout: 2)

        let expected = try UqpayFixtures.iosPayload("user_cancel")
        XCTAssertEqual(settled?["reason"] as? String, expected["reason"] as? String)
    }

    func testADeclineIsMappedThroughTheErrorMapper() throws {
        let subject = session()
        var settled: [String: Any]?
        let done = expectation(description: "settled")
        subject.machine.onSettle = { settled = $0; done.fulfill() }

        subject.paymentSheet(
            PaymentSheet(),
            didFailWithError: PaymentError(
                code: .cardDeclined, message: "issuer declined", declineCode: "do_not_honor"
            )
        )
        wait(for: [done], timeout: 2)

        let expected = try UqpayFixtures.iosPayload("decline")
        let error = try XCTUnwrap(settled?["error"] as? [String: Any])
        let expectedError = try XCTUnwrap(expected["error"] as? [String: Any])
        XCTAssertEqual(settled?["kind"] as? String, "failed")
        XCTAssertEqual(error["code"] as? String, expectedError["code"] as? String)
        XCTAssertEqual(error["declineCode"] as? String, expectedError["declineCode"] as? String)
    }

    func testRequiresActionIsEmittedAndMarksTheConfirmInFlight() {
        let subject = session()
        var events: [(String, [String: Any])] = []
        let done = expectation(description: "emitted")
        subject.emitEvent = { events.append(($0, $1)); done.fulfill() }

        subject.paymentSheet(
            PaymentSheet(), requiresAction: .authenticate3DS(url: "https://acs.example/challenge")
        )
        wait(for: [done], timeout: 2)

        XCTAssertEqual(events.first?.0, "uqpay_requiresAction")
        XCTAssertEqual(events.first?.1["type"] as? String, "authenticate3DS")
        XCTAssertTrue(subject.isConfirmInFlight, "cancelPaymentSheet must now yield `pending`")
    }

    func testBankDetailsActionCarriesNoAccountData() {
        let body = UqpaySheetSession.encode(
            action: .displayBankDetails(details: BankTransferDetails(
                bankName: "Bank", accountNumber: "12345678", accountName: "Acme",
                referenceNumber: "REF", amount: 1, currency: "SGD"
            ))
        )
        XCTAssertEqual(body as NSDictionary, ["type": "displayBankDetails"] as NSDictionary)
    }
}

// MARK: - Ownership / leaks (AC RN-TEST8, RN-BR2)

final class UqpaySessionLeakTests: XCTestCase {

    func testTheSessionAndItsSheetAreReleasedAfterATerminalOutcome() {
        let registry = UqpaySessionRegistry()
        weak var weakSession: UqpaySheetSession?
        weak var weakSheet: PaymentSheet?

        autoreleasepool {
            let session = UqpaySheetSession(
                paymentIntentId: "pi_1", queue: DispatchQueue(label: "leak")
            )
            let sheet = PaymentSheet()
            session.sheet = sheet
            sheet.paymentDelegate = session
            registry.setActive(session)

            weakSession = session
            weakSheet = sheet

            session.machine.onRelease = { [weak session] in
                guard let session else { return }
                registry.release(session)
                session.sheet = nil
            }

            XCTAssertEqual(registry.retainedCount, 1)
            session.machine.terminal(
                UqpayResultEncoder.encode(kind: .completed, paymentIntentId: "pi_1")
            )
            XCTAssertEqual(registry.retainedCount, 0, "the registry must hold nothing")
        }

        XCTAssertNil(weakSession, "the delegate object leaked")
        XCTAssertNil(weakSheet, "the single-use PaymentSheet leaked")
    }

    func testTheSheetIsHeldAcrossThePendingWindowAndDroppedWhenItCloses() {
        let registry = UqpaySessionRegistry()
        weak var weakSession: UqpaySheetSession?
        weak var weakSheet: PaymentSheet?

        autoreleasepool {
            let session = UqpaySheetSession(
                paymentIntentId: "pi_1", queue: DispatchQueue(label: "leak")
            )
            let sheet = PaymentSheet()
            session.sheet = sheet
            registry.setActive(session)
            weakSession = session
            weakSheet = sheet

            session.machine.onArmWatchdog = { [weak session] in
                guard let session else { return }
                registry.retainForReconciliation(session)
            }
            session.machine.onRelease = { [weak session] in
                guard let session else { return }
                registry.release(session)
                session.sheet = nil
            }

            session.machine.pending(
                UqpayResultEncoder.encode(kind: .pending, paymentIntentId: "pi_1")
            )
            XCTAssertEqual(registry.retainedCount, 1, "the sheet must survive the pending window")

            session.machine.watchdogFired()
            XCTAssertEqual(registry.retainedCount, 0)
        }

        XCTAssertNil(weakSession)
        XCTAssertNil(weakSheet)
    }
}
