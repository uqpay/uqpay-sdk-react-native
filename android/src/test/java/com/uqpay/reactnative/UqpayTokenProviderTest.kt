package com.uqpay.reactnative

import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The token bridge (bridge-contract §2, AC RN-BR6, RN-ERR8, RN-SEC7).
 *
 * `fetchToken()` genuinely blocks, so every test here runs it on a worker thread and
 * answers from the test thread — exactly the shape of the real thing, where the SDK's IO
 * dispatcher blocks and the JS thread answers. The two timeouts are milliseconds
 * ([UqpayTest.installRuntime]), so nothing sleeps for ten seconds to prove a timeout.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UqpayTokenProviderTest {

  private val emitted = mutableListOf<Pair<String, WritableMap>>()
  private val executor = Executors.newSingleThreadExecutor()

  @Before
  fun setUp() {
    UqpayTest.installRuntime()
    emitted.clear()
    UqpayNativeState.eventSink = { name, payload -> emitted += name to payload }
  }

  @After
  fun tearDown() {
    executor.shutdownNow()
    UqpayTest.tearDown()
  }

  private val provider get() = UqpayNativeState.tokenProvider

  /** Runs the blocking fetch off-thread and gives the test a handle on its outcome. */
  private fun fetchAsync() = executor.submit<Result<String>> {
    runCatching { provider.fetchToken().value }
  }

  /** Spins (never sleeps) until the fetch has emitted its request. */
  private fun awaitRequestId(): String {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
    while (System.nanoTime() < deadline) {
      synchronized(emitted) {
        emitted.firstOrNull()?.let { return it.second.let { m -> (m as JavaOnlyMap).getString("requestId")!! } }
      }
      Thread.onSpinWait()
    }
    throw AssertionError("no `uqpay_tokenRequested` event was emitted")
  }

  @Test
  fun cacheHit_returnsWithoutAskingJavaScript() {
    UqpayNativeState.addListener()
    UqpayNativeState.cachedToken = CachedToken("cached-token", UqpayRuntime.now() + 600_000L)

    val token = provider.fetchToken()

    assertEquals("cached-token", token.value)
    assertTrue("a cache hit must not wake JS (AC RN-BR6)", emitted.isEmpty())
  }

  @Test
  fun cachedTokenInsideTheMarginButStillValid_isServedWithoutAskingJavaScript() {
    UqpayNativeState.addListener()
    // 60 s of life left: inside the SDK's 120 s margin, so the SDK re-asks on every
    // request — each must be answered from memory, not by a JS round trip the paused host
    // cannot finish (issues.md #7).
    val expiry = UqpayRuntime.now() + 60_000L
    UqpayNativeState.cachedToken = CachedToken("short-lived-token", expiry)

    repeat(3) {
      val token = provider.fetchToken()
      assertEquals("short-lived-token", token.value)
      assertEquals("the SDK is given the real expiry", expiry, token.expiresAtEpochMillis)
    }
    assertTrue("no request inside the sheet woke JS", emitted.isEmpty())
  }

  @Test
  fun cachedTokenAboutToExpire_isRefreshed() {
    UqpayNativeState.addListener()
    // 20 s of life left: below the 30 s floor, so it must not be reused.
    UqpayNativeState.cachedToken = CachedToken("stale-token", UqpayRuntime.now() + 20_000L)

    val future = fetchAsync()
    val requestId = awaitRequestId()
    assertEquals("refresh", (emitted.first().second as JavaOnlyMap).getString("reason"))

    provider.provide(requestId, "fresh-token", UqpayRuntime.now() + 1_800_000L)
    assertEquals("fresh-token", future.get(5, TimeUnit.SECONDS).getOrThrow())
  }

  @Test
  fun cacheMiss_emitsTokenRequestedAndProvideTokenAnswersIt() {
    UqpayNativeState.addListener()

    val future = fetchAsync()
    val requestId = awaitRequestId()

    assertEquals("uqpay_tokenRequested", emitted.first().first)
    assertEquals("present", (emitted.first().second as JavaOnlyMap).getString("reason"))
    assertNotNull(requestId)

    provider.provide(requestId, "jwt-from-js", UqpayRuntime.now() + 1_800_000L)
    assertEquals("jwt-from-js", future.get(5, TimeUnit.SECONDS).getOrThrow())
    assertEquals("jwt-from-js", UqpayNativeState.cachedToken?.value)
  }

  @Test
  fun blankToken_throwsSoTheSdkReportsAuthenticationFailed() {
    UqpayNativeState.addListener()

    val future = fetchAsync()
    val requestId = awaitRequestId()
    provider.provide(requestId, "   ", UqpayRuntime.now() + 1_800_000L)

    val error = future.get(5, TimeUnit.SECONDS).exceptionOrNull()
    assertTrue(error is IllegalStateException)
    assertTrue(error!!.message!!.contains("blank token"))
  }

  @Test
  fun failToken_throwsWithTheMerchantsMessage() {
    UqpayNativeState.addListener()

    val future = fetchAsync()
    val requestId = awaitRequestId()
    provider.fail(requestId, "the merchant backend returned 503")

    val error = future.get(5, TimeUnit.SECONDS).exceptionOrNull()
    assertTrue(error is IllegalStateException)
    assertTrue(error!!.message!!.contains("the merchant backend returned 503"))
  }

  @Test
  fun javaScriptNeverAnswers_timesOutAndThrows() {
    UqpayNativeState.addListener()

    val future = fetchAsync()
    awaitRequestId()
    // Nobody calls provideToken/failToken: the 50 ms test budget expires.

    val error = future.get(5, TimeUnit.SECONDS).exceptionOrNull()
    assertTrue(error is IllegalStateException)
    assertTrue(error!!.message!!.contains("did not answer within"))
  }

  @Test
  fun noJavaScriptListenerAtAll_waitsThenThrowsWithoutEmitting() {
    // The process-death case: the sheet is back before JS has re-subscribed (AC RN-BR6).
    val outcome = fetchAsync().get(5, TimeUnit.SECONDS)

    val error = outcome.exceptionOrNull()
    assertTrue(error is IllegalStateException)
    assertTrue(error!!.message!!.contains("no JavaScript listener"))
    assertTrue("nothing can be emitted with no subscriber", emitted.isEmpty())
  }

  @Test
  fun aListenerThatAppearsDuringTheWait_unblocksTheFetch() {
    val future = fetchAsync()
    // The wait is a condition, not a poll: signalling it is what lets the fetch proceed.
    UqpayNativeState.addListener()
    val requestId = awaitRequestId()
    provider.provide(requestId, "late-listener-token", UqpayRuntime.now() + 1_800_000L)

    assertEquals("late-listener-token", future.get(5, TimeUnit.SECONDS).getOrThrow())
  }

  @Test
  fun unknownExpiry_isCachedForTheAssumedLifetimeAndHandedToTheSdk() {
    UqpayNativeState.addListener()
    val receivedAt = UqpayRuntime.now()
    val assumedExpiry = receivedAt + UqpayRuntime.ASSUMED_TOKEN_LIFETIME_MS

    val first = executor.submit<Long> { provider.fetchToken().expiresAtEpochMillis }
    provider.provide(awaitRequestId(), "no-expiry-token", -1L)
    assertEquals(
      "the SDK gets a real expiry, never 0 (which would make it re-ask on every request)",
      assumedExpiry,
      first.get(5, TimeUnit.SECONDS),
    )
    assertEquals(CachedToken("no-expiry-token", assumedExpiry), UqpayNativeState.cachedToken)

    // The next request inside the sheet is a cache hit, not a JS round trip.
    emitted.clear()
    assertEquals("no-expiry-token", provider.fetchToken().value)
    assertTrue(emitted.isEmpty())
  }

  @Test
  fun unknownExpiry_isAskedForAgainOnceTheAssumedLifetimeRunsOut() {
    UqpayNativeState.addListener()
    val receivedAt = UqpayRuntime.now()
    val first = fetchAsync()
    provider.provide(awaitRequestId(), "no-expiry-token", -1L)
    first.get(5, TimeUnit.SECONDS).getOrThrow()

    // 10 s short of the assumed expiry: under the 30 s floor.
    UqpayTest.setClock(receivedAt + UqpayRuntime.ASSUMED_TOKEN_LIFETIME_MS - 10_000L)
    emitted.clear()
    val second = fetchAsync()
    provider.provide(awaitRequestId(), "second-token", -1L)
    assertEquals("second-token", second.get(5, TimeUnit.SECONDS).getOrThrow())
  }

  @Test
  fun cachedTokenNeverPrintsItsValue() {
    assertFalse(CachedToken("secret-token-value", 1L).toString().contains("secret-token-value"))
  }

  @Test
  fun removingTheLastListener_putsTheGateBackUp() {
    UqpayNativeState.addListener()
    assertTrue(UqpayNativeState.hasListeners())
    UqpayNativeState.removeListeners(1)
    assertEquals(false, UqpayNativeState.hasListeners())

    val error = fetchAsync().get(5, TimeUnit.SECONDS).exceptionOrNull()
    assertTrue(error!!.message!!.contains("no JavaScript listener"))
  }

  @Test
  fun noMessageEverCarriesTheTokenValue() {
    UqpayNativeState.addListener()
    val future = fetchAsync()
    val requestId = awaitRequestId()
    provider.provide(requestId, "", UqpayRuntime.now() + 1_800_000L)

    val message = future.get(5, TimeUnit.SECONDS).exceptionOrNull()!!.message!!
    // AC RN-SEC7: the event payload is (requestId, reason) only, and the failure message
    // describes the provider, never the value it returned.
    assertEquals(setOf("requestId", "reason"), (emitted.first().second as JavaOnlyMap).toHashMap().keys)
    assertTrue(message.contains("blank token"))
  }

  // ---- priming before the sheet Activity takes the foreground (issues.md #7) -------------

  @Test
  fun primeForPresent_answersTheSheetsFetchWithoutWakingJavaScriptAgain() {
    UqpayNativeState.addListener()

    // The prime blocks exactly like a real fetch, so it runs off-thread and JS answers it.
    val priming = executor.submit { provider.primeForPresent() }
    provider.provide(awaitRequestId(), "primed-token", -1L)
    priming.get(5, TimeUnit.SECONDS)

    emitted.clear()
    // This is the call the SDK makes from inside UQPayPaymentActivity, where JS can no
    // longer answer: it must be served from the primed value, not from a new round trip.
    assertEquals("primed-token", provider.fetchToken().value)
    assertTrue("a primed token must not wake JS again", emitted.isEmpty())
  }

  @Test
  fun primeForPresent_hasTheSdkReceiveThePrimedTokensRealExpiry() {
    UqpayNativeState.addListener()
    val expiry = UqpayRuntime.now() + 1_800_000L
    val priming = executor.submit<PrimeOutcome> { provider.primeForPresent() }
    provider.provide(awaitRequestId(), "primed-token", expiry)
    assertEquals(PrimeOutcome.Ready, priming.get(5, TimeUnit.SECONDS))

    val token = provider.fetchToken()
    assertEquals("primed-token", token.value)
    assertEquals(expiry, token.expiresAtEpochMillis)
  }

  @Test
  fun primeForPresent_refreshesACachedTokenInsideTheMargin() {
    // The host is still in front here, so this is the moment to replace a token with less
    // than 120 s left — the sheet then starts with a fresh one.
    UqpayNativeState.addListener()
    UqpayNativeState.cachedToken = CachedToken("old-token", UqpayRuntime.now() + 60_000L)

    val priming = executor.submit<PrimeOutcome> { provider.primeForPresent() }
    provider.provide(awaitRequestId(), "fresh-token", UqpayRuntime.now() + 1_800_000L)
    assertEquals(PrimeOutcome.Ready, priming.get(5, TimeUnit.SECONDS))
    assertEquals("refresh", (emitted.first().second as JavaOnlyMap).getString("reason"))
    assertEquals("fresh-token", provider.fetchToken().value)
  }

  @Test
  fun primeForPresent_isConsumedExactlyOnce() {
    UqpayNativeState.addListener()
    val priming = executor.submit { provider.primeForPresent() }
    provider.provide(awaitRequestId(), "primed-token", -1L)
    priming.get(5, TimeUnit.SECONDS)

    assertEquals("primed-token", provider.fetchToken().value)

    emitted.clear()
    // Second fetch with the cache emptied: nothing primed is left, so this is an ordinary
    // JS round trip again.
    UqpayNativeState.cachedToken = null
    val second = fetchAsync()
    provider.provide(awaitRequestId(), "second-token", -1L)
    assertEquals("second-token", second.get(5, TimeUnit.SECONDS).getOrThrow())
  }

  @Test
  fun primeForPresent_withNoListener_waitsForOneThenReportsFailure() {
    // No `addListener`: the host is still in front, so a listener that is about to subscribe
    // gets the listener budget; when none does, the present is told so and can settle
    // `authentication_failed` without launching a sheet.
    val outcome = provider.primeForPresent()

    assertTrue(emitted.isEmpty())
    assertTrue(outcome is PrimeOutcome.Failed)
    assertTrue((outcome as PrimeOutcome.Failed).developerMessage.contains("no JavaScript listener"))
  }

  @Test
  fun primeForPresent_withAValidCachedToken_doesNotAskJavaScript() {
    UqpayNativeState.addListener()
    UqpayNativeState.cachedToken = CachedToken("cached-token", UqpayRuntime.now() + 600_000L)

    provider.primeForPresent()

    assertTrue("a live cached token is enough (AC RN-BR6)", emitted.isEmpty())
    assertEquals("cached-token", provider.fetchToken().value)
  }

  @Test
  fun primeForPresent_thatFails_leavesFetchTokenExactlyAsItWas() {
    UqpayNativeState.addListener()
    val priming = executor.submit<PrimeOutcome> { provider.primeForPresent() }
    provider.fail(awaitRequestId(), "the merchant backend returned 503")
    val outcome = priming.get(5, TimeUnit.SECONDS)
    assertTrue(
      "the merchant's own message reaches the result",
      (outcome as PrimeOutcome.Failed).developerMessage.contains("the merchant backend returned 503"),
    )

    emitted.clear()
    val future = fetchAsync()
    val requestId = awaitRequestId()
    provider.provide(requestId, "recovered-token", -1L)
    assertEquals("recovered-token", future.get(5, TimeUnit.SECONDS).getOrThrow())
  }

  @Test
  fun aSettledPayment_dropsAnUnusedPrimedToken() {
    UqpayNativeState.addListener()
    val priming = executor.submit { provider.primeForPresent() }
    provider.provide(awaitRequestId(), "primed-token", -1L)
    priming.get(5, TimeUnit.SECONDS)

    // The sheet ended without ever calling fetchToken (a terminal-intent guard, say). The
    // cache is emptied too, so only a leftover *primed* token could answer the next fetch.
    UqpayNativeState.onNativeResult(UqpayTest.cancelled())
    UqpayNativeState.cachedToken = null

    emitted.clear()
    val future = fetchAsync()
    provider.provide(awaitRequestId(), "next-payments-token", -1L)
    assertEquals(
      "a stale primed token must never answer the next payment",
      "next-payments-token",
      future.get(5, TimeUnit.SECONDS).getOrThrow(),
    )
  }
}
