# Consumer ProGuard/R8 rules for @uqpay/react-native (AC RN-INT10).
#
# com.uqpay.sdk:uqpay-sdk-android ships its own consumer rules (its ActivityResult contract
# and its @Serializable enums), so nothing here repeats them.
#
# What this package needs kept is its own bridge surface. The React Native Gradle plugin
# keeps @DoNotStrip members, which covers the generated `NativeUqpaySpec` methods, but the
# module is also reached reflectively by name: `UqpayPackage` names the module class, and
# the Turbo Module registry looks it up from the codegen'd provider. A single keep on the
# package is the honest 1.0 answer — it is ~8 classes and no measurable size cost, and it
# cannot be wrong the way a hand-pruned list can be.
#
# Revisit at 1.1 (tracked as an open question for the lead): narrow this to
# `UqpayModule`, `UqpayPackage` and `NativeUqpaySpec` once RN-INT10's minified smoke test
# has run on a device and proven which members R8 actually needs.
-keep class com.uqpay.reactnative.** { *; }
