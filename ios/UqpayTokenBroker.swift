//
//  UqpayTokenBroker.swift
//  uqpay-react-native
//
//  Turns "the bridge needs a merchant auth token" into a `uqpay_tokenRequested`
//  event and back into a value, with a hard 10 s budget (bridge-contract §2,
//  AC RN-BR6, RN-ERR8, RN-PAR6, RN-SEC7).
//
//  Everything runs on the bridge's serial queue — **never** main — so a merchant
//  `tokenProvider` that hangs cannot block the UI thread. The broker itself
//  keeps the token only until it hands it to the waiting present, and never
//  logs it. The bridge then writes it to `UqpayConfiguration.shared.headerToken`
//  (the SDK reads every request's auth header from there) and clears it once
//  the present has settled and no `pending` reconciliation still needs it
//  (`UqpayBridge.clearTokenIfIdle`).
//

import Foundation

/// What went wrong while asking JavaScript for a token.
enum UqpayTokenFailure: Error {
    case timedOut
    case blank
    case providerFailed(String)

    var developerMessage: String {
        switch self {
        case .timedOut:
            return "The `tokenProvider` passed to `init()` did not return within 10 seconds."
        case .blank:
            return "The `tokenProvider` passed to `init()` returned an empty auth token."
        case .providerFailed(let detail):
            return "The `tokenProvider` passed to `init()` failed: \(detail)"
        }
    }
}

// MARK: - Injectable timer

protocol UqpayCancelableTimer: AnyObject {
    func cancel()
}

/// Seam so the 10 s timeout can be tested without waiting 10 s.
protocol UqpayTimerScheduler {
    func schedule(after seconds: TimeInterval, _ work: @escaping () -> Void) -> UqpayCancelableTimer
}

final class UqpayQueueTimerScheduler: UqpayTimerScheduler {
    private let queue: DispatchQueue

    init(queue: DispatchQueue) { self.queue = queue }

    final class Timer: UqpayCancelableTimer {
        let item: DispatchWorkItem
        init(_ item: DispatchWorkItem) { self.item = item }
        func cancel() { item.cancel() }
    }

    func schedule(after seconds: TimeInterval, _ work: @escaping () -> Void) -> UqpayCancelableTimer {
        let item = DispatchWorkItem(block: work)
        queue.asyncAfter(deadline: .now() + seconds, execute: item)
        return Timer(item)
    }
}

// MARK: - Broker

final class UqpayTokenBroker {

    typealias Completion = (Result<String, UqpayTokenFailure>) -> Void

    static let timeoutSeconds: TimeInterval = 10

    private struct Waiter {
        let completion: Completion
        let timer: UqpayCancelableTimer
        let reason: String
        var emitted: Bool
    }

    private let scheduler: UqpayTimerScheduler
    private let timeout: TimeInterval
    private var waiters: [String: Waiter] = [:]

    /// Emits the `uqpay_tokenRequested` event. Returns `false` when no JS
    /// listener is attached yet, in which case the request is parked and
    /// re-emitted by `listenersDidAttach()`.
    var emit: ((_ requestId: String, _ reason: String) -> Bool)?

    init(
        scheduler: UqpayTimerScheduler,
        timeout: TimeInterval = UqpayTokenBroker.timeoutSeconds
    ) {
        self.scheduler = scheduler
        self.timeout = timeout
    }

    var pendingCount: Int { waiters.count }

    /// Asks JavaScript for a token. `completion` is always called exactly once,
    /// on the bridge queue.
    @discardableResult
    func request(reason: String, completion: @escaping Completion) -> String {
        let requestId = UUID().uuidString
        let timer = scheduler.schedule(after: timeout) { [weak self] in
            self?.finish(requestId: requestId, with: .failure(.timedOut))
        }
        let emitted = emit?(requestId, reason) ?? false
        waiters[requestId] = Waiter(
            completion: completion, timer: timer, reason: reason, emitted: emitted
        )
        return requestId
    }

    /// JS answered. A blank token is a provider failure, not a token.
    func provide(requestId: String, authToken: String) {
        let trimmed = authToken.trimmingCharacters(in: .whitespacesAndNewlines)
        finish(requestId: requestId, with: trimmed.isEmpty ? .failure(.blank) : .success(trimmed))
    }

    /// JS's provider threw or rejected.
    func fail(requestId: String, developerMessage: String) {
        finish(requestId: requestId, with: .failure(.providerFailed(developerMessage)))
    }

    /// A JS listener attached after a request was already parked (the process
    /// relaunched, or `init()` had not run yet). Re-emit so the waiter can still
    /// be answered inside its remaining budget.
    func listenersDidAttach() {
        for (requestId, waiter) in waiters where !waiter.emitted {
            if emit?(requestId, waiter.reason) == true {
                waiters[requestId]?.emitted = true
            }
        }
    }

    /// Fails every outstanding waiter. Used when the module is invalidated.
    func cancelAll(developerMessage: String) {
        for requestId in waiters.keys {
            finish(requestId: requestId, with: .failure(.providerFailed(developerMessage)))
        }
    }

    private func finish(requestId: String, with result: Result<String, UqpayTokenFailure>) {
        guard let waiter = waiters.removeValue(forKey: requestId) else { return }
        waiter.timer.cancel()
        waiter.completion(result)
    }
}
