package com.uqpay.reactnative

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import com.uqpay.sdk.UQPay
import com.uqpay.sdk.error.UQPayError
import com.uqpay.sdk.error.UQPayErrorCode
import com.uqpay.sdk.payment.PaymentResult
import com.uqpay.sdk.payment.PaymentSessionParams
import com.uqpay.sdk.payment.PaymentStatus
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config

/**
 * The ActivityResult registration (AC RN-BR1, RN-CB6, RN-UX2), lifted from spike S1 onto
 * the shipped `RegistryShim`. These are the tests that justify the whole escape hatch, so
 * they stay in the product's own suite rather than only in the spike project.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RegistryShimTest {

  @Before
  fun setUp() {
    UqpayTest.installRuntime()
    UqpayNativeState.resetForTesting()
  }

  private var controller: ActivityController<HostActivity>? = null

  @After
  fun tearDown() {
    controller?.destroy()
    controller = null
    UqpayTest.tearDown()
  }

  /**
   * A RESUMED host. `Robolectric.buildActivity` rather than `ActivityScenario` because an
   * Android **library** has no application manifest for the scenario launcher to resolve
   * the Activity against.
   */
  private fun resumedController(): ActivityController<HostActivity> =
    Robolectric.buildActivity(HostActivity::class.java).setup().also { controller = it }

  private fun resumed(): HostActivity = resumedController().get()

  @Test
  fun control_plainComponentActivityRegisterAfterResume_throws() {
    resumed().let { activity ->
      val error = assertThrows(IllegalStateException::class.java) {
        activity.registerForActivityResult(EchoContract()) { }
      }
      assertTrue(error.message!!, error.message!!.contains("must call register before they are STARTED"))
    }
  }

  @Test
  fun shim_registerAfterResume_doesNotThrow() {
    resumed().let { activity ->
      assertNotNull(RegistryShim(activity).registerForActivityResult(EchoContract()) { })
    }
  }

  @Test
  fun parkedResult_dispatchedWhileNobodyRegistered_isReplayedOnSameKeyRegister() {
    resumed().let { activity ->
      val shim = RegistryShim(activity)
      shim.registerForActivityResult(EchoContract()) { fail("the first callback must not fire") }
        .launch("hello")
      val requestCode = shadowOf(activity).nextStartedActivityForResult.requestCode
      shim.unregister()

      activity.deliver(requestCode, Activity.RESULT_OK, Intent().putExtra("out", "world"))

      val received = mutableListOf<String?>()
      RegistryShim(activity).registerForActivityResult(EchoContract()) { received += it }
      assertEquals(listOf("world"), received)
    }
  }

  @Test
  fun recreate_parkedResultIsReplayedToTheStableKeyOnly() {
    val scenario = resumedController()
    val first = scenario.get()
    RegistryShim(first).registerForActivityResult(EchoContract()) { fail("old instance") }
      .launch("hello")
    val requestCode = shadowOf(first).nextStartedActivityForResult.requestCode

    // The same save/restore round trip the OS performs after a process kill: a brand new
    // Activity instance with a registry rebuilt from the saved-state bundle.
    scenario.recreate()

    val received = mutableListOf<String?>()
    scenario.get().let { activity ->
      activity.deliver(requestCode, Activity.RESULT_OK, Intent().putExtra("out", "survived"))
      assertTrue(received.isEmpty())

      RegistryShim(activity, key = "com.uqpay.rn.some-other-key")
        .registerForActivityResult(EchoContract()) { fail("another key must not receive") }
      assertTrue(received.isEmpty())

      RegistryShim(activity).registerForActivityResult(EchoContract()) { received += it }
      assertEquals(listOf("survived"), received)
    }
  }

  @Test
  fun unregister_thenRegisterSameKey_worksAndDelivers() {
    resumed().let { activity ->
      val first = RegistryShim(activity)
      first.registerForActivityResult(EchoContract()) { fail("unregistered") }
      first.unregister()

      val received = mutableListOf<String?>()
      val second = RegistryShim(activity)
      second.registerForActivityResult(EchoContract()) { received += it }.launch("again")
      val requestCode = shadowOf(activity).nextStartedActivityForResult.requestCode
      activity.deliver(requestCode, Activity.RESULT_OK, Intent().putExtra("out", "second"))
      assertEquals(listOf("second"), received)
    }
  }

  @Test
  fun sameKey_secondRegistrationReplacesTheFirstCallback() {
    resumed().let { activity ->
      val hits = mutableListOf<String>()
      RegistryShim(activity).registerForActivityResult(EchoContract()) { hits += "first:$it" }
      val second = RegistryShim(activity).registerForActivityResult(EchoContract()) { hits += "second:$it" }
      second.launch("x")
      val requestCode = shadowOf(activity).nextStartedActivityForResult.requestCode
      activity.deliver(requestCode, Activity.RESULT_OK, Intent().putExtra("out", "y"))
      assertEquals(listOf("second:y"), hits)
    }
  }

  @Test
  fun theStableKeyIsThePermanentOne() {
    assertEquals("com.uqpay.rn.payment", RegistryShim.STABLE_KEY)
  }

  // ---- through the published SDK ---------------------------------------------------------

  @Test
  fun realSdk_createPaymentLauncherThroughTheShimAfterResume_deliversAParsedResult() {
    UqpayTest.initializeSdk(ApplicationProvider.getApplicationContext<Context>())

    resumed().let { activity ->
      val control = assertThrows(IllegalStateException::class.java) {
        UQPay.createPaymentLauncher(activity) { }
      }
      assertTrue(control.message!!.contains("STARTED"))

      val results = mutableListOf<PaymentResult>()
      UQPay.createPaymentLauncher(RegistryShim(activity)) { results += it }
        .launch(PaymentSessionParams(UqpayTest.INTENT_ID))

      val started = shadowOf(activity).nextStartedActivityForResult
      assertEquals(
        "com.uqpay.sdk.ui.UQPayPaymentActivity",
        started.intent.component!!.className,
      )

      activity.deliver(
        started.requestCode,
        Activity.RESULT_OK,
        Intent()
          .putExtra(
            "com.uqpay.sdk.extra.RESULT",
            PaymentResult(
              status = PaymentStatus.FAILED,
              paymentIntentId = UqpayTest.INTENT_ID,
              error = UQPayError(
                code = UQPayErrorCode.AUTHENTICATION_FAILED,
                message = "m",
                developerMessage = "d",
              ),
            ),
          )
          .putExtra("com.uqpay.sdk.extra.INTENT_ID", UqpayTest.INTENT_ID),
      )

      assertEquals(1, results.size)
      assertEquals(PaymentStatus.FAILED, results[0].status)
      assertEquals(UQPayErrorCode.AUTHENTICATION_FAILED, results[0].error?.code)
    }
  }

  @Test
  fun ensureRegistered_isIdempotentPerActivityInstance() {
    UqpayTest.initializeSdk(ApplicationProvider.getApplicationContext<Context>())
    resumed().let { activity ->
      val first = UqpayNativeState.ensureRegistered(activity)
      val second = UqpayNativeState.ensureRegistered(activity)
      assertNotNull(first)
      assertTrue("the same registration is reused", first === second)
      assertEquals(1, UqpayNativeState.registrationCount())
    }
  }

  @Test
  fun ensureRegisteredWithNoActivity_returnsNullRatherThanThrowing() {
    UqpayTest.initializeSdk(ApplicationProvider.getApplicationContext<Context>())
    assertEquals(null, UqpayNativeState.ensureRegistered(null))
  }
}
