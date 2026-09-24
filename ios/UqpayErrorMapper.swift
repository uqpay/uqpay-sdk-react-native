//
//  UqpayErrorMapper.swift
//  uqpay-react-native
//
//  The **only** place on iOS where a native error becomes a canonical code.
//  JavaScript never re-maps codes; it only decorates them from
//  `src/errors/table.ts` (bridge-contract §0.2, §3).
//
//  Derivation rules come from bridge-contract §3 and spike S2
//  (`docs/internal/progress/spikes.md`), including the lead's go/no-go
//  decisions:
//   * S2-1 — strictly 400/404/422 derive `invalid_request`; every other
//     definitive 4xx stays `unknown` with `httpStatus` and `raw` preserved.
//   * S2-2 — a confirm-path 5xx/429/transport/decode never becomes
//     `server_error`; the SDK reports it as `paymentDidBecomePending`, which the
//     encoder turns into `pending` + `timeout` + `isOutcomeUnknown`.
//     `server_error` therefore stays reachable only on the **load** path, where
//     the bridge's own intent pre-read observed the HTTP status.
//

import Foundation
import UqpayCore
import UqpayPaymentSheet

/// Canonical error codes (bridge-contract §3). Kept as a `Set` so the mapper can
/// tell "I recognised this" from "I am passing an unknown native value through".
enum UqpayCanonicalCode {
    static let all: Set<String> = [
        "card_declined",
        "insufficient_funds",
        "invalid_payment_method",
        "3ds_failed",
        "cancelled",
        "authentication_failed",
        "invalid_configuration",
        "not_initialized",
        "invalid_request",
        "network_error",
        "timeout",
        "server_error",
        "intent_not_payable",
        "unknown",
    ]
}

/// Strips anything that could be card data or a credential from a developer
/// message before it crosses the bridge (AC RN-SEC1, RN-SEC7). The SDK's own
/// messages are localised prose, but the message may embed an API error body.
enum UqpayRedactor {

    private static let panPattern = try? NSRegularExpression(
        pattern: "\\b(?:\\d[ -]?){12,19}\\b"
    )
    private static let bearerPattern = try? NSRegularExpression(
        pattern: "(?i)\\b(bearer|token|authorization)\\b\\s*[:=]?\\s*[A-Za-z0-9._~+/=-]{8,}"
    )

    static let maxLength = 400

    static func scrub(_ message: String) -> String {
        var out = message
        let full = NSRange(out.startIndex..., in: out)
        if let bearerPattern {
            out = bearerPattern.stringByReplacingMatches(
                in: out, range: full, withTemplate: "$1 [redacted]"
            )
        }
        if let panPattern {
            out = panPattern.stringByReplacingMatches(
                in: out, range: NSRange(out.startIndex..., in: out), withTemplate: "[redacted]"
            )
        }
        if out.count > maxLength {
            out = String(out.prefix(maxLength)) + "…"
        }
        return out
    }
}

enum UqpayErrorMapper {

    // MARK: - Building a `NativeError`

    /// Codes whose outcome is unknown by construction: the request left the
    /// device and no answer came back. Mirrors `isOutcomeUnknown` in
    /// `ios/Tests/Fixtures/error-table.json` for the codes iOS produces on the
    /// payment path, so the two cannot drift (AC RN-PAR3).
    static let outcomeUnknownCodes: Set<String> = ["timeout"]

    static func nativeError(
        code: String,
        developerMessage: String,
        declineCode: String? = nil,
        httpStatus: Int? = nil,
        raw: String? = nil,
        isOutcomeUnknown: Bool? = nil
    ) -> [String: Any] {
        let resolvedCode = code.isEmpty ? "unknown" : code
        var out: [String: Any] = [
            "code": resolvedCode,
            "developerMessage": UqpayRedactor.scrub(developerMessage),
            "isOutcomeUnknown": isOutcomeUnknown ?? outcomeUnknownCodes.contains(resolvedCode),
        ]
        if let declineCode, !declineCode.isEmpty { out["declineCode"] = declineCode }
        if let httpStatus { out["httpStatus"] = httpStatus }
        // `raw` is set whenever the code is not one of the canonical 14, and for
        // `unknown` it carries the native raw value that produced it.
        if let raw, !raw.isEmpty {
            out["raw"] = raw
        } else if !UqpayCanonicalCode.all.contains(resolvedCode) {
            out["raw"] = resolvedCode
        }
        return out
    }

    // MARK: - Delegate path (`didFailWithError`)

    /// Maps a `PaymentError` delivered by `PaymentDelegate`.
    static func map(paymentError error: PaymentError) -> [String: Any] {
        map(
            rawCode: error.code.rawValue,
            message: error.message,
            underlyingError: error.underlyingError,
            declineCode: error.declineCode
        )
    }

    /// The mapper works off the **raw string**, not the Swift enum, so an
    /// `ErrorCode` case added by a future SDK minor passes straight through
    /// instead of being silently folded into `unknown` (the SDK documents the
    /// taxonomy as non-exhaustive).
    static func map(
        rawCode: String,
        message: String,
        underlyingError: Error?,
        declineCode: String?
    ) -> [String: Any] {
        let api = underlyingError as? UqpayAPIError
        let status = api?.httpStatus

        switch rawCode {
        case "card_declined", "insufficient_funds", "3ds_failed", "cancelled",
             "authentication_failed", "network_error", "timeout", "invalid_configuration":
            return nativeError(
                code: rawCode,
                developerMessage: message,
                declineCode: declineCode,
                httpStatus: status
            )

        case "invalid_payment_method":
            // Spike S2: this is the one code the SDK overloads. 400/404/422 with
            // no `invalid_payment_method` API code is a malformed request, not a
            // bad payment method.
            if let status, [400, 404, 422].contains(status), api?.apiCode != "invalid_payment_method" {
                return nativeError(
                    code: "invalid_request",
                    developerMessage: message,
                    declineCode: declineCode,
                    httpStatus: status
                )
            }
            return nativeError(
                code: "invalid_payment_method",
                developerMessage: message,
                declineCode: declineCode,
                httpStatus: status
            )

        case "unknown":
            return nativeError(
                code: "unknown",
                developerMessage: message,
                declineCode: declineCode,
                httpStatus: status,
                raw: "unknown"
            )

        default:
            // An unrecognised native raw value passes through untouched as the
            // code, with `raw` set so JS can call `isUnknownErrorCode`.
            return nativeError(
                code: rawCode,
                developerMessage: message,
                declineCode: declineCode,
                httpStatus: status,
                raw: rawCode
            )
        }
    }

    // MARK: - Load path (`PaymentSheetError.failed`, intent pre-read)

    /// Maps a failure from the load path, where the SDK has already stringified
    /// the HTTP status away (`UqpayPaymentSheet.swift:523-525`).
    ///
    /// The bridge never string-sniffs "Request failed with status %d." — that
    /// prose is localised. Instead it uses the error object it *does* hold: the
    /// exception thrown by its own `getPaymentIntentById` pre-read of the same
    /// GET endpoint, passed in as `underlying`. When there is no such object the
    /// result is `unknown` with `raw` set (RN-DOC7).
    static func mapLoadFailure(underlying: Error?, message: String) -> [String: Any] {
        guard let underlying else {
            return nativeError(
                code: "unknown",
                developerMessage: message,
                raw: "PaymentSheetError.failed"
            )
        }

        if let api = underlying as? UqpayAPIError {
            switch api {
            case .api(let status, _), .unexpectedStatus(let status, _):
                return nativeError(
                    code: code(forHTTPStatus: status),
                    developerMessage: message,
                    declineCode: api.apiCode,
                    httpStatus: status,
                    raw: UqpayCanonicalCode.all.contains(code(forHTTPStatus: status))
                        ? nil : "http_\(status)"
                )
            case .timedOut:
                return nativeError(code: "timeout", developerMessage: message, isOutcomeUnknown: true)
            case .transport:
                return nativeError(code: "network_error", developerMessage: message)
            case .cancelled:
                return nativeError(code: "cancelled", developerMessage: message)
            case .decoding:
                return nativeError(code: "unknown", developerMessage: message, raw: "decoding")
            case .notConfigured:
                return nativeError(code: "invalid_configuration", developerMessage: message)
            case .authenticationFailed:
                return nativeError(code: "authentication_failed", developerMessage: message)
            }
        }

        if let urlError = underlying as? URLError {
            switch urlError.code {
            case .timedOut:
                return nativeError(code: "timeout", developerMessage: message, isOutcomeUnknown: true)
            case .cancelled:
                return nativeError(code: "cancelled", developerMessage: message)
            case .userAuthenticationRequired:
                return nativeError(code: "authentication_failed", developerMessage: message)
            default:
                return nativeError(code: "network_error", developerMessage: message)
            }
        }

        // `ApiClient.getPaymentIntentById` throws a plain NSError in the
        // "UqpayAPIError" domain whose `code` is the HTTP status
        // (`ApiClient+Payments.swift:56-62`).
        let nsError = underlying as NSError
        if nsError.domain == "UqpayAPIError", (100...599).contains(nsError.code) {
            let mapped = code(forHTTPStatus: nsError.code)
            return nativeError(
                code: mapped,
                developerMessage: message,
                httpStatus: nsError.code,
                raw: UqpayCanonicalCode.all.contains(mapped) ? nil : "http_\(nsError.code)"
            )
        }

        return nativeError(code: "unknown", developerMessage: message, raw: nsError.domain)
    }

    /// HTTP status → canonical code, for the load path only.
    static func code(forHTTPStatus status: Int) -> String {
        switch status {
        case 401, 403: return "authentication_failed"
        case 400, 404, 422: return "invalid_request"
        case 402: return "card_declined"
        case 429: return "server_error"
        case 500...599: return "server_error"
        default: return "unknown"
        }
    }

    // MARK: - Bridge-local errors

    static func bridgeError(
        code: String,
        developerMessage: String,
        isOutcomeUnknown: Bool? = nil
    ) -> [String: Any] {
        nativeError(code: code, developerMessage: developerMessage, isOutcomeUnknown: isOutcomeUnknown)
    }
}
