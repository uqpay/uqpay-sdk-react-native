package com.uqpay.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.util.UUID

/**
 * The only seams the Android bridge has on the platform: map/array construction, the main
 * thread, the clock, UUIDs and the two token timeouts.
 *
 * Everything here has a production default and is replaced wholesale by
 * [resetForTesting] in `android/src/test`, so the Robolectric suite never has to touch JNI
 * (`Arguments.createMap()` builds a `WritableNativeMap`, which needs SoLoader), never has
 * to pump a Looper and — the point of the two timeout fields — never has to sleep.
 */
internal object UqpayRuntime {

  /** 10 s (bridge-contract §2, AC RN-ERR8): how long the SDK's IO thread waits for JS. */
  const val DEFAULT_TOKEN_TIMEOUT_MS: Long = 10_000L

  /** 10 s: how long a token fetch waits for JS to subscribe at all (AC RN-BR6). */
  const val DEFAULT_LISTENER_WAIT_MS: Long = 10_000L

  /**
   * Cache margin (bridge-contract §2): a cached token is reused while > 120 s remain. It is
   * the same margin the SDK's own `TokenManager` applies (`refreshMarginMillis` = 120 000),
   * so a token the bridge still calls fresh is one the SDK will also keep for itself.
   */
  const val TOKEN_CACHE_MARGIN_MS: Long = 120_000L

  /**
   * Assumed lifetime of a token whose `expiresAt` the merchant did not give (JS sends
   * `expiresAtEpochMs = -1`, which the public API allows). UQPAY access tokens live roughly
   * 20–30 minutes, so 5 minutes from receipt is deliberately conservative: long enough for
   * the SDK to cache the token for the whole of an ordinary sheet (it would otherwise
   * re-ask on every request, and a re-ask while the host Activity is paused cannot be
   * answered in time — issues.md #7), short enough never to outlive the real token.
   */
  const val ASSUMED_TOKEN_LIFETIME_MS: Long = 300_000L

  /**
   * Inside the 120 s margin a token is no longer *fresh*, but it is still *valid*. While at
   * least this much of it is left, `fetchToken` hands the cached token back instead of
   * asking JavaScript — which, from inside the sheet, is usually a round trip that cannot
   * finish in time (issues.md #7). 30 s comfortably covers one API request.
   */
  const val TOKEN_MIN_REMAINING_MS: Long = 30_000L

  @Volatile
  @JvmField
  var mapFactory: () -> WritableMap = { Arguments.createMap() }

  @Volatile
  @JvmField
  var arrayFactory: () -> WritableArray = { Arguments.createArray() }

  @Volatile
  @JvmField
  var runOnMain: (Runnable) -> Unit = { UiThreadUtil.runOnUiThread(it) }

  /**
   * Work that must **not** run on the JS thread or the main thread: today, priming the auth
   * token before the sheet Activity is launched ([UqpayTokenProvider.primeForPresent]).
   *
   * It is a bare `Thread` on purpose. The block runs at most once per `presentPaymentSheet`,
   * blocks for up to the token budget, and a pool would only add a lifecycle to get wrong.
   */
  @Volatile
  @JvmField
  var runOffThread: (Runnable) -> Unit = { Thread(it, "uqpay-token-prime").start() }

  /** Wall clock, in epoch millis. Only ever compared against JS-supplied `expiresAtEpochMs`. */
  @Volatile
  @JvmField
  var clock: () -> Long = { System.currentTimeMillis() }

  @Volatile
  @JvmField
  var uuidFactory: () -> String = { UUID.randomUUID().toString() }

  @Volatile
  @JvmField
  var tokenTimeoutMs: Long = DEFAULT_TOKEN_TIMEOUT_MS

  @Volatile
  @JvmField
  var listenerWaitMs: Long = DEFAULT_LISTENER_WAIT_MS

  fun newMap(): WritableMap = mapFactory()

  fun newArray(): WritableArray = arrayFactory()

  fun now(): Long = clock()

  fun newUuid(): String = uuidFactory()

  fun onMain(block: () -> Unit) = runOnMain(Runnable { block() })

  fun offThread(block: () -> Unit) = runOffThread(Runnable { block() })

  /** Test hook: restores every production default. */
  fun resetForTesting() {
    mapFactory = { Arguments.createMap() }
    arrayFactory = { Arguments.createArray() }
    runOnMain = { UiThreadUtil.runOnUiThread(it) }
    runOffThread = { Thread(it, "uqpay-token-prime").start() }
    clock = { System.currentTimeMillis() }
    uuidFactory = { UUID.randomUUID().toString() }
    tokenTimeoutMs = DEFAULT_TOKEN_TIMEOUT_MS
    listenerWaitMs = DEFAULT_LISTENER_WAIT_MS
  }
}
