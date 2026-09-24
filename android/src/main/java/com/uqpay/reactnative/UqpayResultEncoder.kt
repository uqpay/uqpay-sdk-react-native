package com.uqpay.reactnative

import com.facebook.react.bridge.WritableMap
import com.uqpay.sdk.error.UQPayErrorCode
import com.uqpay.sdk.payment.PaymentResult
import com.uqpay.sdk.payment.PaymentStatus
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * `PaymentResult` → the contract's `NativePaymentResult` map (bridge-contract §3).
 *
 * Rules that matter:
 * - **No arithmetic on money.** `amount` crosses as `BigDecimal.toPlainString()`, so the
 *   gateway's own scale survives (`8.98`, `10`, `1.500`). AC RN-PAR5.
 * - **Null vs absent is preserved**: a key is only written when there is a value.
 * - `completedAtEpochMillis` is the *device* observation time (android_analysis §2) and is
 *   rendered as ISO-8601 **UTC with millisecond precision** — `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`,
 *   the one format both platforms emit (lead decision OQ-I1). `SimpleDateFormat` rather than
 *   `java.time` because the module's `minSdk` is 24 and core-library desugaring is the host
 *   app's choice, not ours to require.
 */
internal object UqpayResultEncoder {

  const val PLATFORM: String = "android"

  const val KIND_COMPLETED: String = "completed"
  const val KIND_FAILED: String = "failed"
  const val KIND_CANCELED: String = "canceled"
  const val KIND_PENDING: String = "pending"

  const val REASON_USER_CANCELLED: String = "user_cancelled"
  const val REASON_MERCHANT_CANCELLED: String = "merchant_cancelled"
  const val REASON_INTENT_CANCELLED: String = "intent_cancelled"

  /** The one `completedAt` format both bridges emit (lead decision OQ-I1). */
  const val ISO_8601_UTC_MILLIS: String = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

  /**
   * @param merchantCancelRequested true when this result follows our own
   *   `cancelPaymentSheet()` — the SDK reports plain `CANCELLED` either way, so the bridge
   *   is the only place that can tell the two apart (bridge-contract §3).
   */
  fun encode(result: PaymentResult, merchantCancelRequested: Boolean = false): WritableMap {
    val map = UqpayRuntime.newMap()
    map.putString("platform", PLATFORM)
    map.putString("resultId", UqpayRuntime.newUuid())
    map.putString("paymentIntentId", result.paymentIntentId)

    when (result.status) {
      PaymentStatus.SUCCEEDED -> {
        map.putString("kind", KIND_COMPLETED)
        // The Android SDK collapses REQUIRES_CAPTURE into SUCCEEDED
        // (`engine/PaymentEngine.kt:735`), so SUCCEEDED is the only status it can report.
        map.putString("status", "SUCCEEDED")
      }

      PaymentStatus.FAILED -> {
        // A server-side CANCELLED intent outranks the attempt's failure code and arrives as
        // FAILED + `cancelled` (`network/ErrorMapper.kt:105`:
        // `intentStatus is IntentStatus.Cancelled -> UQPayErrorCode.CANCELLED`). The
        // contract calls that a cancellation, not a failure — same as iOS `.cancelled`.
        if (result.error?.code == UQPayErrorCode.CANCELLED) {
          map.putString("kind", KIND_CANCELED)
          map.putString("reason", REASON_INTENT_CANCELLED)
        } else {
          map.putString("kind", KIND_FAILED)
          map.putMap("error", UqpayErrorMapper.encode(result.error))
        }
      }

      PaymentStatus.CANCELLED -> {
        map.putString("kind", KIND_CANCELED)
        map.putString(
          "reason",
          if (merchantCancelRequested) REASON_MERCHANT_CANCELLED else REASON_USER_CANCELLED,
        )
      }

      PaymentStatus.PENDING -> {
        map.putString("kind", KIND_PENDING)
        // `PENDING` always carries a cause, normally `timeout`
        // (`engine/PaymentEngine.kt:765` `timeoutError()`), which is what sets
        // `isOutcomeUnknown` in the mapper. `status` (last known intent status) is not on
        // `PaymentResult`, so it is omitted rather than invented.
        result.error?.let { map.putMap("error", UqpayErrorMapper.encode(it)) }
      }
    }

    putCommonFields(map, result)
    return map
  }

  /**
   * A result the bridge itself originates: no sheet ran, so there is no `PaymentResult`.
   * Used for "already presented" and "no foreground Activity" (AC RN-CB8, RN-UX7/UX8).
   */
  fun syntheticFailure(paymentIntentId: String, code: String, developerMessage: String): WritableMap {
    val map = UqpayRuntime.newMap()
    map.putString("platform", PLATFORM)
    map.putString("resultId", UqpayRuntime.newUuid())
    map.putString("paymentIntentId", paymentIntentId)
    map.putString("kind", KIND_FAILED)
    map.putMap("error", UqpayErrorMapper.synthetic(code, developerMessage))
    return map
  }

  /**
   * `cancelPaymentSheet()` arrived while the token was still being fetched, so no sheet was
   * ever launched. Encoded through [encode] from a plain `CANCELLED`, so it is exactly the
   * shape a merchant cancel of a live sheet produces.
   */
  fun merchantCancelledBeforeLaunch(paymentIntentId: String): WritableMap = encode(
    PaymentResult(status = PaymentStatus.CANCELLED, paymentIntentId = paymentIntentId),
    merchantCancelRequested = true,
  )

  /**
   * ISO-8601 UTC, millisecond precision — `2023-11-14T22:13:20.123Z` (lead decision OQ-I1).
   *
   * `Locale.US` is not decoration: a locale with a non-Gregorian calendar (`ar-SA@islamic`,
   * `th-TH@buddhist`) would otherwise render a different year.
   */
  fun isoUtc(epochMillis: Long): String {
    val format = SimpleDateFormat(ISO_8601_UTC_MILLIS, Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(Date(epochMillis))
  }

  private fun putCommonFields(map: WritableMap, result: PaymentResult) {
    // The SDK populates these from the intent on every status it can read, so they are
    // written for all four kinds — always as the wire value, never scaled or reformatted.
    result.amount?.let { map.putString("amount", it.toPlainString()) }
    result.currency?.takeIf { it.isNotBlank() }?.let { map.putString("currency", it) }
    result.paymentMethodType?.let { map.putString("paymentMethodType", it.raw) }
    result.transactionId?.takeIf { it.isNotBlank() }?.let { map.putString("transactionId", it) }
    result.merchantOrderId?.takeIf { it.isNotBlank() }?.let { map.putString("merchantOrderId", it) }
    result.completedAtEpochMillis?.let { map.putString("completedAt", isoUtc(it)) }
  }
}
