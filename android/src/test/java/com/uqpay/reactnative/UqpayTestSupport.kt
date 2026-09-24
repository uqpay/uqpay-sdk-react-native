package com.uqpay.reactnative

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContract
import com.facebook.react.bridge.CatalystInstance
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.JavaScriptContextHolder
import com.facebook.react.bridge.JavaScriptModule
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.RuntimeExecutor
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder
import com.uqpay.sdk.Environment
import com.uqpay.sdk.UQPay
import com.uqpay.sdk.UQPayConfiguration
import com.uqpay.sdk.error.UQPayError
import com.uqpay.sdk.error.UQPayErrorCode
import com.uqpay.sdk.payment.PaymentResult
import com.uqpay.sdk.payment.PaymentStatus
import java.math.BigDecimal
import java.util.concurrent.atomic.AtomicInteger

/**
 * Plain fakes for the bridge-contract suite (AC RN-TEST5). No mocking framework: every
 * double here is a handful of lines, and a fake that can be read is worth more than a mock
 * that has to be trusted.
 */

/** Records exactly how a promise settled, so "exactly once" is assertable (AC RN-CB1). */
class FakePromise : Promise {
  var resolvedValue: Any? = null
    private set
  var rejectedCode: String? = null
    private set
  var rejectedMessage: String? = null
    private set
  var settleCount: Int = 0
    private set

  val isResolved: Boolean get() = settleCount > 0 && rejectedCode == null
  val isRejected: Boolean get() = rejectedCode != null

  /** The resolved value as a map, for the many assertions that read result fields. */
  fun map(): JavaOnlyMap = resolvedValue as JavaOnlyMap

  override fun resolve(value: Any?) {
    settleCount += 1
    resolvedValue = value
  }

  override fun reject(code: String?, message: String?) {
    settleCount += 1
    rejectedCode = code
    rejectedMessage = message
  }

  override fun reject(code: String?, throwable: Throwable?) = reject(code, throwable?.message)

  override fun reject(code: String?, message: String?, throwable: Throwable?) = reject(code, message)

  override fun reject(throwable: Throwable) = reject("unknown", throwable.message)

  override fun reject(throwable: Throwable, userInfo: WritableMap) = reject("unknown", throwable.message)

  override fun reject(code: String?, userInfo: WritableMap) = reject(code, null as String?)

  override fun reject(code: String?, throwable: Throwable?, userInfo: WritableMap) =
    reject(code, throwable?.message)

  override fun reject(code: String?, message: String?, userInfo: WritableMap) = reject(code, message)

  override fun reject(code: String?, message: String?, throwable: Throwable?, userInfo: WritableMap?) =
    reject(code, message)

  override fun reject(message: String) = reject("unknown", message)
}

/** One `(name, payload)` pair per emitted event. */
data class EmittedEvent(val name: String, val payload: ReadableMap)

/**
 * A concrete `ReactApplicationContext` with no catalyst instance: enough for the module's
 * constructor, its lifecycle listener and `getCurrentActivity()`, and it returns a fake
 * `RCTDeviceEventEmitter` so `emit` is observable without JNI.
 */
class TestReactContext(context: Context) : ReactApplicationContext(context) {

  val emittedEvents: MutableList<EmittedEvent> = mutableListOf()

  private val emitter = object : DeviceEventManagerModule.RCTDeviceEventEmitter {
    override fun emit(eventName: String, data: Any?) {
      emittedEvents += EmittedEvent(eventName, data as ReadableMap)
    }
  }

  @Suppress("UNCHECKED_CAST")
  override fun <T : JavaScriptModule> getJSModule(jsInterface: Class<T>): T {
    if (jsInterface == DeviceEventManagerModule.RCTDeviceEventEmitter::class.java) {
      return emitter as T
    }
    throw UnsupportedOperationException("TestReactContext has no $jsInterface")
  }

  override fun <T : NativeModule> hasNativeModule(nativeModuleInterface: Class<T>): Boolean = false

  override fun getNativeModules(): Collection<NativeModule> = emptyList()

  override fun <T : NativeModule> getNativeModule(nativeModuleInterface: Class<T>): T? = null

  override fun getNativeModule(nativeModuleName: String): NativeModule? = null

  override fun getCatalystInstance(): CatalystInstance =
    throw UnsupportedOperationException("no catalyst instance in tests")

  override fun hasActiveCatalystInstance(): Boolean = false

  override fun hasActiveReactInstance(): Boolean = false

  override fun hasCatalystInstance(): Boolean = false

  override fun hasReactInstance(): Boolean = false

  override fun getRuntimeExecutor(): RuntimeExecutor? = null

  override fun destroy() = Unit

  override fun handleException(e: Exception) = throw e

  override fun isBridgeless(): Boolean = true

  override fun getJavaScriptContextHolder(): JavaScriptContextHolder? = null

  override fun getJSCallInvokerHolder(): CallInvokerHolder? = null

  override fun getFabricUIManager(): UIManager? = null

  override fun getSourceURL(): String? = null

  override fun registerSegment(segmentId: Int, path: String, callback: Callback) = Unit
}

/**
 * Stand-in for `ReactActivity`: a plain [ComponentActivity] that registers nothing in
 * `onCreate`, exactly like the host of a Turbo Module.
 */
class HostActivity : ComponentActivity() {
  /**
   * Routes a result through the real `ComponentActivity.onActivityResult`
   * (`ComponentActivity.kt:785-789`) — the same entry point the OS uses when it redelivers
   * a result to a recreated Activity.
   */
  @Suppress("DEPRECATION")
  fun deliver(requestCode: Int, resultCode: Int, data: Intent?) =
    onActivityResult(requestCode, resultCode, data)
}

/** A trivial contract, so the registry tests exercise androidx alone. */
class EchoContract : ActivityResultContract<String, String?>() {
  override fun createIntent(context: Context, input: String): Intent =
    Intent(context, HostActivity::class.java).putExtra("in", input)

  override fun parseResult(resultCode: Int, intent: Intent?): String? =
    if (resultCode == Activity.RESULT_OK) intent?.getStringExtra("out") else null
}

/** Test fixtures and the [UqpayRuntime] wiring every test class shares. */
object UqpayTest {

  const val INTENT_ID: String = "PI_test_0001"

  private val uuidCounter = AtomicInteger(0)

  /**
   * Puts [UqpayRuntime] on JVM-only seams: `JavaOnly*` maps (no JNI), an inline main-thread
   * runner (no Looper pumping), a settable clock and counted UUIDs. The two token timeouts
   * drop to milliseconds so the "hang" and "no listener" tests finish instantly instead of
   * sleeping for the production 10 s.
   */
  fun installRuntime(nowMs: Long = 1_700_000_000_000L) {
    UqpayRuntime.mapFactory = { JavaOnlyMap() }
    UqpayRuntime.arrayFactory = { JavaOnlyArray() }
    UqpayRuntime.runOnMain = { it.run() }
    // Inline, so `presentPaymentSheet`'s token priming is observable on the test thread.
    UqpayRuntime.runOffThread = { it.run() }
    UqpayRuntime.clock = { nowMs }
    uuidCounter.set(0)
    UqpayRuntime.uuidFactory = { "uuid-${uuidCounter.incrementAndGet()}" }
    UqpayRuntime.tokenTimeoutMs = 50L
    UqpayRuntime.listenerWaitMs = 50L
  }

  fun setClock(nowMs: Long) {
    UqpayRuntime.clock = { nowMs }
  }

  fun tearDown() {
    UqpayNativeState.resetForTesting()
    UqpayModule.activeModule = null
    UqpayRuntime.resetForTesting()
  }

  /** Initialises the real native SDK. It only writes two AtomicReferences — no I/O. */
  fun initializeSdk(context: Context, clientId: String = "rn-test-client") {
    UQPay.initialize(
      context,
      UQPayConfiguration(
        clientId = clientId,
        environment = Environment.SANDBOX,
        tokenProvider = UqpayNativeState.tokenProvider,
      ),
    )
  }

  fun initConfig(
    configId: String,
    clientId: String = "rn-test-client",
    environment: String = "sandbox",
    debugLogging: Boolean = false,
    appearance: JavaOnlyMap? = null,
  ): JavaOnlyMap = JavaOnlyMap().apply {
    putString("environment", environment)
    putString("clientId", clientId)
    putBoolean("debugLogging", debugLogging)
    putString("configId", configId)
    appearance?.let { putMap("appearance", it) }
  }

  fun presentOptions(
    paymentIntentId: String = INTENT_ID,
    presentationMode: String = "methodList",
  ): JavaOnlyMap = JavaOnlyMap().apply {
    putString("paymentIntentId", paymentIntentId)
    putString("returnUrl", "uqpayexample://payment-return")
    putString("presentationMode", presentationMode)
  }

  fun succeeded(
    paymentIntentId: String = INTENT_ID,
    amount: BigDecimal? = BigDecimal("8.98"),
    currency: String? = "SGD",
    completedAtEpochMillis: Long? = 1_700_000_000_000L,
  ): PaymentResult = PaymentResult(
    status = PaymentStatus.SUCCEEDED,
    paymentIntentId = paymentIntentId,
    paymentMethodType = com.uqpay.sdk.payment.PaymentMethodType.CARD,
    amount = amount,
    currency = currency,
    merchantOrderId = "ORDER-1",
    transactionId = "PA_attempt_1",
    completedAtEpochMillis = completedAtEpochMillis,
    error = null,
  )

  fun failed(
    code: UQPayErrorCode = UQPayErrorCode.CARD_DECLINED,
    paymentIntentId: String = INTENT_ID,
    declineCode: String? = null,
    traceId: String? = null,
    developerMessage: String? = "The gateway declined the attempt.",
  ): PaymentResult = PaymentResult(
    status = PaymentStatus.FAILED,
    paymentIntentId = paymentIntentId,
    error = UQPayError(
      code = code,
      message = "The card was declined.",
      declineCode = declineCode,
      traceId = traceId,
      developerMessage = developerMessage,
    ),
  )

  fun cancelled(paymentIntentId: String = INTENT_ID): PaymentResult = PaymentResult(
    status = PaymentStatus.CANCELLED,
    paymentIntentId = paymentIntentId,
  )

  fun pending(
    paymentIntentId: String = INTENT_ID,
    code: UQPayErrorCode = UQPayErrorCode.TIMEOUT,
  ): PaymentResult = PaymentResult(
    status = PaymentStatus.PENDING,
    paymentIntentId = paymentIntentId,
    error = UQPayError(
      code = code,
      message = "The payment is still being processed.",
      developerMessage = "The confirm replay ladder was exhausted with the outcome unknown.",
    ),
  )
}
