package com.uqpay.reactnative

import com.facebook.react.bridge.JavaOnlyMap
import com.uqpay.sdk.error.UQPayError
import com.uqpay.sdk.error.UQPayErrorCode
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Drift guard against the shared RN-TEST3 fixtures (`scenarios.json`, generated from
 * `src/__tests__/fixtures/scenarios.ts` by `errors:sync`) — AC RN-PAR3, RN-TEST5.
 *
 * It checks what the contract makes the **Android** bridge responsible for: the vocabulary
 * of `kind` and `reason`, and the rule that only `timeout` is outcome-unknown. Two
 * scenarios deliberately describe shapes this native cannot produce; they are named below
 * with the reason, so a *new* disagreement fails rather than hiding among them.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UqpayScenarioParityTest {

  @Before fun setUp() = UqpayTest.installRuntime()

  @After fun tearDown() = UqpayTest.tearDown()

  private val kinds = setOf("completed", "failed", "canceled", "pending")
  private val reasons = setOf("user_cancelled", "merchant_cancelled", "intent_cancelled")

  private fun androidScenarios(): List<Pair<String, JSONObject>> {
    val text = checkNotNull(javaClass.classLoader?.getResourceAsStream("scenarios.json"))
      .bufferedReader()
      .use { it.readText() }
    val list = JSONObject(text).getJSONArray("scenarios")
    return (0 until list.length()).mapNotNull { index ->
      val scenario = list.getJSONObject(index)
      scenario.getJSONObject("native").optJSONObject("android")
        ?.let { scenario.getString("id") to it }
    }
  }

  @Test
  fun everyAndroidScenarioUsesTheKindAndReasonVocabularyThisEncoderEmits() {
    for ((id, native) in androidScenarios()) {
      if (id == "malformed_payload") continue // deliberately not-a-kind; a JS-guard fixture
      assertTrue("$id has kind ${native.getString("kind")}", native.getString("kind") in kinds)
      native.optString("reason", "").takeIf { it.isNotEmpty() }?.let {
        assertTrue("$id has reason $it", it in reasons)
      }
      assertEquals("$id", "android", native.getString("platform"))
    }
  }

  @Test
  fun everyAndroidScenarioErrorMatchesTheMappersOutcomeUnknownRule() {
    for ((id, native) in androidScenarios()) {
      val error = native.optJSONObject("error") ?: continue
      val code = error.getString("code")
      assertEquals(
        "$id: only `timeout` is outcome-unknown on Android (bridge-contract §3)",
        code == "timeout",
        error.optBoolean("isOutcomeUnknown", false),
      )
      val encoded = UqpayErrorMapper.encode(
        UQPayError(code = UQPayErrorCode.of(code), message = "m", developerMessage = "d"),
      ) as JavaOnlyMap
      assertEquals("$id: the mapper reproduces the fixture's code", code, encoded.getString("code"))
      assertEquals(
        "$id: the mapper reproduces the fixture's isOutcomeUnknown",
        error.optBoolean("isOutcomeUnknown", false),
        encoded.getBoolean("isOutcomeUnknown"),
      )
    }
  }

  @Test
  fun unknownWireCodeScenario_passesThroughWithRaw() {
    val (_, native) = androidScenarios().first { it.first == "unknown_error_code" }
    val code = native.getJSONObject("error").getString("code")
    val encoded = UqpayErrorMapper.encode(
      UQPayError(code = UQPayErrorCode.of(code), message = "m", developerMessage = "d"),
    ) as JavaOnlyMap
    assertEquals(code, encoded.getString("code"))
    assertEquals("an unrecognised code keeps its raw form (AC RN-ERR7)", code, encoded.getString("raw"))
  }

  @Test
  fun statusIsAssertedOnlyWhereThisNativeCanProduceIt() {
    // Lead decisions OQ-A2 and OQ-A3. Two fixture shapes are not this bridge's to produce,
    // so they are read **leniently** — present or absent, the suite stays green while
    // builder-js regenerates — and the strict assertions are made against the encoder:
    //
    //  1. `requires_capture`: the Android SDK collapses REQUIRES_CAPTURE into SUCCEEDED
    //     (engine/PaymentEngine.kt:735) and the contract says report SUCCEEDED. The
    //     separate `terminal_guard_requires_capture` cell is the iOS pre-read guard.
    //  2. a `status` on `pending`: `PaymentResult` carries no intent status, so the key is
    //     omitted rather than invented — which bridge-contract §3 allows ("if the native
    //     gives one").
    val byId = androidScenarios().toMap()

    byId["requires_capture"]?.optString("status", "")?.takeIf { it.isNotEmpty() }?.let { status ->
      assertTrue(
        "requires_capture carries status=$status; Android reports SUCCEEDED",
        status == "SUCCEEDED" || status == "REQUIRES_CAPTURE",
      )
    }
    for (id in listOf("dismiss_mid_confirm", "qr_expiry")) {
      val scenario = byId[id] ?: continue
      assertEquals("$id stays a pending result whatever its status says", "pending", scenario.getString("kind"))
    }

    assertEquals(
      "a completed payment always reports SUCCEEDED on Android",
      "SUCCEEDED",
      (UqpayResultEncoder.encode(UqpayTest.succeeded()) as JavaOnlyMap).getString("status"),
    )
    assertFalse(
      "the SDK gives no last-known intent status, so the key is omitted",
      (UqpayResultEncoder.encode(UqpayTest.pending()) as JavaOnlyMap).hasKey("status"),
    )
  }

  @Test
  fun everyFixtureCompletedAtIsIso8601Utc() {
    // Lenient on the fraction (OQ-I1 is landing in the fixtures separately), strict on the
    // shape: UTC, `T`-separated, `Z`-suffixed. What this bridge emits is asserted exactly
    // in `UqpayResultEncoderTest.completedAtAlwaysCarriesMillisecondPrecisionAndAZuluSuffix`.
    val iso8601Utc = Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z")
    for ((id, native) in androidScenarios()) {
      val completedAt = native.optString("completedAt", "").takeIf { it.isNotEmpty() } ?: continue
      assertTrue("$id carries completedAt=$completedAt", iso8601Utc.matches(completedAt))
    }
  }
}
