package com.uqpay.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Installs the `Uqpay` Turbo Module.
 *
 * `needsEagerInit = true` is load-bearing, not tidiness: the module's constructor re-applies
 * the persisted configuration through `UQPay.initialize` (AC RN-BR5). After process death
 * the OS delivers a parked payment result in `onActivityResult` — before `onResume`, and
 * long before a lazily-created module would exist — and `UQPay.createPaymentLauncher`
 * refuses to register until the SDK is initialised (`UQPay.kt:151`). Eager creation ties the
 * registration to the Activity's own lifecycle, which is what makes the replay land
 * (spike S1, caveat 2; AC RN-CB6, RN-UX2).
 */
class UqpayPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == UqpayModule.NAME) {
      UqpayModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      UqpayModule.NAME to ReactModuleInfo(
        name = UqpayModule.NAME,
        className = UqpayModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = true,
        isCxxModule = false,
        isTurboModule = true
      )
    )
  }
}
