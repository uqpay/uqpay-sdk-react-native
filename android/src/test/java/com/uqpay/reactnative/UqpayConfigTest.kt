package com.uqpay.reactnative

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.JavaOnlyMap
import com.uqpay.sdk.UQPay
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Configuration idempotency and the persisted re-apply (AC RN-IDEM1, RN-BR5, RN-API9,
 * RN-SEC7, RN-SEC12).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UqpayConfigTest {

  private lateinit var context: Context
  private lateinit var reactContext: TestReactContext
  private lateinit var module: UqpayModule

  @Before
  fun setUp() {
    UqpayTest.installRuntime()
    context = ApplicationProvider.getApplicationContext()
    context.getSharedPreferences(UqpayNativeState.PREFS_NAME, Context.MODE_PRIVATE)
      .edit().clear().commit()
    UqpayNativeState.resetForTesting()
    reactContext = TestReactContext(context)
    module = UqpayModule(reactContext)
  }

  @After fun tearDown() = UqpayTest.tearDown()

  @Test
  fun initialize_initialisesTheNativeSdkAndPersistsTheNonSecretConfig() {
    val promise = FakePromise()
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), promise)

    assertTrue(promise.isResolved)
    assertTrue(UQPay.isInitialized)
    assertEquals("cfg-1", UqpayNativeState.currentConfigId)

    val persisted = UqpayNativeState.readPersistedConfig(context)!!
    assertEquals("cfg-1", persisted.configId)
    assertEquals("rn-test-client", persisted.clientId)
    assertEquals("sandbox", persisted.environment)
  }

  @Test
  fun persistedConfig_neverContainsAToken() {
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), FakePromise())
    UqpayNativeState.cachedToken = CachedToken("super-secret", UqpayRuntime.now() + 600_000L)

    val all = context.getSharedPreferences(UqpayNativeState.PREFS_NAME, Context.MODE_PRIVATE).all
    val allowed = setOf("environment", "clientId", "onBehalfOf", "appearance", "configId")
    assertTrue(
      "only non-secret fields may be persisted (AC RN-SEC7), found ${all.keys}",
      allowed.containsAll(all.keys),
    )
    assertEquals(setOf("environment", "clientId", "configId"), all.keys)
    assertTrue("no token ever reaches disk", all.values.none { it?.toString()?.contains("super-secret") == true })
  }

  @Test
  fun sameConfigId_isANoOpAndKeepsTheTokenCache() {
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), FakePromise())
    UqpayNativeState.cachedToken = CachedToken("cached", UqpayRuntime.now() + 600_000L)

    val second = FakePromise()
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), second)

    assertTrue(second.isResolved)
    assertEquals(1, second.settleCount)
    assertEquals("the token cache survives a repeat init", "cached", UqpayNativeState.cachedToken?.value)
  }

  @Test
  fun differentConfigIdWhileIdle_reInitialisesAndDropsTheTokenCache() {
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), FakePromise())
    UqpayNativeState.cachedToken = CachedToken("cached", UqpayRuntime.now() + 600_000L)

    val second = FakePromise()
    module.initialize(
      UqpayTest.initConfig(configId = "cfg-2", clientId = "other-client", environment = "production"),
      second,
    )

    assertTrue(second.isResolved)
    assertEquals("cfg-2", UqpayNativeState.currentConfigId)
    assertNull("new credentials invalidate the old token", UqpayNativeState.cachedToken)
    assertEquals("production", UqpayNativeState.readPersistedConfig(context)!!.environment)
  }

  @Test
  fun differentConfigIdWhilePresenting_rejectsWithInvalidConfiguration() {
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), FakePromise())
    UqpayNativeState.beginPresenting(UqpayTest.INTENT_ID, FakePromise())

    val promise = FakePromise()
    module.initialize(UqpayTest.initConfig(configId = "cfg-2"), promise)

    assertTrue(promise.isRejected)
    assertEquals("invalid_configuration", promise.rejectedCode)
    assertEquals("cfg-1", UqpayNativeState.currentConfigId)
  }

  @Test
  fun sameConfigIdWhilePresenting_isStillANoOp() {
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), FakePromise())
    UqpayNativeState.beginPresenting(UqpayTest.INTENT_ID, FakePromise())

    val promise = FakePromise()
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), promise)

    assertTrue("an app boot after a Metro reload is safe (AC RN-API9)", promise.isResolved)
  }

  @Test
  fun blankClientIdOrConfigId_rejects() {
    val blankClient = FakePromise()
    module.initialize(UqpayTest.initConfig(configId = "cfg-1", clientId = "  "), blankClient)
    assertEquals("invalid_configuration", blankClient.rejectedCode)

    val blankConfigId = FakePromise()
    module.initialize(UqpayTest.initConfig(configId = " "), blankConfigId)
    assertEquals("invalid_configuration", blankConfigId.rejectedCode)
  }

  @Test
  fun ensureInitialized_reAppliesThePersistedConfigWithNoJavaScript() {
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), FakePromise())

    // Simulate process death: the object's state is gone, SharedPreferences are not.
    UqpayNativeState.resetForTesting()
    assertNull(UqpayNativeState.currentConfigId)

    UqpayNativeState.ensureInitialized(context)

    assertTrue("the relaunched sheet never sees not_initialized (AC RN-BR5)", UQPay.isInitialized)
    assertEquals("cfg-1", UqpayNativeState.currentConfigId)
    assertTrue("no JS was involved", reactContext.emittedEvents.isEmpty())
  }

  @Test
  fun ensureInitializedWithNothingPersisted_isASilentNoOp() {
    UqpayNativeState.resetForTesting()
    UqpayNativeState.ensureInitialized(context)
    assertNull(UqpayNativeState.currentConfigId)
  }

  @Test
  fun moduleConstructor_runsEnsureInitialized() {
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), FakePromise())
    UqpayNativeState.resetForTesting()

    UqpayModule(TestReactContext(context))

    assertEquals("cfg-1", UqpayNativeState.currentConfigId)
  }

  @Test
  fun appearanceIsPersistedAsJsonAndMappedIntoTheConfiguration() {
    val appearance = JavaOnlyMap().apply {
      putString("colorMode", "dark")
      putString("primaryColor", "#123456")
      putDouble("cornerRadius", 8.0)
      putString("androidExtras", """{"dark":{"outline":"#FF00FF00"}}""")
    }
    module.initialize(UqpayTest.initConfig(configId = "cfg-appearance", appearance = appearance), FakePromise())

    val json = UqpayNativeState.readPersistedConfig(context)!!.appearanceJson
    assertNotNull(json)
    assertTrue(json!!.contains("#123456"))
    assertTrue(json.contains("dark"))
  }

  @Test
  fun getNativeInfo_reportsTheNativeSdkVersion() {
    module.initialize(UqpayTest.initConfig(configId = "cfg-1"), FakePromise())
    val promise = FakePromise()
    module.getNativeInfo(promise)

    val info = promise.map()
    assertEquals("android", info.getString("platform"))
    assertEquals(UQPay.version, info.getString("nativeSdkVersion"))
    assertTrue(info.getBoolean("isInitialized"))
    assertEquals(false, info.getBoolean("isPresenting"))
  }
  // ---- a configuration the native SDK refuses --------------------------------------------------

  @Test
  fun aClientIdWithALineBreak_rejectsInvalidConfigurationInsteadOfThrowing() {
    module.initialize(UqpayTest.initConfig(configId = "cfg-good"), FakePromise())

    val promise = FakePromise()
    module.initialize(UqpayTest.initConfig(configId = "cfg-bad", clientId = "client\nid"), promise)

    assertTrue(promise.isRejected)
    assertEquals("invalid_configuration", promise.rejectedCode)
    assertTrue(promise.rejectedMessage!!.contains("line break"))
    assertEquals("the previous configuration stays in force", "cfg-good", UqpayNativeState.currentConfigId)
    assertEquals("nothing is persisted", "cfg-good", UqpayNativeState.readPersistedConfig(context)!!.configId)
  }

  @Test
  fun aNonFiniteAppearanceNumber_rejectsInvalidConfigurationInsteadOfThrowing() {
    val promise = FakePromise()
    val appearance = JavaOnlyMap().apply { putDouble("cornerRadius", Double.NaN) }
    module.initialize(UqpayTest.initConfig(configId = "cfg-nan", appearance = appearance), promise)

    assertTrue(promise.isRejected)
    assertEquals("invalid_configuration", promise.rejectedCode)
  }

  @Test
  fun aPersistedConfigTheSdkRefuses_doesNotThrowFromTheModuleConstructor() {
    context.getSharedPreferences(UqpayNativeState.PREFS_NAME, Context.MODE_PRIVATE).edit()
      .putString("clientId", "client\nid")
      .putString("configId", "cfg-corrupt")
      .commit()
    UqpayNativeState.resetForTesting()

    // Would crash the host app at start-up if the SDK's validation escaped.
    UqpayModule(TestReactContext(context))

    assertNull(UqpayNativeState.currentConfigId)
  }
}
