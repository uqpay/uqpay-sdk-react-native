package com.uqpay.reactnative

import com.facebook.react.bridge.WritableMap
import com.uqpay.sdk.error.UQPayError
import com.uqpay.sdk.error.UQPayErrorCode

/**
 * The **only** Android error mapper (AC RN-ERR1, bridge-contract §0.2).
 *
 * The native SDK's `UQPayErrorCode.raw` values are already the canonical wire codes, so the
 * mapping is a pass-through: nothing is re-spelled here and JS never re-maps a code. What
 * this adds is the contract's shape — `isOutcomeUnknown`, a never-blank `developerMessage`,
 * and `raw` for a code this wrapper version does not know (the SDK's code set is open:
 * `UQPayErrorCode.of(raw)`).
 *
 * `httpStatus` is never populated on Android: `UQPayError` has no status field
 * (`uqpay-sdk.api`, `com/uqpay/sdk/error/UQPayError`). `traceId` is carried when present —
 * the SDK documents it as always `null` today.
 */
internal object UqpayErrorMapper {

  /** The 14 canonical codes (AC RN-ERR1). Anything else passes through and sets `raw`. */
  val CANONICAL_CODES: Set<String> = setOf(
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
  )

  /** Only `timeout` is outcome-unknown on Android — the SDK emits it on `PENDING` alone. */
  const val OUTCOME_UNKNOWN_CODE: String = "timeout"

  private const val FALLBACK_MESSAGE =
    "The UQPAY Android SDK reported a failure without a developer message."

  /** Maps a native [UQPayError] into the contract's `NativeError` map. */
  fun encode(error: UQPayError?): WritableMap {
    if (error == null) return synthetic("unknown", FALLBACK_MESSAGE)
    return encode(error.code, error.developerMessage, error.message, error.declineCode, error.traceId)
  }

  /** Builds a `NativeError` the bridge itself originates (no native error exists). */
  fun synthetic(code: String, developerMessage: String): WritableMap {
    val map = UqpayRuntime.newMap()
    map.putString("code", code)
    map.putString("developerMessage", developerMessage.ifBlank { FALLBACK_MESSAGE })
    if (code !in CANONICAL_CODES) map.putString("raw", code)
    map.putBoolean("isOutcomeUnknown", code == OUTCOME_UNKNOWN_CODE)
    return map
  }

  private fun encode(
    code: UQPayErrorCode,
    developerMessage: String?,
    shopperMessage: String?,
    declineCode: String?,
    traceId: String?,
  ): WritableMap {
    // `UQPayErrorCode.of("")` already collapses to UNKNOWN, so `raw` is never blank; the
    // guard is belt-and-braces so `code` can never cross the bridge empty.
    val raw = code.raw.takeIf { it.isNotBlank() } ?: "unknown"
    val map = UqpayRuntime.newMap()
    map.putString("code", raw)
    // `developerMessage` is English and already sanitised by the SDK (gateway text only in
    // SANDBOX); `message` is the localised shopper sentence and is the fallback.
    map.putString(
      "developerMessage",
      developerMessage?.takeIf { it.isNotBlank() }
        ?: shopperMessage?.takeIf { it.isNotBlank() }
        ?: FALLBACK_MESSAGE,
    )
    declineCode?.takeIf { it.isNotBlank() }?.let { map.putString("declineCode", it) }
    traceId?.takeIf { it.isNotBlank() }?.let { map.putString("traceId", it) }
    if (raw !in CANONICAL_CODES) map.putString("raw", raw)
    map.putBoolean("isOutcomeUnknown", raw == OUTCOME_UNKNOWN_CODE)
    return map
  }
}
