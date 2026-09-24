//
//  UqpayErrorMapperTests.swift
//  AC RN-TEST5, RN-PAR3, RN-ERR1, RN-ERR5, RN-SEC1
//

import XCTest
import UqpayCore
import UqpayPaymentSheet

@testable import uqpay_react_native

final class UqpayErrorMapperTests: XCTestCase {

    /// Every canonical code iOS can produce, with the native input that produces
    /// it. Keyed by the code the table names.
    private static let producers: [String: () -> [String: Any]] = [
        "card_declined": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .cardDeclined, message: "issuer declined", declineCode: "do_not_honor"
            ))
        },
        "insufficient_funds": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .insufficientFunds, message: "issuer declined for funds"
            ))
        },
        "invalid_payment_method": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .invalidPaymentMethod, message: "the payment method was rejected"
            ))
        },
        "3ds_failed": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .threeDSFailed, message: "server rejected the 3DS outcome"
            ))
        },
        "cancelled": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .cancelled, message: "the payment was cancelled"
            ))
        },
        "authentication_failed": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .authenticationFailed,
                message: "the gateway rejected the auth token",
                underlyingError: UqpayAPIError.api(
                    status: 401, body: UqpayAPIErrorBody(code: "", type: "", message: "")
                )
            ))
        },
        "invalid_configuration": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .invalidConfiguration, message: "the SDK was not configured"
            ))
        },
        "not_initialized": {
            UqpayErrorMapper.bridgeError(
                code: "not_initialized", developerMessage: "call init() first"
            )
        },
        "invalid_request": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .invalidPaymentMethod,
                message: "gateway rejected the intent",
                underlyingError: UqpayAPIError.api(
                    status: 422, body: UqpayAPIErrorBody(code: "", type: "", message: "")
                )
            ))
        },
        "network_error": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .networkError, message: "could not reach the gateway"
            ))
        },
        "timeout": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .timeout, message: "the poll ran out of attempts"
            ))
        },
        "server_error": {
            UqpayErrorMapper.mapLoadFailure(
                underlying: UqpayAPIError.unexpectedStatus(status: 503, responseBody: nil),
                message: "GET intent returned 503"
            )
        },
        "intent_not_payable": {
            UqpayErrorMapper.bridgeError(
                code: "intent_not_payable", developerMessage: "intent status FAILED"
            )
        },
        "unknown": {
            UqpayErrorMapper.map(paymentError: PaymentError(
                code: .unknown, message: "the SDK reported an unclassified failure"
            ))
        },
    ]

    // MARK: - Drift against the generated table (RN-PAR3)

    func testEveryIosReachableTableRowIsProducedByTheMapper() throws {
        let rows = try UqpayFixtures.errorTableRows()
        XCTAssertFalse(rows.isEmpty, "error-table.json has no rows")

        for row in rows {
            let code = try XCTUnwrap(row["code"] as? String)
            let platforms = (row["platforms"] as? [String]) ?? []
            guard platforms.contains("ios") else { continue }

            let producer = try XCTUnwrap(
                Self.producers[code],
                "no iOS producer is registered for reachable code `\(code)`"
            )
            let produced = producer()
            XCTAssertEqual(produced["code"] as? String, code)
            XCTAssertNotNil(produced["developerMessage"] as? String)
            XCTAssertNotNil(produced["isOutcomeUnknown"] as? Bool)
        }
    }

    func testTableAndMapperAgreeOnTheCanonicalCodeSet() throws {
        let rows = try UqpayFixtures.errorTableRows()
        let tableCodes = Set(rows.compactMap { $0["code"] as? String })
        XCTAssertEqual(tableCodes, UqpayCanonicalCode.all)
    }

    func testTimeoutIsOutcomeUnknownOnBothSides() throws {
        let rows = try UqpayFixtures.errorTableRows()
        let timeoutRow = try XCTUnwrap(rows.first { $0["code"] as? String == "timeout" })
        XCTAssertEqual(timeoutRow["isOutcomeUnknown"] as? Bool, true)

        let produced = try XCTUnwrap(Self.producers["timeout"])()
        XCTAssertEqual(produced["isOutcomeUnknown"] as? Bool, true)
    }

    // MARK: - `underlyingError` derivation (spike S2)

    func testApi422UnderInvalidPaymentMethodDerivesInvalidRequest() {
        let mapped = UqpayErrorMapper.map(paymentError: PaymentError(
            code: .invalidPaymentMethod,
            message: "gateway rejected the intent",
            underlyingError: UqpayAPIError.api(
                status: 422, body: UqpayAPIErrorBody(code: "", type: "", message: "")
            )
        ))
        XCTAssertEqual(mapped["code"] as? String, "invalid_request")
        XCTAssertEqual(mapped["httpStatus"] as? Int, 422)
        XCTAssertNil(mapped["raw"])
    }

    func testApi400WithInvalidPaymentMethodCodeStaysInvalidPaymentMethod() {
        let mapped = UqpayErrorMapper.map(paymentError: PaymentError(
            code: .invalidPaymentMethod,
            message: "the card was not usable",
            underlyingError: UqpayAPIError.api(
                status: 400,
                body: UqpayAPIErrorBody(code: "invalid_payment_method", type: "", message: "")
            ),
            declineCode: "invalid_payment_method"
        ))
        XCTAssertEqual(mapped["code"] as? String, "invalid_payment_method")
        XCTAssertEqual(mapped["httpStatus"] as? Int, 400)
        XCTAssertEqual(mapped["declineCode"] as? String, "invalid_payment_method")
    }

    func testApi401IsAuthenticationFailedAndKeepsTheStatus() {
        let mapped = UqpayErrorMapper.map(paymentError: PaymentError(
            code: .authenticationFailed,
            message: "the gateway rejected the auth token",
            underlyingError: UqpayAPIError.api(
                status: 401, body: UqpayAPIErrorBody(code: "", type: "", message: "")
            )
        ))
        XCTAssertEqual(mapped["code"] as? String, "authentication_failed")
        XCTAssertEqual(mapped["httpStatus"] as? Int, 401)
    }

    /// Lead's go/no-go decision on S2-1: only 400/404/422 become
    /// `invalid_request`; everything else definitive stays `unknown` with the
    /// status preserved.
    func testOtherDefinitiveFourXxStaysUnknownWithTheStatus() {
        let mapped = UqpayErrorMapper.map(paymentError: PaymentError(
            code: .unknown,
            message: "the gateway refused the request",
            underlyingError: UqpayAPIError.unexpectedStatus(status: 409, responseBody: nil)
        ))
        XCTAssertEqual(mapped["code"] as? String, "unknown")
        XCTAssertEqual(mapped["httpStatus"] as? Int, 409)
        XCTAssertEqual(mapped["raw"] as? String, "unknown")
    }

    // MARK: - Load path

    func testUnexpectedStatus503OnTheLoadPathIsServerError() throws {
        let mapped = UqpayErrorMapper.mapLoadFailure(
            underlying: UqpayAPIError.unexpectedStatus(status: 503, responseBody: nil),
            message: "GET intent returned 503"
        )
        XCTAssertEqual(mapped["code"] as? String, "server_error")
        XCTAssertEqual(mapped["httpStatus"] as? Int, 503)
        XCTAssertEqual(mapped["isOutcomeUnknown"] as? Bool, false)

        // …and it is the shape the shared RN-TEST3 fixture expects.
        let fixture = try UqpayFixtures.iosPayload("server_5xx_load")
        let expected = try XCTUnwrap(fixture["error"] as? [String: Any])
        XCTAssertEqual(mapped["code"] as? String, expected["code"] as? String)
        XCTAssertEqual(mapped["httpStatus"] as? Int, expected["httpStatus"] as? Int)
    }

    func testLoadPath429IsServerError() {
        let mapped = UqpayErrorMapper.mapLoadFailure(
            underlying: UqpayAPIError.unexpectedStatus(status: 429, responseBody: nil),
            message: "rate limited"
        )
        XCTAssertEqual(mapped["code"] as? String, "server_error")
    }

    func testLoadPathTransportIsNetworkError() {
        let mapped = UqpayErrorMapper.mapLoadFailure(
            underlying: UqpayAPIError.transport(underlying: URLError(.networkConnectionLost)),
            message: "could not reach the gateway"
        )
        XCTAssertEqual(mapped["code"] as? String, "network_error")
    }

    func testLoadPathURLErrorTimedOutIsTimeout() {
        let mapped = UqpayErrorMapper.mapLoadFailure(
            underlying: URLError(.timedOut), message: "the request timed out"
        )
        XCTAssertEqual(mapped["code"] as? String, "timeout")
        XCTAssertEqual(mapped["isOutcomeUnknown"] as? Bool, true)
    }

    /// `ApiClient.getPaymentIntentById` throws a bare `NSError` in the
    /// "UqpayAPIError" domain whose code is the HTTP status.
    func testLoadPathNSErrorFromThePreReadMapsTheStatus() {
        let mapped = UqpayErrorMapper.mapLoadFailure(
            underlying: NSError(domain: "UqpayAPIError", code: 503),
            message: "intent lookup failed"
        )
        XCTAssertEqual(mapped["code"] as? String, "server_error")
        XCTAssertEqual(mapped["httpStatus"] as? Int, 503)
    }

    /// No error object at all: the bridge must **not** string-sniff the
    /// localised "Request failed with status %d." prose (spike S2).
    func testLoadPathWithoutAnUnderlyingErrorIsUnknownWithRaw() {
        let mapped = UqpayErrorMapper.mapLoadFailure(
            underlying: nil, message: "Request failed with status 503."
        )
        XCTAssertEqual(mapped["code"] as? String, "unknown")
        XCTAssertEqual(mapped["raw"] as? String, "PaymentSheetError.failed")
        XCTAssertNil(mapped["httpStatus"])
    }

    // MARK: - Unknown passthrough (RN-ERR5)

    func testUnknownNativeRawCodePassesThroughWithRaw() {
        let mapped = UqpayErrorMapper.map(
            rawCode: "quantum_flux",
            message: "native SDK reported quantum_flux",
            underlyingError: nil,
            declineCode: nil
        )
        XCTAssertEqual(mapped["code"] as? String, "quantum_flux")
        XCTAssertEqual(mapped["raw"] as? String, "quantum_flux")
        XCTAssertFalse(UqpayCanonicalCode.all.contains("quantum_flux"))
    }

    func testBlankCodeBecomesUnknown() {
        let mapped = UqpayErrorMapper.nativeError(code: "", developerMessage: "nothing to go on")
        XCTAssertEqual(mapped["code"] as? String, "unknown")
    }

    // MARK: - Redaction (RN-SEC1, RN-SEC7)

    func testDeveloperMessageIsScrubbedOfCardNumbersAndTokens() {
        let mapped = UqpayErrorMapper.nativeError(
            code: "card_declined",
            developerMessage: "declined for 4111 1111 1111 1111 with Bearer abcdef0123456789"
        )
        let message = try? XCTUnwrap(mapped["developerMessage"] as? String)
        XCTAssertNotNil(message)
        XCTAssertFalse(message?.contains("4111") ?? true)
        XCTAssertFalse(message?.contains("abcdef0123456789") ?? true)
    }

    func testDeveloperMessageIsLengthCapped() {
        let long = String(repeating: "a", count: 5000)
        let mapped = UqpayErrorMapper.nativeError(code: "unknown", developerMessage: long)
        let message = (mapped["developerMessage"] as? String) ?? ""
        XCTAssertLessThanOrEqual(message.count, UqpayRedactor.maxLength + 1)
    }
}
