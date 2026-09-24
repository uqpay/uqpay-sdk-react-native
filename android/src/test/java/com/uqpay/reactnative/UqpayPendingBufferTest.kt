package com.uqpay.reactnative

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.JavaOnlyMap
import com.uqpay.sdk.error.UQPayErrorCode
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The pending-result buffer: exactly once, whether or not JavaScript was listening
 * (bridge-contract §4, AC RN-CB1, RN-CB6, RN-API9).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UqpayPendingBufferTest {

  private lateinit var context: Context
  private lateinit var module: UqpayModule

  @Before
  fun setUp() {
    UqpayTest.installRuntime()
    context = ApplicationProvider.getApplicationContext()
    UqpayNativeState.resetForTesting()
    module = UqpayModule(TestReactContext(context))
    UqpayTest.initializeSdk(context)
  }

  @After fun tearDown() = UqpayTest.tearDown()

  /** Drives a result in through the very callback every launcher shares. */
  private fun deliver(result: com.uqpay.sdk.payment.PaymentResult) =
    UqpayNativeState.testCallback().onResult(result)

  @Test
  fun resultWithAPromiseAttached_resolvesItAndLeavesNothingBuffered() {
    val promise = FakePromise()
    UqpayNativeState.beginPresenting(UqpayTest.INTENT_ID, promise)

    deliver(UqpayTest.succeeded())

    assertEquals(1, promise.settleCount)
    assertEquals("completed", promise.map().getString("kind"))
    assertEquals(false, UqpayNativeState.hasBufferedResult())

    val pending = FakePromise()
    module.getPendingResult(pending)
    assertNull("nothing is delivered twice (AC RN-CB1)", pending.resolvedValue)
  }

  @Test
  fun resultWithNoPromiseAttached_isBufferedAndReturnedOnceByGetPendingResult() {
    deliver(UqpayTest.succeeded())
    assertTrue(UqpayNativeState.hasBufferedResult())

    val first = FakePromise()
    module.getPendingResult(first)
    assertEquals("completed", (first.resolvedValue as JavaOnlyMap).getString("kind"))

    val second = FakePromise()
    module.getPendingResult(second)
    assertNull("exactly once (AC RN-CB6)", second.resolvedValue)
  }

  @Test
  fun rePresentingTheSameIntent_resolvesFromTheBufferWithoutLaunching() {
    deliver(UqpayTest.succeeded())

    val promise = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)

    assertEquals(1, promise.settleCount)
    assertEquals("completed", promise.map().getString("kind"))
    assertEquals("the re-attach consumes the buffer", false, UqpayNativeState.hasBufferedResult())
    assertEquals("no sheet was claimed", false, UqpayNativeState.isPresenting)
  }

  @Test
  fun rePresentingADifferentIntent_doesNotStealTheBufferedResult() {
    deliver(UqpayTest.succeeded(paymentIntentId = "PI_old"))

    val promise = FakePromise()
    // No Activity is resumed, so this resolves `failed` — the point is that it does not
    // hand back the other intent's result.
    module.presentPaymentSheet(UqpayTest.presentOptions(paymentIntentId = "PI_new"), promise)

    assertEquals("failed", promise.map().getString("kind"))
    assertEquals("PI_new", promise.map().getString("paymentIntentId"))
    assertTrue("PI_old's result is still waiting", UqpayNativeState.hasBufferedResult())
  }

  @Test
  fun aSecondResultReplacesAnUnconsumedOne_andStillDeliversOnce() {
    deliver(UqpayTest.cancelled())
    deliver(UqpayTest.succeeded())

    val promise = FakePromise()
    module.getPendingResult(promise)
    assertEquals("completed", (promise.resolvedValue as JavaOnlyMap).getString("kind"))
    assertEquals(false, UqpayNativeState.hasBufferedResult())
  }

  @Test
  fun aTerminalResultAlwaysClearsIsPresenting() {
    UqpayNativeState.beginPresenting(UqpayTest.INTENT_ID, FakePromise())
    assertTrue(UqpayNativeState.isPresenting)

    deliver(UqpayTest.pending())

    assertEquals("pending is final for the promise", false, UqpayNativeState.isPresenting)
  }

  @Test
  fun merchantCancelFlag_isConsumedByTheNextResultOnly() {
    UqpayNativeState.beginPresenting(UqpayTest.INTENT_ID, FakePromise())
    module.cancelPaymentSheet(FakePromise())
    assertTrue(UqpayNativeState.merchantCancelRequested)

    deliver(UqpayTest.cancelled())
    assertEquals(false, UqpayNativeState.merchantCancelRequested)

    val first = FakePromise()
    module.getPendingResult(first)
    // The promise attached by beginPresenting already took it, so the buffer is empty and
    // the flag cannot leak into a later customer cancel.
    assertNull(first.resolvedValue)

    deliver(UqpayTest.cancelled())
    val second = FakePromise()
    module.getPendingResult(second)
    assertEquals("user_cancelled", (second.resolvedValue as JavaOnlyMap).getString("reason"))
  }

  @Test
  fun cancelBeforeAnyActivityExists_resolvesAndDoesNotThrow() {
    val promise = FakePromise()
    module.cancelPaymentSheet(promise)
    assertTrue("the documented no-op window (bug B45)", promise.isResolved)
    assertEquals(1, promise.settleCount)
  }

  @Test
  fun notifyReturnedFromBank_isANoOpOnAndroid() {
    module.notifyReturnedFromBank()
    assertEquals(false, UqpayNativeState.hasBufferedResult())
  }

  @Test
  fun moduleInvalidateMidSheet_dropsTheDeadPromiseSoTheResultIsBuffered() {
    // Issue #8: a Metro reload tears the module down while the sheet is open.
    val dead = FakePromise()
    UqpayNativeState.beginPresenting(UqpayTest.INTENT_ID, dead)

    module.invalidate()
    deliver(UqpayTest.succeeded())

    assertEquals("a dead context is never resolved", 0, dead.settleCount)
    assertTrue("the result waits for the next context (AC RN-CB6)", UqpayNativeState.hasBufferedResult())

    val next = UqpayModule(TestReactContext(context))
    val recovered = FakePromise()
    next.getPendingResult(recovered)
    assertEquals("completed", (recovered.resolvedValue as JavaOnlyMap).getString("kind"))
  }

  @Test
  fun rePresentingTheIntentStillOnScreenAfterAReload_attachesTheNewPromise() {
    val dead = FakePromise()
    UqpayNativeState.beginPresenting(UqpayTest.INTENT_ID, dead)
    module.invalidate()

    val next = UqpayModule(TestReactContext(context))
    val reattached = FakePromise()
    next.presentPaymentSheet(UqpayTest.presentOptions(), reattached)
    assertEquals("no second launch, no synthetic failure", 0, reattached.settleCount)

    deliver(UqpayTest.succeeded())

    assertEquals(0, dead.settleCount)
    assertEquals(1, reattached.settleCount)
    assertEquals("completed", reattached.map().getString("kind"))
    assertEquals(false, UqpayNativeState.hasBufferedResult())
  }
  // ---- process death while the sheet was on top ----------------------------------------------

  @Test
  fun aRestoredSheetReportingNotInitialized_isBufferedAsOutcomeUnknownPending() {
    // Process death: the SDK's Activity came back before React Native re-initialised the
    // SDK, gave up with FAILED / not_initialized, and the OS replayed that result into a
    // process that never launched a sheet. The customer may have paid.
    deliver(UqpayTest.failed(code = UQPayErrorCode.NOT_INITIALIZED, developerMessage = "Call UQPay.initialize"))

    val promise = FakePromise()
    module.getPendingResult(promise)
    val result = promise.resolvedValue as JavaOnlyMap
    assertEquals("pending", result.getString("kind"))
    assertEquals(UqpayTest.INTENT_ID, result.getString("paymentIntentId"))
    val error = result.getMap("error")!!
    assertEquals("the same cause as an SDK PENDING", "timeout", error.getString("code"))
    assertEquals(true, error.getBoolean("isOutcomeUnknown"))
    assertEquals(UqpayNativeState.RESTORED_SHEET_MESSAGE, error.getString("developerMessage"))
  }

  @Test
  fun aRestoredSheetResult_hasTheShapeOfAnSdkPendingTimeout() {
    deliver(UqpayTest.failed(code = UQPayErrorCode.NOT_INITIALIZED))
    val restored = FakePromise().also { module.getPendingResult(it) }.resolvedValue as JavaOnlyMap
    deliver(UqpayTest.pending())
    val sdkPending = FakePromise().also { module.getPendingResult(it) }.resolvedValue as JavaOnlyMap

    assertEquals(sdkPending.toHashMap().keys, restored.toHashMap().keys)
    assertEquals(
      sdkPending.getMap("error")!!.toHashMap().keys,
      restored.getMap("error")!!.toHashMap().keys,
    )
  }

  @Test
  fun notInitializedFromASheetThisProcessLaunched_staysAGenuineFailure() {
    // Not a restore: the sheet was launched by this process, so nothing can have been paid.
    val promise = FakePromise()
    UqpayNativeState.beginPresenting(UqpayTest.INTENT_ID, promise)

    deliver(UqpayTest.failed(code = UQPayErrorCode.NOT_INITIALIZED))

    assertEquals("failed", promise.map().getString("kind"))
    val error = promise.map().getMap("error")!!
    assertEquals("not_initialized", error.getString("code"))
    assertEquals(false, error.getBoolean("isOutcomeUnknown"))
  }

  @Test
  fun otherRestoredFailures_areNotMasked() {
    deliver(UqpayTest.failed(code = UQPayErrorCode.CARD_DECLINED))

    val promise = FakePromise()
    module.getPendingResult(promise)
    val result = promise.resolvedValue as JavaOnlyMap
    assertEquals("failed", result.getString("kind"))
    assertEquals("card_declined", result.getMap("error")!!.getString("code"))
  }
}
