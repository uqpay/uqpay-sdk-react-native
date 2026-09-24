//
//  UqpayResultEncoder.swift
//  uqpay-react-native
//
//  Encodes native iOS SDK values into the `NativePaymentResult` / `NativeError`
//  shapes of `src/NativeUqpay.ts` (bridge-contract §1, §3).
//
//  Rules enforced here (AC RN-PAR5, RN-FLOW5, RN-BR3):
//   * `Decimal` → a decimal string rendered at the currency's ISO-4217 minor
//     units, because `Decimal` drops trailing zeros ("10.00" decodes to 10).
//   * `Date` → ISO-8601 with fractional seconds in UTC.
//   * `amountDecimal == nil` → `amount` is omitted entirely, never "0".
//   * `transactionId == paymentIntentId` (the only value the sheet path ever
//     sets) → omitted; a distinct value is a real attempt id.
//   * No arithmetic is ever performed on an amount.
//

import Foundation
import UqpayPaymentSheet

/// The four `kind` values `NativePaymentResult` may carry.
enum UqpayResultKind: String {
    case completed
    case failed
    case canceled
    case pending
}

/// The three `reason` values a `canceled` result may carry.
enum UqpayCancelReason: String {
    case userCancelled = "user_cancelled"
    case merchantCancelled = "merchant_cancelled"
    case intentCancelled = "intent_cancelled"
}

enum UqpayResultEncoder {

    static let platform = "ios"

    // MARK: - ISO-4217 minor units

    /// Currencies with **no** minor unit. ISO-4217 table A.1.
    static let zeroDecimalCurrencies: Set<String> = [
        "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF",
        "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF", "XAG", "XAU", "XBA",
        "XBB", "XBC", "XBD", "XDR", "XPD", "XPT", "XSU", "XTS", "XUA", "XXX",
    ]

    /// Currencies with three minor-unit digits.
    static let threeDecimalCurrencies: Set<String> = [
        "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
    ]

    /// Currencies with four minor-unit digits (funds codes).
    static let fourDecimalCurrencies: Set<String> = ["CLF", "UYW"]

    /// ISO-4217 minor units for `currency`; 2 for anything not in the tables
    /// (which is the overwhelming majority, and the safe default).
    static func minorUnits(for currency: String) -> Int {
        let code = currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if zeroDecimalCurrencies.contains(code) { return 0 }
        if threeDecimalCurrencies.contains(code) { return 3 }
        if fourDecimalCurrencies.contains(code) { return 4 }
        return 2
    }

    // MARK: - Amount

    /// Renders `amount` at the currency's scale, or `nil` when the SDK gave no
    /// amount. Locale-independent: `NSDecimalNumber.description` always emits a
    /// plain "-123.45" form with a `.` separator and no grouping.
    static func amountString(_ amount: Decimal?, currency: String) -> String? {
        guard let amount else { return nil }
        let scale = minorUnits(for: currency)
        let handler = NSDecimalNumberHandler(
            roundingMode: .plain,
            scale: Int16(scale),
            raiseOnExactness: false,
            raiseOnOverflow: false,
            raiseOnUnderflow: false,
            raiseOnDivideByZero: false
        )
        let rounded = NSDecimalNumber(decimal: amount).rounding(accordingToBehavior: handler)
        guard rounded != NSDecimalNumber.notANumber else { return nil }
        return pad(rounded.description, toScale: scale)
    }

    /// Right-pads (or trims the separator off) a plain decimal string so it has
    /// exactly `scale` fraction digits.
    private static func pad(_ plain: String, toScale scale: Int) -> String {
        let parts = plain.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        let integerPart = String(parts[0])
        let fraction = parts.count > 1 ? String(parts[1]) : ""
        if scale == 0 { return integerPart }
        if fraction.count >= scale {
            return integerPart + "." + String(fraction.prefix(scale))
        }
        return integerPart + "." + fraction + String(repeating: "0", count: scale - fraction.count)
    }

    // MARK: - Date

    private static let iso8601Formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()

    /// ISO-8601 with fractional seconds, always in UTC (`…Z`).
    static func iso8601(_ date: Date) -> String {
        iso8601Formatter.string(from: date)
    }

    // MARK: - Status

    /// `PaymentStatus` has no raw value, so it is mapped by case name with an
    /// explicit default (AC RN-BR3).
    static func statusName(_ status: PaymentStatus) -> String {
        switch status {
        case .succeeded: return "SUCCEEDED"
        case .failed: return "FAILED"
        case .cancelled: return "CANCELLED"
        case .requiresAction: return "REQUIRES_CUSTOMER_ACTION"
        case .processing: return "PROCESSING"
        case .pending: return "PENDING"
        @unknown default: return "UNKNOWN"
        }
    }

    static func newResultId() -> String { UUID().uuidString }

    // MARK: - Result

    // swiftlint:disable:next function_parameter_count
    static func encode(
        kind: UqpayResultKind,
        paymentIntentId: String,
        status: String? = nil,
        amountDecimal: Decimal? = nil,
        currency: String? = nil,
        paymentMethodType: String? = nil,
        transactionId: String? = nil,
        merchantOrderId: String? = nil,
        completedAt: Date? = nil,
        reason: UqpayCancelReason? = nil,
        error: [String: Any]? = nil,
        resultId: String? = nil
    ) -> [String: Any] {
        var out: [String: Any] = [
            "kind": kind.rawValue,
            "paymentIntentId": paymentIntentId,
            "platform": platform,
            "resultId": resultId ?? newResultId(),
        ]
        if let status, !status.isEmpty { out["status"] = status }

        // `amount` and `currency` travel together: no amount → neither field.
        let currencyCode = (currency ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if let rendered = amountString(amountDecimal, currency: currencyCode) {
            out["amount"] = rendered
            if !currencyCode.isEmpty { out["currency"] = currencyCode }
        }

        if let paymentMethodType, !paymentMethodType.isEmpty {
            out["paymentMethodType"] = paymentMethodType
        }
        // The sheet path always sets `transactionId` to the intent id; only a
        // genuinely different value is an attempt id worth surfacing.
        if let transactionId, !transactionId.isEmpty, transactionId != paymentIntentId {
            out["transactionId"] = transactionId
        }
        if let merchantOrderId, !merchantOrderId.isEmpty {
            out["merchantOrderId"] = merchantOrderId
        }
        if let completedAt {
            out["completedAt"] = iso8601(completedAt)
        }
        if let reason {
            out["reason"] = reason.rawValue
        }
        if let error {
            out["error"] = error
        }
        return out
    }

    /// Encodes a delegate-supplied `PaymentResult`.
    ///
    /// - Parameter forcedStatus: overrides the status derived from
    ///   `result.status`. Used by the terminal-intent guard, which knows the
    ///   exact API status (`REQUIRES_CAPTURE` collapses to `.succeeded` in the
    ///   SDK's own enum and cannot be recovered from a `PaymentResult`).
    static func encode(
        result: PaymentResult,
        kind: UqpayResultKind,
        forcedStatus: String? = nil,
        reason: UqpayCancelReason? = nil,
        error: [String: Any]? = nil
    ) -> [String: Any] {
        encode(
            kind: kind,
            paymentIntentId: result.paymentIntentId,
            status: forcedStatus ?? statusName(result.status),
            amountDecimal: result.amountDecimal,
            currency: result.currency,
            paymentMethodType: result.paymentMethodType,
            transactionId: result.transactionId,
            merchantOrderId: result.merchantOrderId,
            completedAt: result.completedAt,
            reason: reason,
            error: error
        )
    }

    /// The `pending` shape for `paymentDidBecomePending` (bridge-contract §3).
    ///
    /// When the SDK reports `amountDecimal == nil` **and** an empty currency the
    /// payment's outcome is genuinely unknown (a 5xx/429/transport/decode
    /// failure on confirm, or a mid-confirm dismissal), so the cause is a
    /// `timeout` with `isOutcomeUnknown` set — lead decision S2-2.
    static func encodePending(result: PaymentResult) -> [String: Any] {
        let outcomeUnknown = result.amountDecimal == nil
            && result.currency.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let cause: [String: Any]? = outcomeUnknown
            ? UqpayErrorMapper.nativeError(
                code: "timeout",
                developerMessage: "The confirm request left the device but its outcome is not known yet; "
                    + "the payment may still succeed. Reconcile with your webhook.",
                isOutcomeUnknown: true
            )
            : nil
        return encode(result: result, kind: .pending, error: cause)
    }
}
