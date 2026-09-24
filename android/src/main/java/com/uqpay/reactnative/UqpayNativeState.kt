package com.uqpay.reactnative

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import androidx.activity.ComponentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.uqpay.sdk.Environment
import com.uqpay.sdk.UQPay
import com.uqpay.sdk.UQPayConfiguration
import com.uqpay.sdk.error.UQPayError
import com.uqpay.sdk.error.UQPayErrorCode
import com.uqpay.sdk.payment.PaymentCallback
import com.uqpay.sdk.payment.PaymentResult
import com.uqpay.sdk.payment.PaymentStatus
import com.uqpay.sdk.payment.UQPayPaymentLauncher
import java.util.WeakHashMap
import java.util.concurrent.locks.ReentrantLock
import org.json.JSONObject

/**
 * Everything the Android bridge must outlive a `ReactContext` for.
 *
 * A Metro reload, a Fast Refresh or an OS-recreated `ReactActivity` all destroy the Turbo
 * Module and build a new one. The ActivityResult registration, the buffered result, the
 * token cache and `UQPay`'s own initialisation must survive that, so they live here — in a
 * process-wide `object` — and the module is only a thin façade over it
 * (bridge-contract §4, §5; AC RN-CB6, RN-BR5, RN-UX5).
 *
 * Nothing in here is ever written to disk except the **non-secret** half of the init config
 * (environment, clientId, onBehalfOf, appearance, configId). No token, ever (AC RN-SEC7).
 */
object UqpayNativeState {

  const val PREFS_NAME: String = "com.uqpay.rn.config"

  const val EVENT_TOKEN_REQUESTED: String = "uqpay_tokenRequested"
  const val EVENT_PAYMENT_RECONCILED: String = "uqpay_paymentReconciled"

  /** Never emitted on Android: the native SDK drives 3DS and QR inside its own Activity. */
  const val EVENT_REQUIRES_ACTION: String = "uqpay_requiresAction"

  /** `developerMessage` of the outcome-unknown result for a sheet restored after process death. */
  internal const val RESTORED_SHEET_MESSAGE: String =
    "UQPAY: the app was restarted by the system while the payment sheet was open, so the " +
      "sheet could not observe the outcome. The customer may have paid: verify the payment " +
      "intent on your server before fulfilling or retrying."

  private const val KEY_ENVIRONMENT = "environment"
  private const val KEY_CLIENT_ID = "clientId"
  private const val KEY_ON_BEHALF_OF = "onBehalfOf"
  private const val KEY_APPEARANCE = "appearance"
  private const val KEY_CONFIG_ID = "configId"

  /** The non-secret config, exactly as persisted. */
  data class PersistedConfig(
    val environment: String,
    val clientId: String,
    /**
     * Persisted but **unused**: `UQPayConfiguration` has no `onBehalfOf` parameter, so the
     * sheet path cannot send `x-on-behalf-of` (upstream request RN-DEP18; lead decision
     * OQ-A4 removes it from the public `InitOptions` and keeps the spec field). Connect
     * sub-account payments are configured when the backend creates the intent.
     */
    val onBehalfOf: String?,
    val appearanceJson: String?,
    val configId: String,
  )

  internal class Registration(
    /** Null only for a registration seeded by a test; production always has a shim. */
    val shim: RegistryShim?,
    val launcher: UQPayPaymentLauncher,
  )

  /** The one token provider handed to `UQPayConfiguration`; survives re-initialisation. */
  @JvmField
  internal val tokenProvider: UqpayTokenProvider = UqpayTokenProvider()

  @Volatile
  internal var cachedToken: CachedToken? = null

  @Volatile
  internal var currentConfigId: String? = null

  @Volatile
  internal var isPresenting: Boolean = false
    private set

  @Volatile
  internal var merchantCancelRequested: Boolean = false

  @Volatile
  internal var eventSink: ((String, WritableMap) -> Unit)? = null

  private val deliveryLock = Any()
  private var pendingPromise: Promise? = null
  private var pendingIntentId: String? = null
  private var bufferedResult: WritableMap? = null
  private var bufferedIntentId: String? = null

  private val listenerLock = ReentrantLock()
  private val listenerAppeared = listenerLock.newCondition()
  private var listenerCount: Int = 0

  private val registrations = WeakHashMap<Activity, Registration>()

  /** The single callback every launcher shares; the SDK calls it on the main thread. */
  private val paymentCallback = PaymentCallback { result -> onNativeResult(result) }

  // ---- initialisation ----------------------------------------------------------------

  /**
   * Re-applies the last persisted config so a relaunched process is initialised **before**
   * the OS replays a parked result or the SDK's own Activity runs (AC RN-BR5, RN-CB6).
   * Called from the module constructor, which `needsEagerInit` pulls forward to
   * ReactContext creation.
   *
   * `loggingEnabled` is deliberately not persisted and therefore false on this path
   * (AC RN-SEC12): a relaunch after a crash must never be the thing that turns logging on.
   */
  fun ensureInitialized(appContext: Context) {
    if (UQPay.isInitialized && currentConfigId != null) return
    val persisted = readPersistedConfig(appContext) ?: return
    // This runs from the module constructor, where a throw would take the host app down at
    // start-up. A persisted config the SDK now refuses just leaves the SDK uninitialised:
    // `presentPaymentSheet` then rejects `not_initialized` and the next `init()` re-applies.
    try {
      applyConfig(appContext, persisted, loggingEnabled = false)
    } catch (_: Exception) {
      Unit
    }
  }

  internal fun applyConfig(appContext: Context, config: PersistedConfig, loggingEnabled: Boolean) {
    val appearance = UqpayAppearanceMapper.toAppearance(config.appearanceJson?.let {
      runCatching { JSONObject(it) }.getOrNull()
    })
    UQPay.initialize(
      appContext,
      UQPayConfiguration(
        clientId = config.clientId,
        environment = environmentOf(config.environment),
        tokenProvider = tokenProvider,
        loggingEnabled = loggingEnabled,
        appearance = appearance,
      ),
    )
    currentConfigId = config.configId
  }

  internal fun environmentOf(raw: String): Environment =
    if (raw.equals("production", ignoreCase = true)) Environment.PRODUCTION else Environment.SANDBOX

  internal fun persist(appContext: Context, config: PersistedConfig) {
    prefs(appContext).edit()
      .putString(KEY_ENVIRONMENT, config.environment)
      .putString(KEY_CLIENT_ID, config.clientId)
      .putString(KEY_ON_BEHALF_OF, config.onBehalfOf)
      .putString(KEY_APPEARANCE, config.appearanceJson)
      .putString(KEY_CONFIG_ID, config.configId)
      .apply()
  }

  internal fun readPersistedConfig(appContext: Context): PersistedConfig? {
    val prefs = prefs(appContext)
    val clientId = prefs.getString(KEY_CLIENT_ID, null)?.takeIf { it.isNotBlank() } ?: return null
    val configId = prefs.getString(KEY_CONFIG_ID, null)?.takeIf { it.isNotBlank() } ?: return null
    return PersistedConfig(
      environment = prefs.getString(KEY_ENVIRONMENT, "sandbox").orEmpty(),
      clientId = clientId,
      onBehalfOf = prefs.getString(KEY_ON_BEHALF_OF, null),
      appearanceJson = prefs.getString(KEY_APPEARANCE, null),
      configId = configId,
    )
  }

  private fun prefs(appContext: Context): SharedPreferences =
    appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  // ---- events ------------------------------------------------------------------------

  fun emit(name: String, payload: WritableMap) {
    eventSink?.invoke(name, payload)
  }

  fun addListener() {
    listenerLock.lock()
    try {
      listenerCount += 1
      listenerAppeared.signalAll()
    } finally {
      listenerLock.unlock()
    }
  }

  fun removeListeners(count: Int) {
    listenerLock.lock()
    try {
      listenerCount = (listenerCount - count).coerceAtLeast(0)
    } finally {
      listenerLock.unlock()
    }
  }

  fun hasListeners(): Boolean {
    listenerLock.lock()
    try {
      return listenerCount > 0
    } finally {
      listenerLock.unlock()
    }
  }

  /** Blocks until JS has at least one subscriber, or [timeoutMs] elapses. */
  fun awaitListener(timeoutMs: Long): Boolean {
    listenerLock.lock()
    try {
      var remaining = java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(timeoutMs)
      while (listenerCount == 0 && remaining > 0L) {
        remaining = listenerAppeared.awaitNanos(remaining)
      }
      return listenerCount > 0
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      return false
    } finally {
      listenerLock.unlock()
    }
  }

  // ---- ActivityResult registration ----------------------------------------------------

  /**
   * Registers the shim for [activity] if it is not registered yet, via
   * `UQPay.createPaymentLauncher` so the SDK supplies its own `UQPayPaymentContract` —
   * which is what parses a result parked across process death (spike S1, caveat 4).
   *
   * Must run on the main thread. Returns null when the SDK is not initialised or the
   * Activity is not a `ComponentActivity` — never throws (AC RN-CB8).
   */
  internal fun ensureRegistered(activity: Activity?): Registration? {
    if (activity !is ComponentActivity) return null
    if (activity.isFinishing || activity.isDestroyed) return null
    if (!UQPay.isInitialized) return null
    synchronized(registrations) {
      registrations[activity]?.let { return it }
      return try {
        val shim = RegistryShim(activity)
        val launcher = UQPay.createPaymentLauncher(shim, paymentCallback)
        Registration(shim, launcher).also { registrations[activity] = it }
      } catch (_: Throwable) {
        // A dead host or an SDK that lost its initialisation between the check and the
        // call: the caller turns this into `failed` / `invalid_configuration`.
        null
      }
    }
  }

  internal fun registrationFor(activity: Activity?): Registration? {
    if (activity == null) return null
    synchronized(registrations) { return registrations[activity] }
  }

  internal fun registrationCount(): Int {
    synchronized(registrations) { return registrations.size }
  }

  /** Destroy-time only: `unregister` drops a parked result (spike S1, caveat 1). */
  internal fun unregister(activity: Activity?) {
    if (activity == null) return
    synchronized(registrations) { registrations.remove(activity) }?.shim?.unregister()
  }

  internal fun unregisterAll() {
    val all = synchronized(registrations) {
      val copy = registrations.values.toList()
      registrations.clear()
      copy
    }
    all.forEach { it.shim?.unregister() }
  }

  // ---- presentation & result delivery -------------------------------------------------

  /**
   * Claims the single active sheet (AC RN-UX7, RN-UX8). Returns false when one is already
   * presenting, so exactly one `launch` can follow N calls in one tick.
   */
  internal fun beginPresenting(intentId: String, promise: Promise): Boolean {
    synchronized(deliveryLock) {
      if (isPresenting) return false
      // A new session never inherits a merchant cancel aimed at an earlier one.
      merchantCancelRequested = false
      isPresenting = true
      pendingPromise = promise
      pendingIntentId = intentId
      return true
    }
  }

  /**
   * The JavaScript context that owns [pendingPromise] is gone (Metro reload, Fast Refresh,
   * bridge teardown). The sheet may still be on screen, so presenting state is kept; only the
   * dead promise is dropped so the next result lands in the buffer instead of resolving a
   * context that no longer exists (AC RN-CB6, bridge-contract §4; issue #8).
   */
  internal fun detachJsPromise() {
    synchronized(deliveryLock) { pendingPromise = null }
  }

  /**
   * After a reload, a `presentPaymentSheet` for the intent that is still on screen re-attaches
   * the new context's promise to the running sheet instead of reporting "already presented".
   * Returns false when nothing is in flight for [intentId] or a live promise is attached.
   */
  internal fun attachToInFlight(intentId: String, promise: Promise): Boolean {
    synchronized(deliveryLock) {
      if (isPresenting && pendingPromise == null && pendingIntentId == intentId) {
        pendingPromise = promise
        return true
      }
      return false
    }
  }

  /** Undoes [beginPresenting] when the launch never happened. */
  internal fun abortPresenting() {
    tokenProvider.clearPrimed()
    merchantCancelRequested = false
    synchronized(deliveryLock) {
      isPresenting = false
      pendingPromise = null
      pendingIntentId = null
    }
  }

  /**
   * The one place a native result becomes a JS value (bridge-contract §4).
   *
   * With a promise attached it resolves it and clears the buffer; with none — JS reloaded,
   * or the process was recreated and the OS replayed the parcel — it is buffered for the
   * next `getPendingResult()` or same-intent re-present. Exactly once, either way
   * (AC RN-CB1, RN-CB6).
   */
  internal fun onNativeResult(result: PaymentResult) {
    // A primed token belongs to the payment that just ended; it must never answer the next
    // one (bridge-contract §2).
    tokenProvider.clearPrimed()
    val merchantCancel = merchantCancelRequested
    merchantCancelRequested = false
    val encoded = UqpayResultEncoder.encode(restoredSheetOutcome(result), merchantCancel)
    deliver(encoded, result.paymentIntentId)
  }

  /**
   * Settles a present that never launched a sheet — the merchant cancelled while the token
   * was being fetched, or no token could be had. No payment was attempted. Goes through the
   * same deliver-or-buffer path as a real result, so a JS reload in the meantime still
   * finds it in `getPendingResult()`.
   */
  internal fun settleUnlaunched(encoded: WritableMap, paymentIntentId: String) {
    tokenProvider.clearPrimed()
    merchantCancelRequested = false
    deliver(encoded, paymentIntentId)
  }

  /**
   * A sheet this process did not launch reporting `FAILED` / `not_initialized` is the SDK's
   * Activity being restored after **process death**: it came back before React Native (and
   * so `ensureInitialized`) did, and could only give up. The customer may well have paid
   * in the meantime — a bank or wallet app switch is exactly when Android reclaims the
   * process — so a definite `failed` would be a lie. It is reported in the shape the SDK
   * uses for every other unobserved outcome, `PENDING` + `timeout` (`isOutcomeUnknown`),
   * so the merchant verifies the intent on its server.
   *
   * `isPresenting` is what tells the two apart: it is set for every sheet this process
   * launched, and a fresh process starts with it false. A `not_initialized` from a sheet we
   * did launch is left alone — that one really did fail before any payment was attempted.
   */
  private fun restoredSheetOutcome(result: PaymentResult): PaymentResult {
    val isRestoredNotInitialized = result.status == PaymentStatus.FAILED &&
      result.error?.code == UQPayErrorCode.NOT_INITIALIZED &&
      !isPresenting
    if (!isRestoredNotInitialized) return result
    return PaymentResult(
      status = PaymentStatus.PENDING,
      paymentIntentId = result.paymentIntentId,
      paymentMethodType = result.paymentMethodType,
      amount = result.amount,
      currency = result.currency,
      merchantOrderId = result.merchantOrderId,
      transactionId = result.transactionId,
      completedAtEpochMillis = result.completedAtEpochMillis,
      error = UQPayError(
        code = UQPayErrorCode.TIMEOUT,
        message = "The payment result could not be confirmed.",
        developerMessage = RESTORED_SHEET_MESSAGE,
      ),
    )
  }

  private fun deliver(encoded: WritableMap, paymentIntentId: String) {
    val promise = synchronized(deliveryLock) {
      isPresenting = false
      val waiting = pendingPromise
      pendingPromise = null
      pendingIntentId = null
      if (waiting == null) {
        bufferedResult = encoded
        bufferedIntentId = paymentIntentId
      } else {
        bufferedResult = null
        bufferedIntentId = null
      }
      waiting
    }
    promise?.resolve(encoded)
  }

  /** Returns and clears the buffer (exactly-once, AC RN-CB6). */
  internal fun takeBufferedResult(): WritableMap? {
    synchronized(deliveryLock) {
      val buffered = bufferedResult
      bufferedResult = null
      bufferedIntentId = null
      return buffered
    }
  }

  /** Returns and clears the buffer only when it belongs to [intentId] (re-attach). */
  internal fun takeBufferedResultFor(intentId: String): WritableMap? {
    synchronized(deliveryLock) {
      if (bufferedIntentId != intentId) return null
      val buffered = bufferedResult
      bufferedResult = null
      bufferedIntentId = null
      return buffered
    }
  }

  internal fun hasBufferedResult(): Boolean {
    synchronized(deliveryLock) { return bufferedResult != null }
  }

  // ---- test support --------------------------------------------------------------------

  /** Clears every field this object owns. Unit tests only. */
  internal fun resetForTesting() {
    unregisterAll()
    tokenProvider.clearWaiters()
    cachedToken = null
    currentConfigId = null
    isPresenting = false
    merchantCancelRequested = false
    eventSink = null
    synchronized(deliveryLock) {
      pendingPromise = null
      pendingIntentId = null
      bufferedResult = null
      bufferedIntentId = null
    }
    listenerLock.lock()
    try {
      listenerCount = 0
    } finally {
      listenerLock.unlock()
    }
  }

  /** The shared callback, so tests can drive a result in without a real Activity. */
  internal fun testCallback(): PaymentCallback = paymentCallback

  /** Seeds a registration with a stand-in launcher. Unit tests only. */
  internal fun putRegistrationForTesting(activity: Activity, launcher: UQPayPaymentLauncher) {
    synchronized(registrations) { registrations[activity] = Registration(null, launcher) }
  }
}
