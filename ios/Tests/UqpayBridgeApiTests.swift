//
//  UqpayBridgeApiTests.swift
//  AC RN-TEST5, RN-UX7, RN-UX8, RN-BR7, RN-DEP7, RN-IDEM1, RN-CB6
//
//  Drives the real `UqpayBridge` singleton across the paths that settle
//  **before** any network call, so the suite stays hermetic: validation,
//  the iOS parity refusals, the one-active-sheet guard, `getNativeInfo`,
//  `getPendingResult` and `notifyReturnedFromBank`.
//

import XCTest
import UqpayCore
import UqpayPaymentSheet

@testable import uqpay_react_native

final class UqpayBridgeApiTests: XCTestCase {

    private let bridge = UqpayBridge.shared
    private let configId = "cfg-tests"

    private var validOptions: NSDictionary {
        [
            "paymentIntentId": "pi_matrix_0001",
            "returnUrl": "uqpayexample://payment",
            "presentationMode": "methodList",
        ]
    }

    override func setUp() {
        super.setUp()
        _ = initializeBridge()
    }

    @discardableResult
    private func initializeBridge(
        configId: String? = nil,
        environment: String = "sandbox",
        clientId: String = "client_tests"
    ) -> (ok: Bool, code: String?, message: String?) {
        var ok = false
        var code: String?
        var message: String?
        let done = expectation(description: "initialize")
        bridge.initializeBridge(
            [
                "environment": environment,
                "clientId": clientId,
                "debugLogging": false,
                "configId": configId ?? self.configId,
            ],
            onSuccess: { ok = true; done.fulfill() },
            onError: { errorCode, errorMessage in
                code = errorCode
                message = errorMessage
                done.fulfill()
            }
        )
        wait(for: [done], timeout: 5)
        return (ok, code, message)
    }

    private func present(
        _ options: NSDictionary,
        timeout: TimeInterval = 5
    ) -> (result: NSDictionary?, code: String?, message: String?) {
        var result: NSDictionary?
        var code: String?
        var message: String?
        let done = expectation(description: "present")
        bridge.presentPaymentSheet(
            options,
            onResult: { result = $0; done.fulfill() },
            onError: { errorCode, errorMessage in
                code = errorCode
                message = errorMessage
                done.fulfill()
            }
        )
        wait(for: [done], timeout: timeout)
        return (result, code, message)
    }

    // MARK: - initialize (RN-IDEM1)

    func testInitializeWithTheSameConfigIdIsANoOp() {
        XCTAssertTrue(initializeBridge().ok)
        XCTAssertTrue(initializeBridge().ok)
    }

    func testInitializeRejectsAnUnknownEnvironment() {
        let outcome = initializeBridge(configId: "cfg-bad-env", environment: "staging")
        XCTAssertEqual(outcome.code, "invalid_configuration")
        XCTAssertEqual(outcome.message?.contains("environment"), true)
        _ = initializeBridge()
    }

    func testInitializeRejectsABlankClientId() {
        let outcome = initializeBridge(configId: "cfg-blank-client", clientId: "   ")
        XCTAssertEqual(outcome.code, "invalid_configuration")
        XCTAssertEqual(outcome.message?.contains("clientId"), true)
        _ = initializeBridge()
    }

    // MARK: - present validation (rejects, per bridge-contract §0.3)

    func testPresentRejectsABlankPaymentIntentId() {
        let outcome = present(["paymentIntentId": "  ", "returnUrl": "uqpayexample://payment"])
        XCTAssertEqual(outcome.code, "invalid_configuration")
        XCTAssertEqual(outcome.message?.contains("paymentIntentId"), true)
    }

    func testPresentRejectsAPlainHttpReturnUrl() {
        let outcome = present([
            "paymentIntentId": "pi_matrix_0001", "returnUrl": "http://example.com/return",
        ])
        XCTAssertEqual(outcome.code, "invalid_configuration")
    }

    func testPresentRejectsABlankReturnUrl() {
        let outcome = present(["paymentIntentId": "pi_matrix_0001", "returnUrl": ""])
        XCTAssertEqual(outcome.code, "invalid_configuration")
    }

    // MARK: - iOS parity refusals (RN-DEP7) — resolved, not rejected

    func testSingleWalletResolvesFailedNamingTheDependency() throws {
        let outcome = present([
            "paymentIntentId": "pi_matrix_0001",
            "returnUrl": "uqpayexample://payment",
            "presentationMode": "singleWallet",
            "singleWalletMethod": "grabpay",
        ])
        let result = try XCTUnwrap(outcome.result as? [String: Any])
        XCTAssertEqual(result["kind"] as? String, "failed")
        let error = try XCTUnwrap(result["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "invalid_configuration")
        let message = error["developerMessage"] as? String ?? ""
        XCTAssertTrue(message.contains("singleWallet"), message)
        XCTAssertTrue(message.contains("methodList"), "names the supported alternative: \(message)")
        XCTAssertFalse(message.contains("RN-"), "no internal tracker ids in merchant-facing text")
    }

    func testAllowedPaymentMethodsResolvesFailedNamingTheDependency() throws {
        let outcome = present([
            "paymentIntentId": "pi_matrix_0001",
            "returnUrl": "uqpayexample://payment",
            "presentationMode": "methodList",
            "allowedPaymentMethods": ["card"],
        ])
        let result = try XCTUnwrap(outcome.result as? [String: Any])
        let error = try XCTUnwrap(result["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "invalid_configuration")
        XCTAssertEqual((error["developerMessage"] as? String)?.contains("allowedPaymentMethods"), true)
    }

    // MARK: - One active sheet (RN-UX7, RN-UX8)

    /// The first present parks on the token broker (no JS listener is attached in
    /// the test bundle, so nothing answers and it sits out its 10 s budget
    /// **without touching the network**). The second call must be refused.
    func testASecondPresentWhileOneIsInFlightIsRefused() throws {
        var firstResult: NSDictionary?
        let first = expectation(description: "first present settles")
        bridge.presentPaymentSheet(
            validOptions,
            onResult: { firstResult = $0; first.fulfill() },
            onError: { _, _ in first.fulfill() }
        )

        let second = present([
            "paymentIntentId": "pi_matrix_0002",
            "returnUrl": "uqpayexample://payment",
            "presentationMode": "methodList",
        ])
        let refusal = try XCTUnwrap(second.result as? [String: Any])
        XCTAssertEqual(refusal["kind"] as? String, "failed")
        let error = try XCTUnwrap(refusal["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "invalid_configuration")
        XCTAssertEqual(
            (error["developerMessage"] as? String), "a payment sheet is already presented"
        )

        // Let the parked first call time out so the singleton is idle again.
        wait(for: [first], timeout: 20)
        let timedOut = try XCTUnwrap(firstResult as? [String: Any])
        let timeoutError = try XCTUnwrap(timedOut["error"] as? [String: Any])
        XCTAssertEqual(timeoutError["code"] as? String, "authentication_failed")
    }

    // MARK: - getNativeInfo / getPendingResult / notifyReturnedFromBank

    func testGetNativeInfoReportsThePlatformAndTheNativeSdkVersion() throws {
        var info: NSDictionary?
        let done = expectation(description: "info")
        bridge.getNativeInfo { info = $0; done.fulfill() }
        wait(for: [done], timeout: 5)

        let dict = try XCTUnwrap(info as? [String: Any])
        XCTAssertEqual(dict["platform"] as? String, "ios")
        XCTAssertEqual(dict["isInitialized"] as? Bool, true)
        XCTAssertEqual((dict["nativeSdkVersion"] as? String)?.hasPrefix("1.1."), true)
        XCTAssertNotNil(dict["isPresenting"] as? Bool)
    }

    func testGetPendingResultIsNullWhenNothingIsBuffered() {
        var called = false
        var value: NSDictionary?
        let done = expectation(description: "pending")
        bridge.getPendingResult { value = $0; called = true; done.fulfill() }
        wait(for: [done], timeout: 5)
        XCTAssertTrue(called)
        XCTAssertNil(value)
    }

    func testNotifyReturnedFromBankPostsTheNativeNotification() {
        let done = expectation(
            forNotification: PaymentSheet.paymentReturnedFromBank, object: nil, handler: nil
        )
        bridge.notifyReturnedFromBank()
        wait(for: [done], timeout: 5)
    }

    func testCancelWithNothingPresentedCompletesWithoutThrowing() {
        let done = expectation(description: "cancel")
        bridge.cancelPaymentSheet { done.fulfill() }
        wait(for: [done], timeout: 5)
    }

    // MARK: - Merchant cancel before the sheet exists (audit-3 items 4, 5, 6)

    /// Captures `uqpay_tokenRequested` so a test can answer the token broker
    /// itself. Hermetic: every path below settles before any network call.
    private func listenForTokenRequests(_ onRequest: @escaping (String) -> Void) {
        bridge.setEventSink { name, body in
            guard name as String == UqpayEvents.tokenRequested,
                  let requestId = body["requestId"] as? String
            else { return }
            onRequest(requestId)
        }
        bridge.setListening(true)
    }

    override func tearDown() {
        bridge.setListening(false)
        bridge.setEventSink(nil)
        super.tearDown()
    }

    /// Starts a present, waits until it is parked on the token broker, and
    /// returns the request id plus a way to wait for the present's result.
    private func startPresentAwaitingToken(
        _ options: NSDictionary? = nil
    ) -> (requestId: String, result: () -> [String: Any]?) {
        var requestId: String?
        let requested = expectation(description: "token requested")
        listenForTokenRequests { id in requestId = id; requested.fulfill() }
        var result: NSDictionary?
        let settled = expectation(description: "present settles")
        bridge.presentPaymentSheet(
            options ?? validOptions,
            onResult: { result = $0; settled.fulfill() },
            onError: { _, _ in settled.fulfill() }
        )
        wait(for: [requested], timeout: 5)
        return (requestId ?? "", {
            self.wait(for: [settled], timeout: 5)
            return result as? [String: Any]
        })
    }

    private func cancel() {
        let done = expectation(description: "cancel")
        bridge.cancelPaymentSheet { done.fulfill() }
        wait(for: [done], timeout: 5)
    }

    private func nativeInfo() -> [String: Any] {
        var info: NSDictionary?
        let done = expectation(description: "info")
        bridge.getNativeInfo { info = $0; done.fulfill() }
        wait(for: [done], timeout: 5)
        return (info as? [String: Any]) ?? [:]
    }

    /// Before: the cancel was a no-op here and the sheet appeared anyway.
    func testACancelDuringTheTokenFetchSettlesMerchantCancelledWithoutPresenting() throws {
        let present = startPresentAwaitingToken()
        XCTAssertEqual(nativeInfo()["isPresenting"] as? Bool, true)

        cancel()
        bridge.provideToken(present.requestId, authToken: "tok_test_value", expiresAtEpochMs: 0)

        let result = try XCTUnwrap(present.result())
        XCTAssertEqual(result["kind"] as? String, "canceled")
        XCTAssertEqual(result["reason"] as? String, "merchant_cancelled")
        XCTAssertEqual(result["paymentIntentId"] as? String, "pi_matrix_0001")
        XCTAssertNil(result["error"])
        XCTAssertEqual(nativeInfo()["isPresenting"] as? Bool, false)
        XCTAssertNotEqual(
            UqpayConfiguration.shared.headerToken, "tok_test_value",
            "a cancelled present never hands the token to the SDK"
        )
    }

    func testAMerchantCancelDoesNotLeakIntoTheNextPresent() throws {
        let first = startPresentAwaitingToken()
        cancel()
        bridge.failToken(first.requestId, developerMessage: "provider down")
        XCTAssertEqual(try XCTUnwrap(first.result())["kind"] as? String, "canceled")

        let second = startPresentAwaitingToken()
        bridge.failToken(second.requestId, developerMessage: "provider down")
        let result = try XCTUnwrap(second.result())
        XCTAssertEqual(result["kind"] as? String, "failed", "the earlier cancel must not apply here")
        XCTAssertEqual((result["error"] as? [String: Any])?["code"] as? String, "authentication_failed")
    }

    func testACancelWithNothingPresentingDoesNotCancelTheNextPresent() throws {
        cancel()
        let present = startPresentAwaitingToken()
        bridge.failToken(present.requestId, developerMessage: "provider down")
        let result = try XCTUnwrap(present.result())
        XCTAssertEqual(result["kind"] as? String, "failed")
    }

    /// Security hygiene: once a present has settled and nothing is
    /// reconciling, the merchant token does not linger in the SDK singleton.
    func testTheHeaderTokenIsClearedOnceThePresentHasSettled() throws {
        UqpayConfiguration.shared.headerToken = "tok_left_over"
        let present = startPresentAwaitingToken()
        bridge.failToken(present.requestId, developerMessage: "provider down")
        _ = try XCTUnwrap(present.result())
        XCTAssertNil(UqpayConfiguration.shared.headerToken)
    }
}
