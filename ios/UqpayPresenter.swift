//
//  UqpayPresenter.swift
//  uqpay-react-native
//
//  Finds the view controller the sheet must be presented from and performs the
//  present/dismiss, always on the main thread (AC RN-BR2, RN-BR4, RN-UX12,
//  RN-CB8).
//
//  The walk is written against UIKit only — no React import — so it is unit
//  testable and so the Swift half of the bridge has no React dependency at all.
//  It is the same key-window walk `RCTPresentedViewController()` performs
//  internally, and RN-BR2 allows either.
//

import Foundation
import UIKit

enum UqpayPresenter {

    // MARK: - Finding the presenter

    /// Walks `presentedViewController` from `root` to the top-most controller
    /// that can present. Skips a controller that is on its way out, so a sheet
    /// is never presented from a dying parent (which silently does nothing).
    static func topMostViewController(from root: UIViewController?) -> UIViewController? {
        var current = root
        while let presented = current?.presentedViewController, !presented.isBeingDismissed {
            current = presented
        }
        return current
    }

    /// The key window's root view controller, preferring a foreground-active
    /// scene. Must be called on the main thread.
    @MainActor
    static func keyWindowRootViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let ordered = scenes.sorted { lhs, rhs in
            rank(lhs.activationState) < rank(rhs.activationState)
        }
        for scene in ordered {
            if let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController {
                return root
            }
            if let root = scene.windows.first(where: { !$0.isHidden })?.rootViewController {
                return root
            }
        }
        return nil
    }

    private static func rank(_ state: UIScene.ActivationState) -> Int {
        switch state {
        case .foregroundActive: return 0
        case .foregroundInactive: return 1
        case .background: return 2
        case .unattached: return 3
        @unknown default: return 4
        }
    }

    /// The controller a payment sheet should be presented from, or `nil` when
    /// the app has no window (backgrounded, or a scene being rebuilt) — which
    /// resolves `failed` / `invalid_configuration`, never a crash (RN-CB8).
    @MainActor
    static func presentingViewController() -> UIViewController? {
        topMostViewController(from: keyWindowRootViewController())
    }

    /// True when `viewController` is not in a presentation relationship — either
    /// it was never handed to UIKit, or UIKit **refused** the presentation (the
    /// presenter was mid-transition, or its view was not in the window
    /// hierarchy), in which case UIKit only logs and never runs the completion.
    /// The bridge's 2 s post-present guard uses this to settle the promise
    /// instead of hanging forever (issues.md row 4, AC RN-FLOW1, RN-UX12).
    @MainActor
    static func isDetached(_ viewController: UIViewController?) -> Bool {
        guard let viewController else { return true }
        return viewController.presentingViewController == nil
    }

    // MARK: - Present / dismiss

    @MainActor
    static func present(
        _ viewController: UIViewController,
        from presenter: UIViewController,
        completion: @escaping () -> Void
    ) {
        presenter.present(viewController, animated: true, completion: completion)
    }

    /// Upper bound on waiting for UIKit's dismiss completion. A normal sheet
    /// dismissal animates in ~0.3 s; see `dismiss(_:timeout:retries:perform:completion:)`.
    static let dismissCompletionTimeout: TimeInterval = 1

    /// The UIKit dismiss operation. A seam so tests can stand in for a dismiss
    /// UIKit refuses (and therefore never completes).
    typealias DismissAction = @MainActor (_ presenting: UIViewController, _ done: @escaping () -> Void) -> Void

    static let uikitDismiss: DismissAction = { presenting, done in
        presenting.dismiss(animated: true, completion: done)
    }

    /// Dismisses `viewController` and calls `completion` **after** the animation
    /// finishes, so the merchant may navigate inside `.then` (AC RN-CB2).
    /// A controller that is already gone completes immediately.
    ///
    /// Bounded: a dismiss requested while the sheet's own present (or another
    /// dismiss) is still animating is refused by UIKit ("while a presentation
    /// or dismiss is in progress") and its completion may never run. Everything
    /// that settles a payment or answers `cancelPaymentSheet()` waits on this
    /// completion, so an unbounded wait would leave the promise open and the
    /// bridge stuck "already presented". So:
    ///
    ///  * if UIKit has not called back after `timeout` and the sheet is still
    ///    on screen, the dismiss is asked for once more (`retries`) — by then
    ///    the present animation has finished, so the second request is not
    ///    refused and the customer is not left looking at a settled sheet;
    ///  * `completion` runs exactly once: when UIKit reports a dismiss finished,
    ///    or when the last `timeout` expires, whichever comes first. Worst case
    ///    `(retries + 1) × timeout` (2 s by default).
    @MainActor
    static func dismiss(
        _ viewController: UIViewController?,
        timeout: TimeInterval = dismissCompletionTimeout,
        retries: Int = 1,
        perform: @escaping DismissAction = uikitDismiss,
        completion: @escaping () -> Void
    ) {
        guard let viewController, viewController.presentingViewController != nil,
              !viewController.isBeingDismissed
        else {
            completion()
            return
        }
        let once = OnceFlag()
        attemptDismiss(
            viewController, retriesLeft: retries, timeout: timeout, perform: perform, once: once
        ) {
            guard once.claim() else { return }
            completion()
        }
    }

    @MainActor
    private static func attemptDismiss(
        _ viewController: UIViewController,
        retriesLeft: Int,
        timeout: TimeInterval,
        perform: @escaping DismissAction,
        once: OnceFlag,
        finish: @escaping () -> Void
    ) {
        if let presenting = viewController.presentingViewController {
            perform(presenting) {
                // UIKit calls back on main; hop defensively so the flag is only
                // ever touched there.
                if Thread.isMainThread { finish() } else { DispatchQueue.main.async { finish() } }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak viewController] in
            MainActor.assumeIsolated {
                guard !once.isClaimed else { return }
                if retriesLeft > 0, let viewController,
                   viewController.presentingViewController != nil, !viewController.isBeingDismissed
                {
                    attemptDismiss(
                        viewController, retriesLeft: retriesLeft - 1, timeout: timeout,
                        perform: perform, once: once, finish: finish
                    )
                } else {
                    finish()
                }
            }
        }
    }

    /// Main-thread-only "first caller wins" flag for `dismiss`.
    private final class OnceFlag {
        private var claimed = false
        var isClaimed: Bool { claimed }
        func claim() -> Bool {
            guard !claimed else { return false }
            claimed = true
            return true
        }
    }
}
