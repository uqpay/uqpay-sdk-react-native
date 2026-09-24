//
//  UqpayTokenBrokerTests.swift
//  AC RN-TEST5, RN-BR6, RN-ERR8, RN-PAR6, RN-SEC7
//
//  The 10 s budget is exercised through an injected scheduler, so the suite
//  never actually waits.
//

import XCTest

@testable import uqpay_react_native

final class UqpayTokenBrokerTests: XCTestCase {

    private var scheduler: UqpayFakeScheduler!
    private var broker: UqpayTokenBroker!
    private var emitted: [(String, String)] = []
    private var hasListener = true

    override func setUp() {
        super.setUp()
        scheduler = UqpayFakeScheduler()
        broker = UqpayTokenBroker(scheduler: scheduler)
        emitted = []
        hasListener = true
        broker.emit = { [weak self] requestId, reason in
            guard let self, self.hasListener else { return false }
            self.emitted.append((requestId, reason))
            return true
        }
    }

    func testTheDefaultBudgetIsTenSeconds() {
        XCTAssertEqual(UqpayTokenBroker.timeoutSeconds, 10)
        _ = broker.request(reason: "present") { _ in }
        XCTAssertEqual(scheduler.scheduled.first?.delay, 10)
    }

    func testAProvidedTokenResolvesTheRequest() {
        var outcome: Result<String, UqpayTokenFailure>?
        let requestId = broker.request(reason: "present") { outcome = $0 }

        XCTAssertEqual(emitted.count, 1)
        XCTAssertEqual(emitted.first?.1, "present")

        broker.provide(requestId: requestId, authToken: "  tok_abc  ")

        guard case .success(let token)? = outcome else {
            return XCTFail("expected success, got \(String(describing: outcome))")
        }
        XCTAssertEqual(token, "tok_abc")
        XCTAssertEqual(broker.pendingCount, 0)
        XCTAssertEqual(scheduler.liveCount, 0, "the timeout timer must be cancelled")
    }

    func testABlankTokenIsAProviderFailure() {
        var outcome: Result<String, UqpayTokenFailure>?
        let requestId = broker.request(reason: "present") { outcome = $0 }
        broker.provide(requestId: requestId, authToken: "   ")

        guard case .failure(let failure)? = outcome, case .blank = failure else {
            return XCTFail("expected .blank, got \(String(describing: outcome))")
        }
        XCTAssertTrue(failure.developerMessage.contains("tokenProvider"))
    }

    func testAThrowingProviderIsAProviderFailure() {
        var outcome: Result<String, UqpayTokenFailure>?
        let requestId = broker.request(reason: "present") { outcome = $0 }
        broker.fail(requestId: requestId, developerMessage: "network down")

        guard case .failure(let failure)? = outcome,
              case .providerFailed(let detail) = failure
        else {
            return XCTFail("expected .providerFailed, got \(String(describing: outcome))")
        }
        XCTAssertEqual(detail, "network down")
    }

    func testAHangingProviderTimesOutAfterTheBudget() {
        var outcome: Result<String, UqpayTokenFailure>?
        _ = broker.request(reason: "present") { outcome = $0 }

        XCTAssertNil(outcome, "nothing must settle before the budget elapses")
        scheduler.fire()

        guard case .failure(let failure)? = outcome, case .timedOut = failure else {
            return XCTFail("expected .timedOut, got \(String(describing: outcome))")
        }
        XCTAssertEqual(broker.pendingCount, 0)
    }

    func testALateAnswerAfterTheTimeoutIsIgnored() {
        var settles = 0
        let requestId = broker.request(reason: "present") { _ in settles += 1 }
        scheduler.fire()
        broker.provide(requestId: requestId, authToken: "tok_late")
        XCTAssertEqual(settles, 1, "the completion must run exactly once")
    }

    /// The process relaunched and the sheet is being rebuilt before JS `init()`
    /// ran: the request is parked and re-emitted when a listener attaches.
    func testARequestMadeWithNoListenerIsReEmittedWhenOneAttaches() {
        hasListener = false
        var outcome: Result<String, UqpayTokenFailure>?
        let requestId = broker.request(reason: "present") { outcome = $0 }
        XCTAssertTrue(emitted.isEmpty)

        hasListener = true
        broker.listenersDidAttach()
        XCTAssertEqual(emitted.count, 1)
        XCTAssertEqual(emitted.first?.0, requestId)

        broker.provide(requestId: requestId, authToken: "tok_abc")
        guard case .success? = outcome else {
            return XCTFail("expected success after the listener attached")
        }
    }

    func testCancelAllFailsEveryOutstandingWaiter() {
        var outcome: Result<String, UqpayTokenFailure>?
        _ = broker.request(reason: "present") { outcome = $0 }
        broker.cancelAll(developerMessage: "bridge torn down")

        guard case .failure(let failure)? = outcome,
              case .providerFailed(let detail) = failure
        else {
            return XCTFail("expected .providerFailed, got \(String(describing: outcome))")
        }
        XCTAssertEqual(detail, "bridge torn down")
        XCTAssertEqual(broker.pendingCount, 0)
    }

    func testAnUnknownRequestIdIsIgnored() {
        var settles = 0
        _ = broker.request(reason: "present") { _ in settles += 1 }
        broker.provide(requestId: "not-a-request", authToken: "tok")
        XCTAssertEqual(settles, 0)
        XCTAssertEqual(broker.pendingCount, 1)
    }
}
