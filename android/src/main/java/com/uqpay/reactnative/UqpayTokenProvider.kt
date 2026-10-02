package com.uqpay.reactnative

import com.uqpay.sdk.auth.UQPayAuthToken
import com.uqpay.sdk.auth.UQPayTokenProvider
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Bridges the SDK's **synchronous, blocking, off-main** `fetchToken()` onto the merchant's
 * asynchronous JavaScript `tokenProvider` (bridge-contract §2, AC RN-BR6, RN-ERR8).
 *
 * Order of business on every fetch:
 * 0. **Primed** — a token fetched by [primeForPresent] just before the sheet Activity was
 *    launched. See that method for why this step has to exist at all.
 * 1. **Cache hit** — a token that is still valid for more than
 *    [UqpayRuntime.TOKEN_MIN_REMAINING_MS] is returned without waking JavaScript at all.
 *    Inside the SDK's own 120 s margin the SDK stops caching it and asks again on every
 *    request, so answering those from memory is what keeps them from each becoming a JS
 *    round trip the paused host cannot finish in time (issues.md #7). The cache is in
 *    memory only: it does **not** survive process death.
 * 2. **No listener yet** — wait up to 10 s for JavaScript to subscribe, then give up.
 * 3. Emit `uqpay_tokenRequested` and block this IO thread on a future for up to 10 s.
 *
 * A token JavaScript hands over without an expiry (`expiresAtEpochMs = -1`) is treated as
 * valid for [UqpayRuntime.ASSUMED_TOKEN_LIFETIME_MS] from receipt: it is cached with that
 * effective expiry and the SDK is given the same one, so neither re-asks on every request.
 *
 * Every giving-up path **throws**. That is deliberate: the SDK's own `TokenManager` turns a
 * throwing provider into `AUTHENTICATION_FAILED` (`network/TokenManager.kt:63-77`), so the
 * bridge never invents an error code of its own (bridge-contract §2). The one place the
 * bridge reports it without the SDK is a failed [primeForPresent], and it uses that same
 * `authentication_failed`.
 *
 * The token value is never logged, never put in an exception message and never persisted
 * (AC RN-SEC7): it lives in this process's memory only.
 */
internal class UqpayTokenProvider(
  private val state: UqpayNativeState = UqpayNativeState,
) : UQPayTokenProvider {

  /** `requestId` → the thread waiting for JavaScript to answer it. */
  private val waiters = ConcurrentHashMap<String, CompletableFuture<CachedToken>>()

  /** One-shot answer from [primeForPresent]; consumed by the next [fetchToken]. */
  @Volatile
  private var primed: CachedToken? = null

  /**
   * Fetch a token **before** `UQPayPaymentActivity` takes the foreground.
   *
   * Why this exists (issues.md #7): the SDK asks for a token from inside its own Activity,
   * by which time the host `ReactActivity` is paused. In that state React Native does not
   * deliver the merchant `tokenProvider`'s `fetch` completion back to JavaScript until the
   * host resumes, so the answer always arrives *after* the 10 s budget below has expired —
   * the sheet dies with `authentication_failed` before it can render the method list, on
   * every first present after a cold start (an empty [UqpayNativeState.cachedToken]).
   *
   * So `presentPaymentSheet` calls this off the JS thread while the host is still in front,
   * and the fetch inside the sheet is then answered from [primed] without waking JS at all.
   *
   * It asks JavaScript on **every** present, even with a cached token that looks valid —
   * the README's "called before every present", and what iOS does. UQPAY keeps one active
   * token per merchant, so any mint on the merchant's server (a restart or deploy, a second
   * instance, or its own early refresh racing this device's clock) silently kills the token
   * cached here. Served from the cache, that dead token failed every Android payment with
   * `authentication_failed` until it aged out — and the SDK's retry after the `401` could not
   * help, because [fetchToken] answers it from the same cache. This is the one moment a
   * fresh token can still be had: the host is in front and JS can answer.
   *
   * It reports whether the sheet can be launched at all. When JavaScript cannot supply a
   * token — the provider threw, returned a blank token, timed out, or no listener appeared —
   * a cached token that is still outside the refresh margin is used instead: it may well
   * still be live (a merchant backend that is briefly down has not re-minted), and if it is
   * not, the gateway's `401` ends the payment with the same `authentication_failed`. With no
   * such token, a failure here would only repeat itself inside the sheet, where JS is even
   * less able to answer, and end 10 s later as `authentication_failed` with the customer
   * staring at a spinner. So the caller settles the present with that same code straight
   * away and launches nothing.
   */
  fun primeForPresent(): PrimeOutcome {
    primed = null
    val cached = state.cachedToken
    return try {
      primed = requestFromJavaScript(cached)
      PrimeOutcome.Ready
    } catch (e: Exception) {
      val now = UqpayRuntime.now()
      if (cached != null && now < cached.expiresAtEpochMs - UqpayRuntime.TOKEN_CACHE_MARGIN_MS) {
        PrimeOutcome.Ready
      } else {
        PrimeOutcome.Failed(e.message ?: "UQPAY: the app's `tokenProvider` did not supply a token.")
      }
    }
  }

  /** Drops an unused primed token, so it can never answer a later, unrelated payment. */
  fun clearPrimed() {
    primed = null
  }

  override fun fetchToken(): UQPayAuthToken {
    primed?.let {
      primed = null
      return UQPayAuthToken(it.value, it.expiresAtEpochMs)
    }

    // Deliberately wider than the 120 s margin [primeForPresent] refreshes at: this runs from
    // inside the sheet, where a still-valid token beats a JS round trip that cannot finish.
    val cached = state.cachedToken
    val now = UqpayRuntime.now()
    if (cached != null && now < cached.expiresAtEpochMs - UqpayRuntime.TOKEN_MIN_REMAINING_MS) {
      return UQPayAuthToken(cached.value, cached.expiresAtEpochMs)
    }

    val answer = requestFromJavaScript(cached)
    return UQPayAuthToken(answer.value, answer.expiresAtEpochMs)
  }

  /**
   * The JavaScript round trip: wait for a subscriber, emit `uqpay_tokenRequested`, block on
   * the answer. Every giving-up path throws, which is what the SDK turns into
   * `AUTHENTICATION_FAILED` (bridge-contract §2).
   */
  private fun requestFromJavaScript(cached: CachedToken?): CachedToken {
    if (!state.awaitListener(UqpayRuntime.listenerWaitMs)) {
      throw IllegalStateException(
        "UQPAY: no JavaScript listener for `uqpay_tokenRequested` appeared within " +
          "${UqpayRuntime.listenerWaitMs} ms, so the merchant's `tokenProvider` could not be " +
          "called. Call `init()` from @uqpay/react-native before presenting a payment sheet.",
      )
    }

    val requestId = UqpayRuntime.newUuid()
    val future = CompletableFuture<CachedToken>()
    waiters[requestId] = future
    try {
      val payload = UqpayRuntime.newMap()
      payload.putString("requestId", requestId)
      payload.putString("reason", if (cached == null) REASON_PRESENT else REASON_REFRESH)
      state.emit(UqpayNativeState.EVENT_TOKEN_REQUESTED, payload)

      val answer = try {
        future.get(UqpayRuntime.tokenTimeoutMs, TimeUnit.MILLISECONDS)
      } catch (_: TimeoutException) {
        throw IllegalStateException(
          "UQPAY: the merchant's JavaScript `tokenProvider` did not answer within " +
            "${UqpayRuntime.tokenTimeoutMs} ms.",
        )
      } catch (e: ExecutionException) {
        throw IllegalStateException(
          "UQPAY: the merchant's JavaScript `tokenProvider` failed: " +
            (e.cause?.message ?: "no message given") + ".",
        )
      } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
        throw IllegalStateException("UQPAY: the token fetch was interrupted.", e)
      }

      if (answer.value.isBlank()) {
        throw IllegalStateException(
          "UQPAY: the merchant's JavaScript `tokenProvider` returned a blank token.",
        )
      }
      // The answer carries its own (effective) expiry, so a primed token reaches the SDK
      // with the same expiry the cache holds — never 0, which would make the SDK re-ask on
      // every request.
      return answer
    } finally {
      waiters.remove(requestId)
    }
  }

  /**
   * JS answered `uqpay_tokenRequested`. A late answer still refreshes the cache.
   *
   * A negative [expiresAtEpochMs] means "unknown" (the merchant omitted `expiresAt`); it is
   * replaced by receipt time + [UqpayRuntime.ASSUMED_TOKEN_LIFETIME_MS].
   */
  fun provide(requestId: String, authToken: String, expiresAtEpochMs: Long) {
    val effectiveExpiry = if (expiresAtEpochMs < 0L) {
      UqpayRuntime.now() + UqpayRuntime.ASSUMED_TOKEN_LIFETIME_MS
    } else {
      expiresAtEpochMs
    }
    val token = CachedToken(authToken, effectiveExpiry)
    if (authToken.isNotBlank()) state.cachedToken = token
    waiters.remove(requestId)?.complete(token)
  }

  /** JS could not produce a token. The message is the merchant's; it never holds a token. */
  fun fail(requestId: String, developerMessage: String) {
    val message = developerMessage.ifBlank { "the merchant's `tokenProvider` rejected" }
    waiters.remove(requestId)?.completeExceptionally(IllegalStateException(message))
  }

  /** Test/lifecycle hook: drops every in-flight wait and any unused primed token. */
  fun clearWaiters() {
    primed = null
    waiters.keys.toList().forEach { key ->
      waiters.remove(key)?.completeExceptionally(
        IllegalStateException("UQPAY: the bridge was torn down before the token arrived."),
      )
    }
  }

  companion object {
    const val REASON_PRESENT: String = "present"
    const val REASON_REFRESH: String = "refresh"
  }
}

/** Last token JavaScript handed over. In memory only — never persisted (AC RN-SEC7). */
internal data class CachedToken(val value: String, val expiresAtEpochMs: Long) {
  /** Never print the token, even by accident through a data-class `toString` (AC RN-SEC7). */
  override fun toString(): String = "CachedToken(expiresAtEpochMs=$expiresAtEpochMs)"
}

/** What [UqpayTokenProvider.primeForPresent] found out before the sheet was launched. */
internal sealed interface PrimeOutcome {
  /** A token is cached or primed; the sheet can be launched. */
  object Ready : PrimeOutcome

  /** No token could be had. [developerMessage] never contains a token value. */
  data class Failed(val developerMessage: String) : PrimeOutcome
}
