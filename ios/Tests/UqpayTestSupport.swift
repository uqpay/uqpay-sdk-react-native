//
//  UqpayTestSupport.swift
//  uqpay-react-native bridge contract tests (AC RN-TEST5)
//

import Foundation
import XCTest

@testable import uqpay_react_native

/// Loads a JSON fixture that `yarn errors:sync` copied into `ios/Tests/Fixtures`
/// from `src/errors/table.ts` / `src/__tests__/fixtures/scenarios.ts`. Reading
/// the *generated* file is what makes the drift test meaningful (AC RN-PAR3).
enum UqpayFixtures {

    static func json(named name: String, file: StaticString = #filePath, line: UInt = #line) throws
        -> [String: Any]
    {
        let bundle = Bundle(for: UqpayFixtureAnchor.self)
        var candidates: [URL] = []
        if let url = bundle.url(forResource: name, withExtension: "json") {
            candidates.append(url)
        }
        // CocoaPods may stage test-spec resources in a nested bundle.
        for nested in (bundle.urls(forResourcesWithExtension: "bundle", subdirectory: nil) ?? []) {
            if let inner = Bundle(url: nested)?.url(forResource: name, withExtension: "json") {
                candidates.append(inner)
            }
        }
        guard let url = candidates.first else {
            XCTFail("fixture \(name).json is missing from the test bundle", file: file, line: line)
            throw CocoaError(.fileNoSuchFile)
        }
        let data = try Data(contentsOf: url)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            XCTFail("fixture \(name).json is not a JSON object", file: file, line: line)
            throw CocoaError(.propertyListReadCorrupt)
        }
        return object
    }

    /// `error-table.json` rows, as written by `yarn errors:sync`.
    static func errorTableRows() throws -> [[String: Any]] {
        (try json(named: "error-table")["rows"] as? [[String: Any]]) ?? []
    }

    /// `scenarios.json` entries, keyed by id.
    static func scenarios() throws -> [String: [String: Any]] {
        let list = (try json(named: "scenarios")["scenarios"] as? [[String: Any]]) ?? []
        return Dictionary(uniqueKeysWithValues: list.compactMap { entry -> (String, [String: Any])? in
            guard let id = entry["id"] as? String else { return nil }
            return (id, entry)
        })
    }

    /// The `native.ios` payload of one scenario.
    static func iosPayload(_ id: String) throws -> [String: Any] {
        let scenario = try scenarios()[id]
        return (scenario?["native"] as? [String: Any])?["ios"] as? [String: Any] ?? [:]
    }
}

/// Anchor class so `Bundle(for:)` resolves the test bundle.
final class UqpayFixtureAnchor: NSObject {}

// MARK: - Assertions

/// Compares a bridge-produced result against a shared-fixture payload.
///
/// Two fields are read leniently, by agreement with builder-js:
///  * `resultId` — a fresh UUID per result by design (AC RN-CB1);
///  * `status` — optional on `pending` (and informational elsewhere), so a
///    fixture that omits it does not pin the native's `lastKnownStatus`.
///    When the fixture *does* carry a status, it is compared.
func UqpayAssertResult(
    _ actual: [String: Any],
    matches expected: [String: Any],
    file: StaticString = #filePath,
    line: UInt = #line
) {
    var lhs = actual
    var rhs = expected
    lhs["resultId"] = nil
    rhs["resultId"] = nil
    if rhs["status"] == nil { lhs["status"] = nil }
    XCTAssertEqual(
        lhs as NSDictionary, rhs as NSDictionary,
        "produced \(lhs) but expected \(rhs)", file: file, line: line
    )
}

// MARK: - Fakes

/// Deterministic stand-in for `UqpayQueueTimerScheduler`: nothing fires until a
/// test says so, so the 10 s token budget and the 75 s reconciliation window can
/// be exercised in microseconds.
final class UqpayFakeScheduler: UqpayTimerScheduler {

    final class Scheduled: UqpayCancelableTimer {
        let delay: TimeInterval
        let work: () -> Void
        private(set) var isCancelled = false
        init(delay: TimeInterval, work: @escaping () -> Void) {
            self.delay = delay
            self.work = work
        }
        func cancel() { isCancelled = true }
    }

    private(set) var scheduled: [Scheduled] = []

    func schedule(after seconds: TimeInterval, _ work: @escaping () -> Void) -> UqpayCancelableTimer {
        let item = Scheduled(delay: seconds, work: work)
        scheduled.append(item)
        return item
    }

    /// Fires every live timer whose delay is at least `after`.
    func fire(after: TimeInterval = 0) {
        let due = scheduled.filter { !$0.isCancelled && $0.delay >= after }
        scheduled = scheduled.filter { item in !due.contains { $0 === item } }
        for item in due { item.work() }
    }

    var liveCount: Int { scheduled.filter { !$0.isCancelled }.count }
}
