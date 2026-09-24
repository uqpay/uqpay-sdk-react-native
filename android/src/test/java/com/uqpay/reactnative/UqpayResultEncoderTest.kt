package com.uqpay.reactnative

import com.facebook.react.bridge.JavaOnlyMap
import com.uqpay.sdk.error.UQPayError
import com.uqpay.sdk.error.UQPayErrorCode
import com.uqpay.sdk.payment.PaymentMethodType
import com.uqpay.sdk.payment.PaymentResult
import com.uqpay.sdk.payment.PaymentStatus
import java.math.BigDecimal
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** `PaymentResult` → `NativePaymentResult` (bridge-contract §3, AC RN-PAR5, RN-TEST5). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UqpayResultEncoderTest {

  @Before fun setUp() = UqpayTest.installRuntime()

  @After fun tearDown() = UqpayTest.tearDown()

  private fun encode(result: PaymentResult, merchantCancel: Boolean = false): JavaOnlyMap =
    UqpayResultEncoder.encode(result, merchantCancel) as JavaOnlyMap

  // ---- amounts: the wire string, never arithmetic (AC RN-PAR5) -------------------------

  @Test
  fun amountKeepsTheGatewayScale_8point98() {
    assertEquals("8.98", encode(UqpayTest.succeeded(amount = BigDecimal("8.98"))).getString("amount"))
  }

  @Test
  fun amountKeepsTheGatewayScale_wholeNumber() {
    assertEquals("10", encode(UqpayTest.succeeded(amount = BigDecimal("10"))).getString("amount"))
  }

  @Test
  fun amountKeepsTheGatewayScale_trailingZeros() {
    assertEquals("1.500", encode(UqpayTest.succeeded(amount = BigDecimal("1.500"))).getString("amount"))
  }

  @Test
  fun amountKeepsTheGatewayScale_neverScientificNotation() {
    assertEquals(
      "0.00000001",
      encode(UqpayTest.succeeded(amount = BigDecimal("1E-8"))).getString("amount"),
    )
  }

  @Test
  fun nullAmount_leavesTheKeyAbsent() {
    val map = encode(UqpayTest.succeeded(amount = null, currency = null))
    assertFalse("null vs absent is preserved", map.hasKey("amount"))
    assertFalse(map.hasKey("currency"))
  }

  // ---- dates ---------------------------------------------------------------------------

  @Test
  fun completedAtEpochMillis_becomesIso8601Utc() {
    val map = encode(UqpayTest.succeeded(completedAtEpochMillis = 1_700_000_000_123L))
    assertEquals("2023-11-14T22:13:20.123Z", map.getString("completedAt"))
  }

  @Test
  fun completedAtAlwaysCarriesMillisecondPrecisionAndAZuluSuffix() {
    // Lead decision OQ-I1: both bridges emit `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`, so JavaScript
    // parses one shape and the shared fixture matches one regex.
    val iso8601UtcMillis = Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z")
    for (epochMillis in listOf(0L, 1_000L, 1_700_000_000_000L, 1_700_000_000_007L)) {
      val rendered = encode(UqpayTest.succeeded(completedAtEpochMillis = epochMillis))
        .getString("completedAt")!!
      assertTrue("$epochMillis rendered as $rendered", iso8601UtcMillis.matches(rendered))
    }
    // A whole second still carries `.000` rather than dropping the fraction.
    assertEquals(
      "1970-01-01T00:00:00.000Z",
      encode(UqpayTest.succeeded(completedAtEpochMillis = 0L)).getString("completedAt"),
    )
  }

  @Test
  fun nullCompletedAt_leavesTheKeyAbsent() {
    assertFalse(encode(UqpayTest.succeeded(completedAtEpochMillis = null)).hasKey("completedAt"))
  }

  // ---- status → kind --------------------------------------------------------------------

  @Test
  fun succeeded_becomesCompletedWithStatusSucceeded() {
    val map = encode(UqpayTest.succeeded())
    assertEquals("completed", map.getString("kind"))
    assertEquals("SUCCEEDED", map.getString("status"))
    assertEquals("card", map.getString("paymentMethodType"))
    assertEquals("PA_attempt_1", map.getString("transactionId"))
    assertEquals("ORDER-1", map.getString("merchantOrderId"))
    assertEquals(UqpayTest.INTENT_ID, map.getString("paymentIntentId"))
    assertFalse("a completed payment carries no error", map.hasKey("error"))
  }

  @Test
  fun failed_becomesFailedWithTheMappedError() {
    val map = encode(UqpayTest.failed(code = UQPayErrorCode.CARD_DECLINED))
    assertEquals("failed", map.getString("kind"))
    assertEquals("card_declined", map.getMap("error")!!.getString("code"))
    assertFalse(map.getMap("error")!!.getBoolean("isOutcomeUnknown"))
  }

  @Test
  fun cancelled_becomesCanceledWithUserCancelled() {
    val map = encode(UqpayTest.cancelled())
    assertEquals("canceled", map.getString("kind"))
    assertEquals("user_cancelled", map.getString("reason"))
  }

  @Test
  fun cancelledAfterOurOwnCancel_becomesMerchantCancelled() {
    val map = encode(UqpayTest.cancelled(), merchantCancel = true)
    assertEquals("canceled", map.getString("kind"))
    assertEquals("merchant_cancelled", map.getString("reason"))
  }

  @Test
  fun failedWithCancelledCode_becomesCanceledWithIntentCancelled() {
    // A server-side CANCELLED intent arrives as FAILED + `cancelled`
    // (network/ErrorMapper.kt:105). Parity with iOS `.cancelled` (bridge-contract §3).
    val map = encode(UqpayTest.failed(code = UQPayErrorCode.CANCELLED))
    assertEquals("canceled", map.getString("kind"))
    assertEquals("intent_cancelled", map.getString("reason"))
    assertFalse("a cancellation is not a failure", map.hasKey("error"))
  }

  @Test
  fun failedWithIntentNotPayable_staysFailed() {
    val map = encode(UqpayTest.failed(code = UQPayErrorCode.INTENT_NOT_PAYABLE))
    assertEquals("failed", map.getString("kind"))
    assertEquals("intent_not_payable", map.getMap("error")!!.getString("code"))
  }

  @Test
  fun pendingWithTimeout_carriesTheCauseAndIsOutcomeUnknown() {
    val map = encode(UqpayTest.pending())
    assertEquals("pending", map.getString("kind"))
    val error = map.getMap("error")!!
    assertEquals("timeout", error.getString("code"))
    assertTrue("a timeout means the outcome is unknown", error.getBoolean("isOutcomeUnknown"))
    assertFalse("the SDK gives no last-known intent status", map.hasKey("status"))
  }

  @Test
  fun pendingWithoutAnError_stillEncodes() {
    val map = encode(
      PaymentResult(status = PaymentStatus.PENDING, paymentIntentId = UqpayTest.INTENT_ID),
    )
    assertEquals("pending", map.getString("kind"))
    assertFalse(map.hasKey("error"))
  }

  // ---- envelope --------------------------------------------------------------------------

  @Test
  fun everyResultCarriesPlatformAndAFreshResultId() {
    val first = encode(UqpayTest.succeeded())
    val second = encode(UqpayTest.succeeded())
    assertEquals("android", first.getString("platform"))
    assertEquals("android", second.getString("platform"))
    assertTrue("resultId lets JS dedupe (AC RN-CB1)", first.getString("resultId") != second.getString("resultId"))
  }

  @Test
  fun unknownWireMethodType_crossesUntouched() {
    val map = encode(
      PaymentResult(
        status = PaymentStatus.SUCCEEDED,
        paymentIntentId = UqpayTest.INTENT_ID,
        paymentMethodType = PaymentMethodType.of("some_new_wallet"),
      ),
    )
    assertEquals("some_new_wallet", map.getString("paymentMethodType"))
  }

  @Test
  fun blankOptionalStrings_areTreatedAsAbsent() {
    val map = encode(
      PaymentResult(
        status = PaymentStatus.SUCCEEDED,
        paymentIntentId = UqpayTest.INTENT_ID,
        currency = "",
        transactionId = "",
        merchantOrderId = "",
      ),
    )
    assertFalse(map.hasKey("currency"))
    assertFalse(map.hasKey("transactionId"))
    assertFalse(map.hasKey("merchantOrderId"))
  }

  @Test
  fun malformedNativePayload_resultOkWithNoParcel_encodesAsFailedUnknown() {
    // What UQPayPaymentContract.parseResult builds when RESULT_OK carries no readable
    // parcel (launcher/UQPayPaymentContract.kt:74-86) — a genuine anomaly, never a success.
    val map = encode(
      PaymentResult(
        status = PaymentStatus.FAILED,
        paymentIntentId = "",
        error = UQPayError(
          code = UQPayErrorCode.UNKNOWN,
          message = "The payment could not be completed.",
          developerMessage = "no readable result parcel",
        ),
      ),
    )
    assertEquals("failed", map.getString("kind"))
    assertEquals("unknown", map.getMap("error")!!.getString("code"))
    assertEquals("", map.getString("paymentIntentId"))
  }

  @Test
  fun syntheticFailure_looksLikeAnyOtherFailedResult() {
    val map = UqpayResultEncoder.syntheticFailure(
      UqpayTest.INTENT_ID,
      "invalid_configuration",
      "no foreground Activity",
    ) as JavaOnlyMap
    assertEquals("failed", map.getString("kind"))
    assertEquals("android", map.getString("platform"))
    assertEquals("invalid_configuration", map.getMap("error")!!.getString("code"))
    assertTrue(map.getString("resultId")!!.isNotBlank())
  }
}
