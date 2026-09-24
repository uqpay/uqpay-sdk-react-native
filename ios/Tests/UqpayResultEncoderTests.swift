//
//  UqpayResultEncoderTests.swift
//  AC RN-TEST5, RN-PAR5, RN-FLOW5, RN-BR3
//

import XCTest
import UqpayPaymentSheet

@testable import uqpay_react_native

final class UqpayResultEncoderTests: XCTestCase {

    // MARK: - Amount scale (RN-FLOW5)

    func testAmountIsRenderedAtTheCurrencyScale() {
        let cases: [(String, String, String)] = [
            // currency, decimal literal, expected wire string
            ("JPY", "10", "10"),
            ("JPY", "1000", "1000"),
            ("KRW", "12345", "12345"),
            ("VND", "250000", "250000"),
            ("USD", "10", "10.00"),
            ("USD", "8.98", "8.98"),
            ("SGD", "10.00", "10.00"),
            ("sgd", "10", "10.00"),
            ("EUR", "19.99", "19.99"),
            ("KWD", "1.5", "1.500"),
            ("BHD", "2", "2.000"),
            ("OMR", "0.125", "0.125"),
            ("JOD", "7.25", "7.250"),
            ("CLF", "1.5", "1.5000"),
            ("ZZZ", "3.1", "3.10"),
            ("USD", "-4.5", "-4.50"),
        ]
        for (currency, literal, expected) in cases {
            let decimal = Decimal(string: literal)
            XCTAssertEqual(
                UqpayResultEncoder.amountString(decimal, currency: currency),
                expected,
                "\(literal) \(currency)"
            )
        }
    }

    func testMinorUnitsTableAndDefault() {
        XCTAssertEqual(UqpayResultEncoder.minorUnits(for: "JPY"), 0)
        XCTAssertEqual(UqpayResultEncoder.minorUnits(for: "KWD"), 3)
        XCTAssertEqual(UqpayResultEncoder.minorUnits(for: "CLF"), 4)
        XCTAssertEqual(UqpayResultEncoder.minorUnits(for: "usd"), 2)
        XCTAssertEqual(UqpayResultEncoder.minorUnits(for: "WHATEVER"), 2)
        XCTAssertEqual(UqpayResultEncoder.minorUnits(for: ""), 2)
    }

    func testNilAmountRendersNothing() {
        XCTAssertNil(UqpayResultEncoder.amountString(nil, currency: "USD"))
    }

    // MARK: - Date (RN-PAR5)

    func testCompletedAtIsIso8601WithFractionalSecondsInUTC() {
        let date = Date(timeIntervalSince1970: 1_758_449_730.25)
        let rendered = UqpayResultEncoder.iso8601(date)
        XCTAssertTrue(rendered.hasSuffix("Z"), rendered)
        XCTAssertTrue(rendered.contains("."), rendered)
        XCTAssertEqual(rendered, "2025-09-21T10:15:30.250Z")
    }

    // MARK: - Status names (RN-BR3)

    func testPaymentStatusIsMappedByCaseName() {
        XCTAssertEqual(UqpayResultEncoder.statusName(.succeeded), "SUCCEEDED")
        XCTAssertEqual(UqpayResultEncoder.statusName(.failed), "FAILED")
        XCTAssertEqual(UqpayResultEncoder.statusName(.cancelled), "CANCELLED")
        XCTAssertEqual(UqpayResultEncoder.statusName(.requiresAction), "REQUIRES_CUSTOMER_ACTION")
        XCTAssertEqual(UqpayResultEncoder.statusName(.processing), "PROCESSING")
        XCTAssertEqual(UqpayResultEncoder.statusName(.pending), "PENDING")
    }

    // MARK: - `transactionId` fallback

    func testTransactionIdIsOmittedWhenItEqualsTheIntentId() {
        let result = PaymentResult(
            paymentIntentId: "pi_1",
            paymentMethodType: "card",
            status: .succeeded,
            amount: 0,
            currency: "SGD",
            transactionId: "pi_1",
            amountDecimal: Decimal(string: "10")
        )
        let encoded = UqpayResultEncoder.encode(result: result, kind: .completed)
        XCTAssertNil(encoded["transactionId"])
    }

    func testTransactionIdIsKeptWhenItIsARealAttemptId() {
        let result = PaymentResult(
            paymentIntentId: "pi_1",
            paymentMethodType: "card",
            status: .succeeded,
            amount: 0,
            currency: "SGD",
            transactionId: "pa_0001",
            amountDecimal: Decimal(string: "10")
        )
        let encoded = UqpayResultEncoder.encode(result: result, kind: .completed)
        XCTAssertEqual(encoded["transactionId"] as? String, "pa_0001")
    }

    // MARK: - Pending with an unknown outcome

    /// `amountDecimal == nil && currency == ""` is the SDK's signature for a
    /// confirm whose outcome it does not know (spike S2, lead decision S2-2).
    func testPendingWithNoAmountOmitsAmountAndCurrencyAndCarriesTimeout() throws {
        let result = PaymentResult(
            paymentIntentId: "pi_matrix_0001",
            paymentMethodType: "card",
            status: .pending,
            amount: 0,
            currency: "",
            transactionId: "pi_matrix_0001",
            amountDecimal: nil
        )
        let encoded = UqpayResultEncoder.encodePending(result: result)

        XCTAssertEqual(encoded["kind"] as? String, "pending")
        XCTAssertNil(encoded["amount"], "a mid-confirm dismissal must never report \"0\"")
        XCTAssertNil(encoded["currency"])
        XCTAssertNil(encoded["transactionId"])

        let error = try XCTUnwrap(encoded["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "timeout")
        XCTAssertEqual(error["isOutcomeUnknown"] as? Bool, true)
    }

    func testPendingWithARealAmountCarriesNoCause() throws {
        let result = PaymentResult(
            paymentIntentId: "pi_1",
            paymentMethodType: "grabpay",
            status: .pending,
            amount: 0,
            currency: "SGD",
            transactionId: "pi_1",
            amountDecimal: Decimal(string: "12.5")
        )
        let encoded = UqpayResultEncoder.encodePending(result: result)
        XCTAssertEqual(encoded["amount"] as? String, "12.50")
        XCTAssertEqual(encoded["currency"] as? String, "SGD")
        XCTAssertNil(encoded["error"])
        XCTAssertEqual(encoded["status"] as? String, "PENDING")
    }

    // MARK: - Envelope

    func testEveryResultCarriesPlatformAndAUniqueResultId() {
        let first = UqpayResultEncoder.encode(kind: .canceled, paymentIntentId: "pi_1", reason: .userCancelled)
        let second = UqpayResultEncoder.encode(kind: .canceled, paymentIntentId: "pi_1", reason: .userCancelled)
        XCTAssertEqual(first["platform"] as? String, "ios")
        XCTAssertEqual(first["reason"] as? String, "user_cancelled")
        XCTAssertNotEqual(first["resultId"] as? String, second["resultId"] as? String)
    }

    // MARK: - Parity with the shared RN-TEST3 fixtures

    func testWalletSuccessMatchesTheSharedScenarioFixture() throws {
        let expected = try UqpayFixtures.iosPayload("wallet_success")
        let result = PaymentResult(
            paymentIntentId: "pi_matrix_0001",
            paymentMethodType: "grabpay",
            status: .succeeded,
            amount: 0,
            currency: "JPY",
            merchantOrderId: "order-7",
            completedAt: Date(timeIntervalSince1970: 0),
            transactionId: "pa_0001",
            amountDecimal: Decimal(string: "1000")
        )
        let encoded = UqpayResultEncoder.encode(result: result, kind: .completed, forcedStatus: "SUCCEEDED")
        XCTAssertEqual(encoded["amount"] as? String, expected["amount"] as? String)
        XCTAssertEqual(encoded["currency"] as? String, expected["currency"] as? String)
        XCTAssertEqual(encoded["paymentMethodType"] as? String, expected["paymentMethodType"] as? String)
        XCTAssertEqual(encoded["transactionId"] as? String, expected["transactionId"] as? String)
        XCTAssertEqual(encoded["kind"] as? String, expected["kind"] as? String)
        XCTAssertEqual(encoded["status"] as? String, expected["status"] as? String)
    }

    func testSuccessMatchesTheSharedScenarioFixture() throws {
        let expected = try UqpayFixtures.iosPayload("success")
        let result = PaymentResult(
            paymentIntentId: "pi_matrix_0001",
            paymentMethodType: "card",
            status: .succeeded,
            amount: 0,
            currency: "SGD",
            merchantOrderId: "order-7",
            transactionId: "pa_0001",
            amountDecimal: Decimal(string: "10")
        )
        let encoded = UqpayResultEncoder.encode(result: result, kind: .completed, forcedStatus: "SUCCEEDED")
        XCTAssertEqual(encoded["amount"] as? String, expected["amount"] as? String)
        XCTAssertEqual(encoded["merchantOrderId"] as? String, expected["merchantOrderId"] as? String)
        XCTAssertEqual(encoded["platform"] as? String, "ios")
    }
}
