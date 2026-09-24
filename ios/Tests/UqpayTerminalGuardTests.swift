//
//  UqpayTerminalGuardTests.swift
//  AC RN-TEST5, RN-FLOW2
//
//  The bridge pre-reads the intent with `ApiClient.getPaymentIntentById` before
//  `loadViewController`, because iOS does **not** treat `REQUIRES_CAPTURE` as
//  terminal and would otherwise present a working payment form (spike S2,
//  lead's go/no-go decision).
//

import XCTest

@testable import uqpay_react_native

final class UqpayTerminalGuardTests: XCTestCase {

    private let intentId = "pi_matrix_0001"

    func testASucceededIntentResolvesCompletedWithIdAndStatusOnly() throws {
        let result = try XCTUnwrap(
            UqpayBridge.terminalGuardResult(intentStatus: "SUCCEEDED", paymentIntentId: intentId)
        )
        let expected = try UqpayFixtures.iosPayload("terminal_succeeded")
        XCTAssertEqual(result["kind"] as? String, "completed")
        XCTAssertEqual(result["status"] as? String, "SUCCEEDED")
        XCTAssertNil(result["amount"], "the refusal happens at load, so there is no PaymentResult")
        XCTAssertNil(result["currency"])
        UqpayAssertResult(result, matches: expected)
    }

    /// The cell iOS exists to cover: `REQUIRES_CAPTURE` is **not** terminal in the
    /// native SDK, so without the bridge's pre-read the customer would be shown a
    /// working payment form for an already-authorised intent (RN-FLOW2).
    func testARequiresCaptureIntentResolvesCompleted() throws {
        let result = try XCTUnwrap(
            UqpayBridge.terminalGuardResult(
                intentStatus: "REQUIRES_CAPTURE", paymentIntentId: intentId
            )
        )
        let expected = try UqpayFixtures.iosPayload("terminal_guard_requires_capture")
        XCTAssertEqual(result["kind"] as? String, "completed")
        XCTAssertEqual(result["status"] as? String, "REQUIRES_CAPTURE")
        XCTAssertNil(result["amount"])
        UqpayAssertResult(result, matches: expected)
    }

    func testAFailedIntentResolvesFailedWithIntentNotPayable() throws {
        let result = try XCTUnwrap(
            UqpayBridge.terminalGuardResult(intentStatus: "FAILED", paymentIntentId: intentId)
        )
        let expected = try UqpayFixtures.iosPayload("terminal_failed")
        XCTAssertEqual(result["kind"] as? String, "failed")
        let error = try XCTUnwrap(result["error"] as? [String: Any])
        let expectedError = try XCTUnwrap(expected["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, expectedError["code"] as? String)
        XCTAssertEqual(error["isOutcomeUnknown"] as? Bool, false)
    }

    func testACancelledIntentResolvesCanceledWithIntentCancelled() throws {
        let result = try XCTUnwrap(
            UqpayBridge.terminalGuardResult(intentStatus: "CANCELLED", paymentIntentId: intentId)
        )
        let expected = try UqpayFixtures.iosPayload("terminal_cancelled")
        UqpayAssertResult(result, matches: expected)
    }

    func testTheAmericanSpellingIsAlsoAccepted() throws {
        let result = try XCTUnwrap(
            UqpayBridge.terminalGuardResult(intentStatus: "CANCELED", paymentIntentId: intentId)
        )
        XCTAssertEqual(result["reason"] as? String, "intent_cancelled")
    }

    func testCasingAndWhitespaceAreTolerated() throws {
        let result = try XCTUnwrap(
            UqpayBridge.terminalGuardResult(intentStatus: " succeeded ", paymentIntentId: intentId)
        )
        XCTAssertEqual(result["kind"] as? String, "completed")
    }

    func testAPayableIntentIsNotGuarded() {
        for status in ["REQUIRES_PAYMENT_METHOD", "REQUIRES_CUSTOMER_ACTION", "PENDING", "", "WAT"] {
            XCTAssertNil(
                UqpayBridge.terminalGuardResult(intentStatus: status, paymentIntentId: intentId),
                "status \(status) must present the sheet"
            )
        }
    }

    func testTheNativeSdkVersionIsReported() {
        // Either read from the SDK's resource bundle or the pinned fallback;
        // both must be the 1.1.x the podspec allows.
        XCTAssertTrue(
            UqpayBridge.nativeSdkVersion().hasPrefix("1.1."),
            UqpayBridge.nativeSdkVersion()
        )
    }
}
