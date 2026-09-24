package com.uqpay.reactnative

import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultCallback
import androidx.activity.result.ActivityResultCaller
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.contract.ActivityResultContract

/**
 * An [ActivityResultCaller] over the **non-lifecycle** `ActivityResultRegistry.register`
 * overload, with a stable key.
 *
 * Why it exists (AC RN-BR1): the native SDK's only public launch path is
 * `UQPay.createPaymentLauncher(caller, callback)`, which calls the caller's
 * `registerForActivityResult`. `ComponentActivity`'s implementation delegates to the
 * lifecycle overload, which `check(!lifecycle.currentState.isAtLeast(STARTED))` — and a
 * Turbo Module is always constructed after `ReactActivity` is resumed. The registry's
 * `register(key, contract, callback)` overload has no such check, replays a result parked
 * for the same key **synchronously inside `register()`**, and must be unregistered by hand.
 *
 * Validated in spike S1 (`docs/internal/progress/spikes.md` § "S1"): 8/8 Robolectric tests
 * plus one instrumented test against the published `com.uqpay.sdk:uqpay-sdk-android:0.1.0`.
 * Lifted from `docs/internal/spikes/android-shim/app/src/main/kotlin/com/uqpay/spike/RegistryShim.kt`.
 *
 * Caveats honoured by [UqpayNativeState]: register once per Activity instance, unregister
 * only on destroy/invalidate (never on pause — `unregister` drops a parked result), and
 * always re-register through `UQPay.createPaymentLauncher` so the SDK's own contract parses
 * the replayed parcel.
 */
internal class RegistryShim(
  private val registry: ActivityResultRegistry,
  private val key: String = STABLE_KEY,
) : ActivityResultCaller {

  constructor(activity: ComponentActivity, key: String = STABLE_KEY) :
    this(activity.activityResultRegistry, key)

  /** The androidx launcher behind the SDK's launcher; kept only so [unregister] can reach it. */
  @Volatile
  var launcher: ActivityResultLauncher<*>? = null
    private set

  override fun <I, O> registerForActivityResult(
    contract: ActivityResultContract<I, O>,
    callback: ActivityResultCallback<O>,
  ): ActivityResultLauncher<I> = registerForActivityResult(contract, registry, callback)

  override fun <I, O> registerForActivityResult(
    contract: ActivityResultContract<I, O>,
    registry: ActivityResultRegistry,
    callback: ActivityResultCallback<O>,
  ): ActivityResultLauncher<I> =
    registry.register(key, contract, callback).also { launcher = it }

  /** Removes [key] from the registry. Drops any result parked for it — destroy/invalidate only. */
  fun unregister() {
    launcher?.unregister()
    launcher = null
  }

  companion object {
    /**
     * Permanent, never versioned (Phase 0 decision S1-Q1). A versioned key would lose a
     * result parked *during* an app update and gains nothing.
     */
    const val STABLE_KEY: String = "com.uqpay.rn.payment"
  }
}
