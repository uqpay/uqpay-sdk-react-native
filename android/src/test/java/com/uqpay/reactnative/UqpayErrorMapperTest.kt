package com.uqpay.reactnative

import com.facebook.react.bridge.JavaOnlyMap
import com.uqpay.sdk.error.UQPayError
import com.uqpay.sdk.error.UQPayErrorCode
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The single Android error mapper (AC RN-ERR1, RN-PAR3), driven off the shared error table
 * so a change on the JS side that this bridge cannot produce fails here rather than in
 * production.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UqpayErrorMapperTest {

  @Before fun setUp() = UqpayTest.installRuntime()

  @After fun tearDown() = UqpayTest.tearDown()

  private fun tableRows(): List<JSONObject> {
    val text = checkNotNull(javaClass.classLoader?.getResourceAsStream("error-table.json"))
      .bufferedReader()
      .use { it.readText() }
    val rows = JSONObject(text).getJSONArray("rows")
    return (0 until rows.length()).map { rows.getJSONObject(it) }
  }

  @Test
  fun everyTableRowReachableOnAndroid_roundTripsThroughTheMapper() {
    val rows = tableRows().filter { row ->
      val platforms = row.getJSONArray("platforms")
      (0 until platforms.length()).any { platforms.getString(it) == "android" }
    }
    assertEquals("every canonical code is reachable on Android", 14, rows.size)

    for (row in rows) {
      val code = row.getString("code")
      val encoded = UqpayErrorMapper.encode(
        UQPayError(
          code = UQPayErrorCode.of(code),
          message = "shopper copy",
          developerMessage = "developer copy for $code",
        ),
      ) as JavaOnlyMap

      assertEquals("code passes through untouched for $code", code, encoded.getString("code"))
      // bridge-contract §3: on Android only `timeout` is outcome-unknown, because the SDK
      // emits it on PENDING alone. See `unknownIsNotOutcomeUnknown_onTheWireAndInTheTable`.
      assertEquals(
        "isOutcomeUnknown for $code",
        code == "timeout",
        encoded.getBoolean("isOutcomeUnknown"),
      )
      assertFalse("a canonical code never sets raw ($code)", encoded.hasKey("raw"))
      assertEquals("developer copy for $code", encoded.getString("developerMessage"))
    }
  }

  @Test
  fun theTableAndTheMapperAgreeOnTheCanonicalCodeSet() {
    // A drift test (AC RN-PAR3): a code added on either side fails here first.
    assertEquals(
      UqpayErrorMapper.CANONICAL_CODES,
      tableRows().map { it.getString("code") }.toSet(),
    )
  }

  @Test
  fun unknownIsNotOutcomeUnknown_onTheWireAndInTheTable() {
    // Lead decision OQ-A1 / OQ-I6. `unknown` is the *definitive* fallback for a failed
    // attempt the gateway declined to characterise — on Android, a wallet attempt with no
    // `failure_code` (network/ErrorMapper.kt `declineFallback`). It is a "no" we are sure
    // of, so it is not outcome-unknown, on either native or in the shared table.
    assertFalse(
      (UqpayErrorMapper.encode(
        UQPayError(code = UQPayErrorCode.UNKNOWN, message = "m", developerMessage = "d"),
      ) as JavaOnlyMap).getBoolean("isOutcomeUnknown"),
    )
    assertFalse(
      "src/errors/error-table.json must agree (OQ-A1)",
      tableRows().first { it.getString("code") == "unknown" }.getBoolean("isOutcomeUnknown"),
    )
  }

  @Test
  fun unknownNativeCode_passesThroughAndSetsRaw() {
    val encoded = UqpayErrorMapper.encode(
      UQPayError(
        code = UQPayErrorCode.of("some_future_code"),
        message = "shopper copy",
        developerMessage = "a code this wrapper version has never seen",
      ),
    ) as JavaOnlyMap

    assertEquals("some_future_code", encoded.getString("code"))
    assertEquals("some_future_code", encoded.getString("raw"))
    assertFalse(encoded.getBoolean("isOutcomeUnknown"))
  }

  @Test
  fun blankNativeCode_collapsesToUnknown() {
    val encoded = UqpayErrorMapper.encode(
      UQPayError(code = UQPayErrorCode.of("  "), message = "shopper copy"),
    ) as JavaOnlyMap

    assertEquals("unknown", encoded.getString("code"))
    assertFalse("`unknown` is canonical, so raw stays absent", encoded.hasKey("raw"))
  }

  @Test
  fun timeoutIsTheOnlyOutcomeUnknownCode() {
    val outcomeUnknown = UqpayErrorMapper.CANONICAL_CODES.filter { code ->
      (UqpayErrorMapper.encode(
        UQPayError(code = UQPayErrorCode.of(code), message = "m"),
      ) as JavaOnlyMap).getBoolean("isOutcomeUnknown")
    }
    assertEquals(listOf("timeout"), outcomeUnknown)
  }

  @Test
  fun declineCodeAndTraceId_areCarriedWhenPresentAndAbsentOtherwise() {
    val withExtras = UqpayErrorMapper.encode(
      UQPayError(
        code = UQPayErrorCode.INSUFFICIENT_FUNDS,
        message = "m",
        declineCode = "insufficient_funds",
        traceId = "trace-123",
        developerMessage = "d",
      ),
    ) as JavaOnlyMap
    assertEquals("insufficient_funds", withExtras.getString("declineCode"))
    assertEquals("trace-123", withExtras.getString("traceId"))

    val without = UqpayErrorMapper.encode(
      UQPayError(code = UQPayErrorCode.INSUFFICIENT_FUNDS, message = "m", developerMessage = "d"),
    ) as JavaOnlyMap
    assertFalse("null vs absent is preserved", without.hasKey("declineCode"))
    assertFalse(without.hasKey("traceId"))
  }

  @Test
  fun httpStatusIsNeverSetOnAndroid() {
    // `UQPayError` has no status field (uqpay-sdk.api), so inventing one would be a lie.
    val encoded = UqpayErrorMapper.encode(
      UQPayError(code = UQPayErrorCode.SERVER_ERROR, message = "m", developerMessage = "d"),
    ) as JavaOnlyMap
    assertFalse(encoded.hasKey("httpStatus"))
  }

  @Test
  fun developerMessageFallsBackToShopperCopyAndIsNeverBlank() {
    val fromShopperCopy = UqpayErrorMapper.encode(
      UQPayError(code = UQPayErrorCode.UNKNOWN, message = "shopper copy", developerMessage = null),
    ) as JavaOnlyMap
    assertEquals("shopper copy", fromShopperCopy.getString("developerMessage"))

    val fromNothing = UqpayErrorMapper.encode(
      UQPayError(code = UQPayErrorCode.UNKNOWN, message = "", developerMessage = "  "),
    ) as JavaOnlyMap
    assertTrue(fromNothing.getString("developerMessage")!!.isNotBlank())
  }

  @Test
  fun nullNativeError_becomesUnknownRatherThanNothing() {
    val encoded = UqpayErrorMapper.encode(null) as JavaOnlyMap
    assertEquals("unknown", encoded.getString("code"))
    assertFalse(encoded.getBoolean("isOutcomeUnknown"))
    assertNull(encoded.getString("declineCode"))
  }
}
