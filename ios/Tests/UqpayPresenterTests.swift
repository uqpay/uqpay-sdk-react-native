//
//  UqpayPresenterTests.swift
//  AC RN-TEST5, RN-BR2, RN-UX12, RN-CB8
//

import XCTest
import UIKit

@testable import uqpay_react_native

final class UqpayPresenterTests: XCTestCase {

    /// Stands in for a React Navigation stack / `Modal` / bottom-sheet chain:
    /// the sheet must go on top of whatever is already presented (RN-UX12).
    private final class FakePresentingController: UIViewController {
        var stubbedPresented: UIViewController?
        override var presentedViewController: UIViewController? { stubbedPresented }
    }

    func testTheWalkStopsAtTheRootWhenNothingIsPresented() {
        let root = FakePresentingController()
        XCTAssertTrue(UqpayPresenter.topMostViewController(from: root) === root)
    }

    func testTheWalkFollowsEveryPresentedViewController() {
        let root = FakePresentingController()
        let modal = FakePresentingController()
        let bottomSheet = FakePresentingController()
        root.stubbedPresented = modal
        modal.stubbedPresented = bottomSheet

        XCTAssertTrue(
            UqpayPresenter.topMostViewController(from: root) === bottomSheet,
            "the sheet must be presented from the top-most controller, not the root"
        )
    }

    /// No key window (app backgrounded, scene being rebuilt) → the bridge must
    /// resolve `failed` / `invalid_configuration`, never crash (RN-CB8).
    func testANilRootProducesNoPresenterAndTheInvalidConfigurationResult() throws {
        XCTAssertNil(UqpayPresenter.topMostViewController(from: nil))

        let result = UqpayResultEncoder.encode(
            kind: .failed,
            paymentIntentId: "pi_matrix_0001",
            error: UqpayErrorMapper.bridgeError(
                code: "invalid_configuration",
                developerMessage: "no presenting view controller"
            )
        )
        let expected = try UqpayFixtures.iosPayload("no_activity_or_vc")
        XCTAssertEqual(result["kind"] as? String, expected["kind"] as? String)
        let error = try XCTUnwrap(result["error"] as? [String: Any])
        let expectedError = try XCTUnwrap(expected["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, expectedError["code"] as? String)
        XCTAssertEqual(error["isOutcomeUnknown"] as? Bool, false)
    }

    @MainActor
    func testDismissingANeverPresentedControllerStillCompletes() {
        let expectation = expectation(description: "completion runs")
        UqpayPresenter.dismiss(UIViewController()) { expectation.fulfill() }
        wait(for: [expectation], timeout: 1)
    }

    @MainActor
    func testDismissingNilStillCompletes() {
        let expectation = expectation(description: "completion runs")
        UqpayPresenter.dismiss(nil) { expectation.fulfill() }
        wait(for: [expectation], timeout: 1)
    }

    // MARK: Bounded dismiss (audit-3 item 3)

    /// Looks presented to `UqpayPresenter.dismiss` without touching UIKit's
    /// real presentation machinery.
    private final class FakePresentedController: UIViewController {
        let stubbedPresenter = UIViewController()
        override var presentingViewController: UIViewController? { stubbedPresenter }
    }

    /// UIKit refused the dismiss (it was asked mid-present) and never calls
    /// back: the dismiss is asked for once more, and the completion still runs,
    /// or the promise would hang forever.
    @MainActor
    func testADismissUIKitNeverCompletesIsRetriedOnceAndStillCompletes() {
        let completed = expectation(description: "completion runs")
        completed.assertForOverFulfill = true
        var performed = 0
        // Held here as UIKit holds a presented controller.
        let sheet = FakePresentedController()
        UqpayPresenter.dismiss(
            sheet, timeout: 0.1, perform: { _, _ in performed += 1 }
        ) { completed.fulfill() }
        wait(for: [completed], timeout: 2)
        XCTAssertEqual(performed, 2, "one retry after the first refused dismiss")
    }

    /// The retry is what actually takes the sheet down when the first request
    /// was refused mid-present; its completion ends the wait.
    @MainActor
    func testTheRetrysCompletionEndsTheWait() {
        let completed = expectation(description: "completion runs")
        completed.assertForOverFulfill = true
        var performed = 0
        // Held here as UIKit holds a presented controller.
        let sheet = FakePresentedController()
        UqpayPresenter.dismiss(
            sheet, timeout: 0.1,
            perform: { _, done in performed += 1; if performed == 2 { done() } }
        ) { completed.fulfill() }
        wait(for: [completed], timeout: 2)
        let drained = expectation(description: "past the last timeout")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { drained.fulfill() }
        wait(for: [drained], timeout: 2)
        XCTAssertEqual(performed, 2)
    }

    /// A sheet that went away on its own is not dismissed again.
    @MainActor
    func testNoRetryOnceTheSheetIsGone() {
        final class Vanishing: UIViewController {
            var presenter: UIViewController? = UIViewController()
            override var presentingViewController: UIViewController? { presenter }
        }
        let sheet = Vanishing()
        let completed = expectation(description: "completion runs")
        var performed = 0
        UqpayPresenter.dismiss(
            sheet, timeout: 0.1, perform: { _, _ in performed += 1; sheet.presenter = nil }
        ) { completed.fulfill() }
        wait(for: [completed], timeout: 2)
        XCTAssertEqual(performed, 1)
    }

    @MainActor
    func testANormalDismissCompletesOnceAndTheTimeoutDoesNotRunItAgain() {
        let completed = expectation(description: "completion runs once")
        completed.assertForOverFulfill = true
        var performed = 0
        UqpayPresenter.dismiss(
            FakePresentedController(), timeout: 0.05,
            perform: { _, done in performed += 1; done() }
        ) { completed.fulfill() }
        let settled = expectation(description: "past the timeout")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { settled.fulfill() }
        wait(for: [completed, settled], timeout: 2, enforceOrder: true)
        XCTAssertEqual(performed, 1)
    }

    @MainActor
    func testAUIKitCompletionArrivingAfterTheTimeoutDoesNotRunItAgain() {
        let completed = expectation(description: "completion runs once")
        completed.assertForOverFulfill = true
        var late: (() -> Void)?
        UqpayPresenter.dismiss(
            FakePresentedController(), timeout: 0.05, retries: 0, perform: { _, done in late = done }
        ) { completed.fulfill() }
        wait(for: [completed], timeout: 2)
        late?()
        let drained = expectation(description: "drained")
        DispatchQueue.main.async { drained.fulfill() }
        wait(for: [drained], timeout: 1)
    }

    @MainActor
    func testTheDefaultBoundIsAboutOneSecond() {
        XCTAssertEqual(UqpayPresenter.dismissCompletionTimeout, 1)
    }
}
