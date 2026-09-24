//
//  UqpayPendingBufferTests.swift
//  AC RN-TEST5, RN-CB6, RN-CB1
//

import XCTest

@testable import uqpay_react_native

final class UqpayPendingBufferTests: XCTestCase {

    private func result(_ intentId: String, kind: String = "completed") -> [String: Any] {
        UqpayResultEncoder.encode(
            kind: UqpayResultKind(rawValue: kind) ?? .completed,
            paymentIntentId: intentId,
            status: "SUCCEEDED"
        )
    }

    func testTakeReturnsTheResultAndClearsIt() {
        let buffer = UqpayPendingBuffer()
        XCTAssertTrue(buffer.isEmpty)
        buffer.store(result("pi_1"))
        XCTAssertFalse(buffer.isEmpty)

        let first = buffer.take()
        XCTAssertEqual(first?["paymentIntentId"] as? String, "pi_1")

        // Exactly once: a second `getPendingResult()` must return null.
        XCTAssertNil(buffer.take())
        XCTAssertTrue(buffer.isEmpty)
    }

    func testTakeForIntentIdReturnsABufferedResultForTheSameIntent() {
        let buffer = UqpayPendingBuffer()
        buffer.store(result("pi_1"))

        XCTAssertNotNil(buffer.take(forIntentId: "pi_1"))
        XCTAssertTrue(buffer.isEmpty)
    }

    func testTakeForIntentIdLeavesAResultForADifferentIntentAlone() {
        let buffer = UqpayPendingBuffer()
        buffer.store(result("pi_1"))

        XCTAssertNil(buffer.take(forIntentId: "pi_other"))
        XCTAssertFalse(buffer.isEmpty)
        XCTAssertEqual(buffer.bufferedIntentId, "pi_1")
    }

    func testANewerResultReplacesAnOlderOne() {
        let buffer = UqpayPendingBuffer()
        buffer.store(result("pi_1"))
        buffer.store(result("pi_2"))
        XCTAssertEqual(buffer.take()?["paymentIntentId"] as? String, "pi_2")
    }

    func testClearEmptiesTheBuffer() {
        let buffer = UqpayPendingBuffer()
        buffer.store(result("pi_1"))
        buffer.clear()
        XCTAssertNil(buffer.take())
    }
}
