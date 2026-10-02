package com.uqpay.reactnative

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import com.uqpay.sdk.payment.PaymentSessionParams
import com.uqpay.sdk.payment.UQPayPaymentLauncher
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config

/**
 * `presentPaymentSheet` end to end through the real launcher (AC RN-CB8, RN-UX7, RN-UX8,
 * RN-ERR6, RN-FLOW1, RN-TEST8).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UqpayModulePresentTest {

  private lateinit var context: Context
  private lateinit var reactContext: TestReactContext
  private lateinit var module: UqpayModule
  private var controller: ActivityController<HostActivity>? = null

  @Before
  fun setUp() {
    UqpayTest.installRuntime()
    context = ApplicationProvider.getApplicationContext()
    UqpayNativeState.resetForTesting()
    reactContext = TestReactContext(context)
    module = UqpayModule(reactContext)
    module.initialize(UqpayTest.initConfig(configId = "cfg-present"), FakePromise())
    // A live token, so the pre-launch token fetch (which finds no JS listener here) falls
    // back to it and these tests exercise the launch itself. The tests that need the fetch
    // to run clear it.
    UqpayNativeState.cachedToken = CachedToken("test-token", UqpayRuntime.now() + 1_800_000L)
  }

  @After
  fun tearDown() {
    controller?.destroy()
    UqpayTest.tearDown()
  }

  /** Brings a host Activity up and tells the ReactContext about it, as RN would. */
  private fun resumeHost(): HostActivity {
    val created = Robolectric.buildActivity(HostActivity::class.java).setup()
    controller = created
    val activity = created.get()
    reactContext.onHostResume(activity)
    module.onHostResume()
    return activity
  }

  private fun startedPaymentIntents(activity: Activity): List<Intent> {
    val shadow = shadowOf(activity)
    val intents = mutableListOf<Intent>()
    while (true) {
      val next = shadow.nextStartedActivityForResult ?: break
      intents += next.intent
    }
    return intents
  }

  @Test
  fun present_launchesTheSdkActivityExactlyOnce() {
    val activity = resumeHost()
    val promise = FakePromise()

    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)

    val started = startedPaymentIntents(activity)
    assertEquals(1, started.size)
    assertEquals("com.uqpay.sdk.ui.UQPayPaymentActivity", started[0].component!!.className)
    assertTrue(started[0].hasExtra("com.uqpay.sdk.extra.PARAMS"))
    assertEquals("the promise waits for the sheet", 0, promise.settleCount)
    assertTrue(UqpayNativeState.isPresenting)
  }

  @Test
  fun present_thenTheResultResolvesThatVeryPromiseOnce() {
    val activity = resumeHost()
    val promise = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)

    UqpayNativeState.testCallback().onResult(UqpayTest.succeeded())

    assertEquals(1, promise.settleCount)
    assertEquals("completed", promise.map().getString("kind"))
    assertEquals(1, startedPaymentIntents(activity).size)
  }

  @Test
  fun doublePresent_resolvesTheSecondCallFailedAndLaunchesOnlyOnce() {
    val activity = resumeHost()
    val first = FakePromise()
    val second = FakePromise()

    module.presentPaymentSheet(UqpayTest.presentOptions(), first)
    module.presentPaymentSheet(UqpayTest.presentOptions(), second)

    assertEquals("exactly one native sheet (AC RN-UX7)", 1, startedPaymentIntents(activity).size)
    assertEquals(0, first.settleCount)
    assertEquals(1, second.settleCount)
    assertEquals("failed", second.map().getString("kind"))
    assertEquals("invalid_configuration", second.map().getMap("error")!!.getString("code"))
    assertTrue(second.map().getMap("error")!!.getString("developerMessage")!!.contains("already presented"))
  }

  @Test
  fun doublePresentForDifferentIntents_isAlsoRefused() {
    val activity = resumeHost()
    module.presentPaymentSheet(UqpayTest.presentOptions(paymentIntentId = "PI_a"), FakePromise())

    val second = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(paymentIntentId = "PI_b"), second)

    assertEquals("one active sheet per process (AC RN-UX8)", 1, startedPaymentIntents(activity).size)
    assertEquals("failed", second.map().getString("kind"))
    assertEquals("PI_b", second.map().getString("paymentIntentId"))
  }

  @Test
  fun presentWithNoForegroundActivity_resolvesFailedInvalidConfiguration() {
    // No `onHostResume`, so `getCurrentActivity()` is null (AC RN-CB8).
    val promise = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)

    assertEquals(1, promise.settleCount)
    assertEquals("failed", promise.map().getString("kind"))
    val error = promise.map().getMap("error")!!
    assertEquals("invalid_configuration", error.getString("code"))
    assertTrue(error.getString("developerMessage")!!.contains("no foreground Activity"))
    assertFalse("the failed claim is released (AC RN-FLOW1)", UqpayNativeState.isPresenting)
  }

  @Test
  fun presentAfterTheFailedActivityCheck_canStillPresentLater() {
    module.presentPaymentSheet(UqpayTest.presentOptions(), FakePromise())
    val activity = resumeHost()

    val promise = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)

    assertEquals(1, startedPaymentIntents(activity).size)
    assertEquals(0, promise.settleCount)
  }

  @Test
  fun presentWithABlankIntentId_rejectsWithInvalidConfiguration() {
    // A fresh state with nothing initialised, exactly as a first launch would be.
    UqpayNativeState.resetForTesting()
    val fresh = UqpayModule(TestReactContext(context))
    val promise = FakePromise()

    // `UQPay` is a process singleton and cannot be de-initialised, so this asserts the
    // blank-id guard on the same rejecting path; the `not_initialized` branch is covered
    // by reading `UQPay.isInitialized` in `getNativeInfo`.
    fresh.presentPaymentSheet(UqpayTest.presentOptions(paymentIntentId = "  "), promise)

    assertTrue(promise.isRejected)
    assertEquals("invalid_configuration", promise.rejectedCode)
  }

  @Test
  fun aLauncherThatThrows_releasesTheClaimAndSettlesThePromiseOnce() {
    // Issues row 2 (RN-UX7 / RN-UX8 / RN-CB1). The SDK documents a dead host as a callback,
    // not a throw — but if `launch` ever throws for any other reason, an uncaught main-thread
    // exception would strand `isPresenting` and leave this promise pending forever.
    val activity = resumeHost()
    UqpayNativeState.putRegistrationForTesting(
      activity,
      object : UQPayPaymentLauncher {
        override fun launch(params: PaymentSessionParams) =
          throw IllegalStateException("Attempting to launch an unregistered ActivityResultLauncher")

        override fun cancel() = Unit
      },
    )

    val promise = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)

    assertEquals("settles exactly once, never zero times", 1, promise.settleCount)
    assertEquals("failed", promise.map().getString("kind"))
    val error = promise.map().getMap("error")!!
    assertEquals("invalid_configuration", error.getString("code"))
    assertTrue(
      "the developer message names the exception class",
      error.getString("developerMessage")!!.contains("java.lang.IllegalStateException"),
    )
    assertFalse(
      "the sheet claim is released, so a later present still works",
      UqpayNativeState.isPresenting,
    )
    assertEquals("nothing reached the OS", 0, startedPaymentIntents(activity).size)
  }

  @Test
  fun aLauncherThatThrows_doesNotBlockTheNextPresent() {
    val activity = resumeHost()
    UqpayNativeState.putRegistrationForTesting(
      activity,
      object : UQPayPaymentLauncher {
        override fun launch(params: PaymentSessionParams): Unit = throw RuntimeException("boom")
        override fun cancel() = Unit
      },
    )
    module.presentPaymentSheet(UqpayTest.presentOptions(), FakePromise())

    // A real registration again, as a recreated Activity would produce.
    UqpayNativeState.unregister(activity)
    val second = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), second)

    assertEquals("the second call reached the SDK", 1, startedPaymentIntents(activity).size)
    assertEquals("and is still waiting on the sheet", 0, second.settleCount)
  }

  // ---- the pre-launch token fetch window ---------------------------------------------------

  /** Holds the pre-launch token fetch so a test can act while it is "in flight". */
  private fun deferTokenFetch(): MutableList<Runnable> {
    val parked = mutableListOf<Runnable>()
    UqpayRuntime.runOffThread = { parked += it }
    return parked
  }

  @Test
  fun cancelDuringTheTokenFetch_neverLaunchesAndSettlesMerchantCancelled() {
    val activity = resumeHost()
    val parked = deferTokenFetch()
    val promise = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)
    assertEquals(1, parked.size)

    module.cancelPaymentSheet(FakePromise())
    parked.single().run() // the token fetch completes

    assertEquals("no sheet may open after the merchant cancelled", 0, startedPaymentIntents(activity).size)
    assertEquals(1, promise.settleCount)
    assertEquals("canceled", promise.map().getString("kind"))
    assertEquals("merchant_cancelled", promise.map().getString("reason"))
    assertEquals(UqpayTest.INTENT_ID, promise.map().getString("paymentIntentId"))
    assertFalse(UqpayNativeState.isPresenting)
    assertFalse("the flag ends with the session", UqpayNativeState.merchantCancelRequested)
  }

  @Test
  fun cancelDuringTheTokenFetch_hasTheSameShapeAsAMerchantCancelOfALiveSheet() {
    resumeHost()
    val parked = deferTokenFetch()
    val early = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), early)
    module.cancelPaymentSheet(FakePromise())
    parked.single().run()

    UqpayRuntime.runOffThread = { it.run() }
    val live = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), live)
    module.cancelPaymentSheet(FakePromise())
    UqpayNativeState.testCallback().onResult(UqpayTest.cancelled())

    val earlyMap = early.map().toHashMap().apply { remove("resultId") }
    val liveMap = live.map().toHashMap().apply { remove("resultId") }
    assertEquals(liveMap, earlyMap)
  }

  @Test
  fun aCancelledTokenFetch_doesNotMislabelTheNextCustomerCancel() {
    val activity = resumeHost()
    val parked = deferTokenFetch()
    module.presentPaymentSheet(UqpayTest.presentOptions(), FakePromise())
    module.cancelPaymentSheet(FakePromise())
    parked.single().run()

    UqpayRuntime.runOffThread = { it.run() }
    val next = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), next)
    assertEquals(1, startedPaymentIntents(activity).size)
    UqpayNativeState.testCallback().onResult(UqpayTest.cancelled())

    assertEquals("user_cancelled", next.map().getString("reason"))
  }

  @Test
  fun aStaleMerchantCancelFlag_isClearedWhenTheNextSessionBegins() {
    val activity = resumeHost()
    // As if a cancel raced the previous session's end and set the flag just after it.
    UqpayNativeState.merchantCancelRequested = true

    val promise = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)
    assertEquals("the new session launches", 1, startedPaymentIntents(activity).size)
    UqpayNativeState.testCallback().onResult(UqpayTest.cancelled())

    assertEquals("user_cancelled", promise.map().getString("reason"))
  }

  @Test
  fun aTokenFetchThatTimesOut_settlesAuthenticationFailedWithoutLaunching() {
    val activity = resumeHost()
    UqpayNativeState.cachedToken = null
    module.addListener(UqpayNativeState.EVENT_TOKEN_REQUESTED)

    val promise = FakePromise()
    // Nobody answers `uqpay_tokenRequested`; the 50 ms test budget runs out.
    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)

    assertEquals("the merchant's provider was asked", 1, reactContext.emittedEvents.size)
    assertEquals(0, startedPaymentIntents(activity).size)
    assertEquals(1, promise.settleCount)
    assertEquals("failed", promise.map().getString("kind"))
    val error = promise.map().getMap("error")!!
    assertEquals("authentication_failed", error.getString("code"))
    assertFalse("no payment was attempted", error.getBoolean("isOutcomeUnknown"))
    assertTrue(error.getString("developerMessage")!!.contains("did not answer within"))
    assertFalse(UqpayNativeState.isPresenting)
  }

  @Test
  fun aTokenFetchWithNoJavaScriptListener_settlesAuthenticationFailedWithoutLaunching() {
    val activity = resumeHost()
    UqpayNativeState.cachedToken = null

    val promise = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)

    assertEquals(0, startedPaymentIntents(activity).size)
    assertEquals("failed", promise.map().getString("kind"))
    val error = promise.map().getMap("error")!!
    assertEquals("authentication_failed", error.getString("code"))
    assertTrue(error.getString("developerMessage")!!.contains("no JavaScript listener"))
    assertFalse(UqpayNativeState.isPresenting)
  }

  @Test
  fun aTokenFetchThatSucceeds_launchesTheSheet() {
    val activity = resumeHost()
    UqpayNativeState.cachedToken = null
    module.addListener(UqpayNativeState.EVENT_TOKEN_REQUESTED)
    // JS answers as soon as it is asked, from inside the emit.
    UqpayNativeState.eventSink = { _, payload ->
      val requestId = (payload as com.facebook.react.bridge.JavaOnlyMap).getString("requestId")!!
      module.provideToken(requestId, "js-token", -1.0)
    }

    val promise = FakePromise()
    module.presentPaymentSheet(UqpayTest.presentOptions(), promise)

    assertEquals(1, startedPaymentIntents(activity).size)
    assertEquals(0, promise.settleCount)
    assertEquals("js-token", UqpayNativeState.tokenProvider.fetchToken().value)
  }

  @Test
  fun cancelPaymentSheet_reachesTheLauncherAndResolves() {
    resumeHost()
    module.presentPaymentSheet(UqpayTest.presentOptions(), FakePromise())

    val promise = FakePromise()
    module.cancelPaymentSheet(promise)

    assertTrue(promise.isResolved)
    assertNull(promise.resolvedValue)
    assertTrue("the encoder can now say merchant_cancelled", UqpayNativeState.merchantCancelRequested)
  }

  @Test
  fun afterATerminalResultAndHostDestroy_noRegistrationIsLeftBehind() {
    val activity = resumeHost()
    module.presentPaymentSheet(UqpayTest.presentOptions(), FakePromise())
    assertEquals(1, UqpayNativeState.registrationCount())

    UqpayNativeState.testCallback().onResult(UqpayTest.succeeded())
    module.onHostDestroy()

    // AC RN-TEST8: no dangling ActivityResult registration once the host is gone.
    assertEquals(0, UqpayNativeState.registrationCount())
    assertFalse(UqpayNativeState.isPresenting)
    assertNotNull(activity)
  }

  @Test
  fun invalidateFromAnOlderModule_doesNotUnregisterTheLiveOne() {
    resumeHost()
    val older = module
    val newer = UqpayModule(TestReactContext(context))
    UqpayNativeState.ensureRegistered(reactContext.currentActivity)
    assertEquals(1, UqpayNativeState.registrationCount())

    older.invalidate()

    assertEquals("Metro reload safety (spike S1, caveat 5)", 1, UqpayNativeState.registrationCount())
    newer.invalidate()
    assertEquals(0, UqpayNativeState.registrationCount())
  }

  @Test
  fun addAndRemoveListeners_driveTheListenerGate() {
    assertFalse(UqpayNativeState.hasListeners())
    module.addListener("uqpay_tokenRequested")
    assertTrue(UqpayNativeState.hasListeners())
    module.removeListeners(1.0)
    assertFalse(UqpayNativeState.hasListeners())
    module.removeListeners(5.0)
    assertFalse("the count never goes negative", UqpayNativeState.hasListeners())
  }

  // ---- option marshalling ------------------------------------------------------------------

  @Test
  fun presentationModeAndAllowedMethods_areMarshalledOntoSessionParams() {
    val options = UqpayTest.presentOptions(presentationMode = "singleWallet").apply {
      putString("singleWalletMethod", "grabpay")
      putArray(
        "allowedPaymentMethods",
        com.facebook.react.bridge.JavaOnlyArray().apply {
          pushString("grabpay")
          pushString("paynow")
        },
      )
      putMap(
        "billingDetails",
        com.facebook.react.bridge.JavaOnlyMap().apply {
          putString("firstName", "Ada")
          putString("countryCode", "SG")
        },
      )
    }

    val params = module.buildSessionParams(UqpayTest.INTENT_ID, options)

    val presentation = params.presentation as PaymentSessionParams.Presentation.SingleWallet
    assertEquals("grabpay", presentation.method.raw)
    assertEquals(setOf("grabpay", "paynow"), params.allowedPaymentMethods!!.map { it.raw }.toSet())
    assertEquals("Ada", params.billingDetails!!.firstName)
    assertEquals("SG", params.billingDetails!!.countryCode)
    assertNull("nothing card-derived crosses the bridge", params.billingDetails!!.email)
  }

  @Test
  fun cardOnlyAndMethodListPresentationModes() {
    assertEquals(
      PaymentSessionParams.Presentation.CardOnly,
      module.buildSessionParams(
        UqpayTest.INTENT_ID,
        UqpayTest.presentOptions(presentationMode = "cardOnly"),
      ).presentation,
    )
    assertEquals(
      PaymentSessionParams.Presentation.MethodList,
      module.buildSessionParams(UqpayTest.INTENT_ID, UqpayTest.presentOptions()).presentation,
    )
  }

  @Test
  fun singleWalletWithoutAMethod_fallsBackToTheMethodListRatherThanCrashing() {
    assertEquals(
      PaymentSessionParams.Presentation.MethodList,
      module.buildSessionParams(
        UqpayTest.INTENT_ID,
        UqpayTest.presentOptions(presentationMode = "singleWallet"),
      ).presentation,
    )
  }

  @Test
  fun absentOptionalOptions_produceNullsNotEmpties() {
    val params = module.buildSessionParams(UqpayTest.INTENT_ID, UqpayTest.presentOptions())
    assertNull(params.allowedPaymentMethods)
    assertNull(params.billingDetails)
  }
}
