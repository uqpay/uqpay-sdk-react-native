//
//  UqpayPresentationGuardsTests.swift
//  AC RN-TEST5, RN-FLOW1, RN-UX12 — issues.md rows 4 and 5
//
//  Both guards are driven through the injected scheduler, so the 2 s and 60 s
//  budgets are asserted without the suite waiting for either.
//

import XCTest
import UIKit

@testable import uqpay_react_native

final class UqpayPresentationGuardsTests: XCTestCase {

    private var scheduler: UqpayFakeScheduler!
    private var guards: UqpayPresentationGuards!

    override func setUp() {
        super.setUp()
        scheduler = UqpayFakeScheduler()
        guards = UqpayPresentationGuards(scheduler: scheduler)
    }

    // MARK: - Budgets

    func testTheBudgetsAreTwoSecondsForPresentAndSixtyForLoad() {
        XCTAssertEqual(UqpayPresentationGuards.presentSeconds, 2)
        XCTAssertEqual(UqpayPresentationGuards.loadSeconds, 60)

        guards.armLoad {}
        guards.armPresent {}
        XCTAssertEqual(Set(scheduler.scheduled.map(\.delay)), [60, 2])
    }

    // MARK: - Load guard (row 5)

    func testTheLoadGuardFiresWhenLoadViewControllerNeverCallsBack() {
        var fired = 0
        guards.armLoad { fired += 1 }
        XCTAssertTrue(guards.hasLoadGuard)

        scheduler.fire(after: 60)
        XCTAssertEqual(fired, 1)
        XCTAssertFalse(guards.hasLoadGuard)
    }

    func testCancellingTheLoadGuardStopsIt() {
        var fired = 0
        guards.armLoad { fired += 1 }
        guards.cancelLoad()
        scheduler.fire()
        XCTAssertEqual(fired, 0)
        XCTAssertFalse(guards.hasLoadGuard)
    }

    /// A slow but successful load must not also trip the guard.
    func testTheLoadGuardSettlesTheMachineWithNetworkErrorExactlyOnce() throws {
        let machine = UqpayOutcomeMachine()
        var settles: [[String: Any]] = []
        machine.onSettle = { settles.append($0) }

        guards.armLoad {
            guard !machine.isSettled else { return }
            machine.terminal(UqpayBridge.loadTimeoutResult(paymentIntentId: "pi_1"))
        }
        scheduler.fire(after: 60)

        XCTAssertEqual(settles.count, 1)
        let result = try XCTUnwrap(settles.first)
        XCTAssertEqual(result["kind"] as? String, "failed")
        let error = try XCTUnwrap(result["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "network_error")
        XCTAssertEqual(
            error["developerMessage"] as? String, "the payment sheet did not load within 60 s"
        )
        XCTAssertEqual(error["isOutcomeUnknown"] as? Bool, false)
    }

    func testAnAlreadySettledSessionIsNotSettledAgainByTheLoadGuard() {
        let machine = UqpayOutcomeMachine()
        var settles = 0
        machine.onSettle = { _ in settles += 1 }

        guards.armLoad {
            guard !machine.isSettled else { return }
            machine.terminal(UqpayBridge.loadTimeoutResult(paymentIntentId: "pi_1"))
        }
        machine.terminal(UqpayResultEncoder.encode(kind: .completed, paymentIntentId: "pi_1"))
        scheduler.fire(after: 60)

        XCTAssertEqual(settles, 1, "the promise must still settle exactly once")
    }

    // MARK: - Present guard (row 4)

    func testThePresentGuardFiresWhenUIKitNeverRunsTheCompletion() {
        var fired = 0
        guards.armPresent { fired += 1 }
        XCTAssertTrue(guards.hasPresentGuard)

        scheduler.fire(after: 2)
        XCTAssertEqual(fired, 1)
        XCTAssertFalse(guards.hasPresentGuard)
    }

    /// The normal path: UIKit ran the completion, so the guard is cancelled and
    /// a healthy presentation is never turned into a failure.
    func testAPresentationThatCompletesCancelsTheGuard() {
        var fired = 0
        guards.armPresent { fired += 1 }
        guards.cancelPresent()
        scheduler.fire()
        XCTAssertEqual(fired, 0)
    }

    @MainActor
    func testARefusedPresentationSettlesWithInvalidConfiguration() throws {
        let machine = UqpayOutcomeMachine()
        var settles: [[String: Any]] = []
        machine.onSettle = { settles.append($0) }

        // Nothing was ever presented, which is exactly what UIKit leaves behind
        // when it refuses: `presentingViewController` stays nil.
        let orphan = UIViewController()
        XCTAssertTrue(UqpayPresenter.isDetached(orphan))
        XCTAssertTrue(UqpayPresenter.isDetached(nil))

        guards.armPresent {
            guard UqpayPresenter.isDetached(orphan), !machine.isSettled else { return }
            machine.terminal(UqpayBridge.presentationRefusedResult(paymentIntentId: "pi_1"))
        }
        scheduler.fire(after: 2)

        XCTAssertEqual(settles.count, 1)
        let result = try XCTUnwrap(settles.first)
        XCTAssertEqual(result["kind"] as? String, "failed")
        let error = try XCTUnwrap(result["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "invalid_configuration")
        XCTAssertEqual(
            error["developerMessage"] as? String,
            "the payment sheet could not be presented "
                + "(the presenting view controller was not in the window hierarchy)"
        )
    }

    /// A controller UIKit really did present reports a presenter, so the guard
    /// must leave a healthy sheet alone. (Driven through a stub rather than a
    /// real `present(_:animated:)`: this test bundle has no app host, so UIKit
    /// never runs a presentation transition.)
    @MainActor
    func testAControllerThatIsActuallyPresentedIsNotReportedAsRefused() {
        final class AttachedController: UIViewController {
            let presenter = UIViewController()
            override var presentingViewController: UIViewController? { presenter }
        }
        let presented = AttachedController()
        XCTAssertFalse(UqpayPresenter.isDetached(presented))

        let machine = UqpayOutcomeMachine()
        var settles = 0
        machine.onSettle = { _ in settles += 1 }
        guards.armPresent {
            guard UqpayPresenter.isDetached(presented), !machine.isSettled else { return }
            machine.terminal(UqpayBridge.presentationRefusedResult(paymentIntentId: "pi_1"))
        }
        scheduler.fire(after: 2)
        XCTAssertEqual(settles, 0, "a presented sheet must never be failed by the guard")
    }

    // MARK: - Both guards together

    func testCancelAllStopsEverything() {
        var fired = 0
        guards.armLoad { fired += 1 }
        guards.armPresent { fired += 1 }
        guards.cancelAll()
        scheduler.fire()
        XCTAssertEqual(fired, 0)
        XCTAssertFalse(guards.hasLoadGuard)
        XCTAssertFalse(guards.hasPresentGuard)
    }

    func testReArmingReplacesTheEarlierTimer() {
        var first = 0
        var second = 0
        guards.armPresent { first += 1 }
        guards.armPresent { second += 1 }
        scheduler.fire(after: 2)
        XCTAssertEqual(first, 0)
        XCTAssertEqual(second, 1)
    }
}
