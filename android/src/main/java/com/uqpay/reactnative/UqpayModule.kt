package com.uqpay.reactnative

import android.content.pm.ApplicationInfo
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.uqpay.sdk.UQPay
import com.uqpay.sdk.payment.PaymentMethodType
import com.uqpay.sdk.payment.PaymentSessionParams

/**
 * The `Uqpay` Turbo Module: the Android half of the bridge contract
 * (`docs/internal/progress/bridge-contract.md` §5).
 *
 * It owns nothing. Every piece of state that must outlive a JS reload lives in
 * [UqpayNativeState]; this class marshals `ReadableMap` in, `WritableMap` out, and keeps
 * the ActivityResult registration in step with the host Activity's lifecycle.
 *
 * Promise discipline (bridge-contract §0.3, AC RN-FLOW1): an expected outcome — a decline,
 * a cancel, a dead Activity, a second sheet — **resolves** with a `NativePaymentResult`.
 * Only programmer error (`not_initialized`, `invalid_configuration` at call time) rejects.
 */
class UqpayModule(private val reactContext: ReactApplicationContext) :
  NativeUqpaySpec(reactContext),
  LifecycleEventListener {

  init {
    // Eager, from the module constructor: the SDK must be initialised before the OS can
    // replay a parked result or relaunch its own Activity (AC RN-BR5, RN-CB6).
    UqpayNativeState.ensureInitialized(reactContext.applicationContext)
    UqpayNativeState.eventSink = { name, payload -> emitEvent(name, payload) }
    synchronized(UqpayModule::class.java) { activeModule = this }
    reactContext.addLifecycleEventListener(this)
  }

  // ---- lifecycle -----------------------------------------------------------------------

  /**
   * Registers the shim for whatever Activity is in front now. Re-registration on a new
   * Activity instance is what receives a result parked across process death (spike S1,
   * caveat 2); the registry keeps one entry per Activity identity, so this is a no-op on
   * every resume after the first.
   */
  override fun onHostResume() {
    UqpayRuntime.onMain { UqpayNativeState.ensureRegistered(reactContext.currentActivity) }
  }

  /** Never on pause: `unregister` drops a parked result (spike S1, caveat 1). */
  override fun onHostPause() = Unit

  override fun onHostDestroy() {
    UqpayNativeState.unregister(reactContext.currentActivity)
  }

  /**
   * Metro reload safety (spike S1, caveat 5): the new ReactContext's module has already
   * claimed [activeModule], so an older module tearing down must not pull the registration
   * out from under it.
   */
  override fun invalidate() {
    val wasActive = synchronized(UqpayModule::class.java) {
      if (activeModule === this) {
        activeModule = null
        true
      } else {
        false
      }
    }
    reactContext.removeLifecycleEventListener(this)
    if (wasActive) {
      UqpayNativeState.eventSink = null
      UqpayNativeState.unregisterAll()
      UqpayNativeState.tokenProvider.clearWaiters()
      // The promise belongs to the context being torn down; a result arriving after this
      // must be buffered for the next context's `getPendingResult()` (AC RN-CB6, issue #8).
      UqpayNativeState.detachJsPromise()
    }
    super.invalidate()
  }

  // ---- spec ----------------------------------------------------------------------------

  override fun initialize(config: ReadableMap, promise: Promise) {
    val configId = config.stringOrNull("configId").orEmpty()
    val clientId = config.stringOrNull("clientId").orEmpty()
    if (configId.isBlank() || clientId.isBlank()) {
      promise.reject(
        CODE_INVALID_CONFIGURATION,
        "UQPAY: `initialize` needs a non-blank `clientId` and `configId`.",
      )
      return
    }

    // Same config: a no-op that keeps the token cache, so an app boot after a Metro reload
    // costs nothing (AC RN-IDEM1, RN-API9).
    if (configId == UqpayNativeState.currentConfigId && UQPay.isInitialized) {
      promise.resolve(null)
      return
    }

    // A different config mid-sheet would rebuild the SDK's token manager under a running
    // payment (AC RN-IDEM1).
    if (UqpayNativeState.isPresenting) {
      promise.reject(
        CODE_INVALID_CONFIGURATION,
        "UQPAY: `init` was called with a different configuration while a payment sheet is " +
          "presented. Finish or cancel the sheet first.",
      )
      return
    }

    // The SDK validates the configuration as it is built (a `clientId` with a line break, for
    // one, throws `IllegalArgumentException`), and `JSONObject` refuses a non-finite
    // appearance number. Either is a configuration error to report, not an exception to let
    // escape into the host app. The SDK's messages name the field, never the value. Nothing
    // is persisted and the previous configuration stays in force.
    val persisted: UqpayNativeState.PersistedConfig
    try {
      persisted = UqpayNativeState.PersistedConfig(
        environment = config.stringOrNull("environment") ?: "sandbox",
        clientId = clientId,
        onBehalfOf = config.stringOrNull("onBehalfOf"),
        appearanceJson = UqpayAppearanceMapper.toJson(config.mapOrNull("appearance"))?.toString(),
        configId = configId,
      )
      UqpayNativeState.applyConfig(
        reactContext.applicationContext,
        persisted,
        loggingEnabled = config.booleanOrFalse("debugLogging") && hostIsDebuggable(),
      )
    } catch (e: Exception) {
      promise.reject(
        CODE_INVALID_CONFIGURATION,
        "UQPAY: the configuration was rejected" +
          (e.message?.takeIf { it.isNotBlank() }?.let { ": $it" } ?: "."),
      )
      return
    }
    // New credentials, new token: the cached one was minted for the old clientId.
    UqpayNativeState.cachedToken = null
    UqpayNativeState.persist(reactContext.applicationContext, persisted)
    promise.resolve(null)
  }

  override fun presentPaymentSheet(options: ReadableMap, promise: Promise) {
    val intentId = options.stringOrNull("paymentIntentId").orEmpty()
    if (intentId.isBlank()) {
      promise.reject(CODE_INVALID_CONFIGURATION, "UQPAY: `paymentIntentId` must not be blank.")
      return
    }
    if (!UQPay.isInitialized) {
      promise.reject(
        CODE_NOT_INITIALIZED,
        "UQPAY: call `init()` from @uqpay/react-native before `presentPaymentSheet()`.",
      )
      return
    }

    // A result for this very intent is already waiting — re-attach instead of presenting a
    // second sheet for a payment that has already ended (bridge-contract §4, AC RN-CB6).
    UqpayNativeState.takeBufferedResultFor(intentId)?.let {
      promise.resolve(it)
      return
    }

    // The sheet for this intent is still on screen but its promise died with a reloaded JS
    // context: attach the new promise to the running payment (AC RN-CB6, RN-API9).
    if (UqpayNativeState.attachToInFlight(intentId, promise)) return

    if (!UqpayNativeState.beginPresenting(intentId, promise)) {
      promise.resolve(
        UqpayResultEncoder.syntheticFailure(
          intentId,
          CODE_INVALID_CONFIGURATION,
          "UQPAY: a payment sheet is already presented. Wait for it to settle before " +
            "presenting another.",
        ),
      )
      return
    }

    val activity = reactContext.currentActivity
    if (activity == null) {
      UqpayNativeState.abortPresenting()
      promise.resolve(
        UqpayResultEncoder.syntheticFailure(
          intentId,
          CODE_INVALID_CONFIGURATION,
          "UQPAY: no foreground Activity, so the payment sheet cannot be presented. " +
            "Present while the app is in the foreground.",
        ),
      )
      return
    }

    val params = buildSessionParams(intentId, options)
    // Ask JavaScript for the auth token *before* the sheet Activity takes the foreground
    // (issues.md #7): once it has, React Native stops delivering the merchant
    // `tokenProvider`'s network callback until the host Activity resumes, so a token asked
    // for from inside the sheet can never arrive inside the 10 s budget. This runs off the
    // JS thread on purpose — the JS thread is the one that has to answer it.
    UqpayRuntime.offThread {
      val prime = UqpayNativeState.tokenProvider.primeForPresent()
      UqpayRuntime.onMain {
        // Checked on the main thread, right before the launch below, so a cancel that landed
        // while the token was being fetched is never followed by a sheet opening anyway.
        if (UqpayNativeState.merchantCancelRequested) {
          UqpayNativeState.settleUnlaunched(
            UqpayResultEncoder.merchantCancelledBeforeLaunch(intentId),
            intentId,
          )
          return@onMain
        }
        if (prime is PrimeOutcome.Failed) {
          // The same code the SDK reports when its token provider fails, without the
          // 10 s spinner inside a sheet that could never have got a token either.
          UqpayNativeState.settleUnlaunched(
            UqpayResultEncoder.syntheticFailure(
              intentId,
              CODE_AUTHENTICATION_FAILED,
              "UQPAY: could not get an access token from the app's `tokenProvider`, so the " +
                "payment sheet was not presented and no payment was started. " +
                prime.developerMessage,
            ),
            intentId,
          )
          return@onMain
        }
        val registration = UqpayNativeState.ensureRegistered(activity)
        if (registration == null) {
          UqpayNativeState.abortPresenting()
          promise.resolve(
            UqpayResultEncoder.syntheticFailure(
              intentId,
              CODE_INVALID_CONFIGURATION,
              "UQPAY: no foreground Activity, so the payment sheet cannot be presented. " +
                "Present while the app is in the foreground.",
            ),
          )
        } else {
          // Exactly one launch per JS call (AC RN-ERR6): `beginPresenting` already refused
          // every other caller.
          //
          // A dead host is *documented* to come back through the SDK's own callback as
          // FAILED / INVALID_CONFIGURATION rather than a throw
          // (`UQPayPaymentLauncherImpl.kt:37-58`, verified by spike S1 item 3b) — but that
          // covers one specific case, and this is the only place where an escaping throwable
          // would strand the claim: `isPresenting` would stay true for the life of the
          // process, every later present would resolve "already presented", and this
          // promise would never settle at all (AC RN-CB1, RN-UX7, RN-UX8). So the claim is
          // released for *any* Throwable, and the promise is settled the way every other
          // expected failure on this path is.
          try {
            registration.launcher.launch(params)
          } catch (throwable: Throwable) {
            UqpayNativeState.abortPresenting()
            promise.resolve(
              UqpayResultEncoder.syntheticFailure(
                intentId,
                CODE_INVALID_CONFIGURATION,
                // The class name only: a throwable's message could carry request detail,
                // and nothing from a payload may reach a developer message (AC RN-SEC7).
                "UQPAY: the native payment launcher threw " +
                  (throwable::class.java.name) +
                  " and the sheet was not presented. No payment was started.",
              ),
            )
          }
        }
      }
    }
  }

  override fun cancelPaymentSheet(promise: Promise) {
    // The SDK reports a plain CANCELLED either way, so this flag is the only way the
    // encoder can say `merchant_cancelled` (bridge-contract §3). Set only while a sheet is
    // up, and cleared at every session start and end, so a stale flag cannot mislabel a
    // later customer cancel. While the token is still being fetched, before any launch,
    // this flag alone is the cancel: `presentPaymentSheet` sees it and never launches.
    if (UqpayNativeState.isPresenting) UqpayNativeState.merchantCancelRequested = true
    val activity = reactContext.currentActivity
    UqpayRuntime.onMain {
      // Remaining no-op window (android_analysis §2, bug B45): between `launch()` and the
      // sheet Activity existing, `cancel()` has nothing to settle and does nothing. The
      // promise still resolves; the outcome arrives through the payment callback.
      UqpayNativeState.registrationFor(activity)?.launcher?.cancel()
    }
    promise.resolve(null)
  }

  /** iOS-only hook. Android's SDK owns the bank return inside its own Activity. */
  override fun notifyReturnedFromBank() = Unit

  override fun getPendingResult(promise: Promise) {
    promise.resolve(UqpayNativeState.takeBufferedResult())
  }

  override fun provideToken(requestId: String, authToken: String, expiresAtEpochMs: Double) {
    UqpayNativeState.tokenProvider.provide(requestId, authToken, expiresAtEpochMs.toLong())
  }

  override fun failToken(requestId: String, developerMessage: String) {
    UqpayNativeState.tokenProvider.fail(requestId, developerMessage)
  }

  override fun getNativeInfo(promise: Promise) {
    val map = UqpayRuntime.newMap()
    map.putString("platform", UqpayResultEncoder.PLATFORM)
    map.putString("nativeSdkVersion", UQPay.version)
    map.putBoolean("isInitialized", UQPay.isInitialized)
    map.putBoolean("isPresenting", UqpayNativeState.isPresenting)
    promise.resolve(map)
  }

  override fun addListener(eventName: String) {
    UqpayNativeState.addListener()
  }

  override fun removeListeners(count: Double) {
    UqpayNativeState.removeListeners(count.toInt())
  }

  // ---- helpers ---------------------------------------------------------------------------

  private fun emitEvent(name: String, payload: WritableMap) {
    if (!UqpayNativeState.hasListeners()) return
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(name, payload)
    } catch (_: Throwable) {
      // The ReactContext can be torn down between the listener check and the emit (Metro
      // reload). Dropping the event is correct: the token fetch then times out and the
      // SDK reports `authentication_failed`.
    }
  }

  private fun hostIsDebuggable(): Boolean =
    (reactContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

  internal fun buildSessionParams(intentId: String, options: ReadableMap): PaymentSessionParams {
    val presentation = when (options.stringOrNull("presentationMode")) {
      "cardOnly" -> PaymentSessionParams.Presentation.CardOnly
      "singleWallet" -> options.stringOrNull("singleWalletMethod")
        ?.takeIf { it.isNotBlank() }
        ?.let { PaymentSessionParams.Presentation.SingleWallet(PaymentMethodType.of(it)) }
        ?: PaymentSessionParams.Presentation.MethodList
      else -> PaymentSessionParams.Presentation.MethodList
    }

    // `returnUrl` and `merchantDisplayName` are deliberately dropped: the Android SDK takes
    // the 3DS return URL from the payment intent itself and has no merchant-name hook
    // (android_analysis §2, §3).
    return PaymentSessionParams(
      paymentIntentId = intentId,
      presentation = presentation,
      billingDetails = billingDetails(options.mapOrNull("billingDetails")),
      allowedPaymentMethods = allowedMethods(options.arrayOrNull("allowedPaymentMethods")),
    )
  }

  private fun allowedMethods(array: ReadableArray?): Set<PaymentMethodType>? {
    if (array == null) return null
    val methods = LinkedHashSet<PaymentMethodType>()
    for (index in 0 until array.size()) {
      val raw = if (array.getType(index) == ReadableType.String) array.getString(index) else null
      raw?.takeIf { it.isNotBlank() }?.let { methods.add(PaymentMethodType.of(it)) }
    }
    return methods
  }

  private fun billingDetails(map: ReadableMap?): PaymentSessionParams.BillingDetails? {
    if (map == null) return null
    return PaymentSessionParams.BillingDetails(
      firstName = map.stringOrNull("firstName"),
      lastName = map.stringOrNull("lastName"),
      email = map.stringOrNull("email"),
      phone = map.stringOrNull("phone"),
      addressLine1 = map.stringOrNull("addressLine1"),
      addressLine2 = map.stringOrNull("addressLine2"),
      city = map.stringOrNull("city"),
      state = map.stringOrNull("state"),
      postalCode = map.stringOrNull("postalCode"),
      countryCode = map.stringOrNull("countryCode"),
    )
  }

  companion object {
    const val NAME: String = NativeUqpaySpec.NAME

    const val CODE_NOT_INITIALIZED: String = "not_initialized"
    const val CODE_INVALID_CONFIGURATION: String = "invalid_configuration"
    const val CODE_AUTHENTICATION_FAILED: String = "authentication_failed"

    /** The module the live ReactContext owns; see [invalidate]. */
    @JvmStatic
    @Volatile
    internal var activeModule: UqpayModule? = null
  }
}

// ---- ReadableMap helpers: absent, null and wrong-typed all read as "not given" ------------

internal fun ReadableMap.stringOrNull(key: String): String? =
  if (hasKey(key) && !isNull(key) && getType(key) == ReadableType.String) getString(key) else null

internal fun ReadableMap.booleanOrFalse(key: String): Boolean =
  hasKey(key) && !isNull(key) && getType(key) == ReadableType.Boolean && getBoolean(key)

internal fun ReadableMap.mapOrNull(key: String): ReadableMap? =
  if (hasKey(key) && !isNull(key) && getType(key) == ReadableType.Map) getMap(key) else null

internal fun ReadableMap.arrayOrNull(key: String): ReadableArray? =
  if (hasKey(key) && !isNull(key) && getType(key) == ReadableType.Array) getArray(key) else null
