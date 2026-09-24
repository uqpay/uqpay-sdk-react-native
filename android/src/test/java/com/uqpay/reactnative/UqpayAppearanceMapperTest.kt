package com.uqpay.reactnative

import com.facebook.react.bridge.JavaOnlyMap
import com.uqpay.sdk.appearance.UQPayAppearance
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** `NativeAppearance` → `UQPayAppearance` (bridge-contract §1). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UqpayAppearanceMapperTest {

  @Before fun setUp() = UqpayTest.installRuntime()

  @After fun tearDown() = UqpayTest.tearDown()

  @Test
  fun noAppearance_isTheSdkDefault() {
    assertEquals(UQPayAppearance.DEFAULT, UqpayAppearanceMapper.toAppearance(null))
    assertNull(UqpayAppearanceMapper.toJson(null))
    assertNull("an empty appearance object is the same as none", UqpayAppearanceMapper.toJson(JavaOnlyMap()))
  }

  @Test
  fun commonSubset_appliesToBothModes() {
    val appearance = UqpayAppearanceMapper.toAppearance(
      JSONObject(
        """
        {
          "colorMode": "dark",
          "primaryColor": "#112233",
          "backgroundColor": "#445566",
          "surfaceColor": "#778899",
          "textColor": "#AABBCC",
          "secondaryTextColor": "#DDEEFF",
          "errorColor": "#FF0000",
          "cornerRadius": 4
        }
        """.trimIndent(),
      ),
    )

    assertEquals(UQPayAppearance.ColorMode.DARK, appearance.colorMode)
    assertEquals(4f, appearance.cornerRadiusDp, 0.001f)
    for (colors in listOf(appearance.lightColors, appearance.darkColors)) {
      assertEquals(0xFF112233.toInt(), colors.primary)
      assertEquals(0xFF445566.toInt(), colors.background)
      assertEquals(0xFF778899.toInt(), colors.surface)
      assertEquals("one text colour drives both slots", 0xFFAABBCC.toInt(), colors.onBackground)
      assertEquals(0xFFAABBCC.toInt(), colors.onSurface)
      assertEquals(0xFFDDEEFF.toInt(), colors.onSurfaceVariant)
      assertEquals(0xFFFF0000.toInt(), colors.error)
    }
  }

  @Test
  fun androidExtras_overrideTheCommonSubsetPerMode() {
    val appearance = UqpayAppearanceMapper.toAppearance(
      JSONObject(
        """
        {
          "primaryColor": "#112233",
          "androidExtras": "{\"light\":{\"primary\":\"#FF00FF00\",\"onError\":\"#FF010203\"},\"dark\":{\"outline\":\"#80000000\"}}"
        }
        """.trimIndent(),
      ),
    )

    assertEquals(0xFF00FF00.toInt(), appearance.lightColors.primary)
    assertEquals(0xFF010203.toInt(), appearance.lightColors.onError)
    assertEquals("dark keeps the common subset where extras say nothing", 0xFF112233.toInt(), appearance.darkColors.primary)
    assertEquals(0x80000000.toInt(), appearance.darkColors.outline)
  }

  @Test
  fun cssAlphaIsLast_androidAlphaIsFirst() {
    assertEquals(0x80112233.toInt(), UqpayAppearanceMapper.parseCss("#11223380"))
    assertEquals(0xFF112233.toInt(), UqpayAppearanceMapper.parseCss("#112233"))
    assertEquals(0x80112233.toInt(), UqpayAppearanceMapper.parseArgb("#80112233"))
    assertEquals(0xFF112233.toInt(), UqpayAppearanceMapper.parseArgb("112233"))
  }

  @Test
  fun malformedColoursAndJson_areDroppedRatherThanThrown() {
    assertNull(UqpayAppearanceMapper.parseCss("#12345"))
    assertNull(UqpayAppearanceMapper.parseCss("rebeccapurple"))
    assertNull(UqpayAppearanceMapper.parseCss(""))
    assertNull(UqpayAppearanceMapper.parseCss("#GGHHII"))

    val appearance = UqpayAppearanceMapper.toAppearance(
      JSONObject("""{"primaryColor":"nope","androidExtras":"{not json"}"""),
    )
    // A typo in a colour must never be the thing that kills a checkout.
    assertEquals(UQPayAppearance.Colors.MATERIAL_LIGHT.primary, appearance.lightColors.primary)
  }

  @Test
  fun unknownColorMode_fallsBackToSystem() {
    val appearance = UqpayAppearanceMapper.toAppearance(JSONObject("""{"colorMode":"sepia"}"""))
    assertEquals(UQPayAppearance.ColorMode.SYSTEM, appearance.colorMode)
  }

  @Test
  fun cornerRadiusIsClampedByTheSdkNotByUs() {
    val appearance = UqpayAppearanceMapper.toAppearance(JSONObject("""{"cornerRadius":999}"""))
    assertEquals(UQPayAppearance.MAX_CORNER_RADIUS_DP, appearance.cornerRadiusDp, 0.001f)
  }

  @Test
  fun toJson_copiesOnlyTheKnownKeys() {
    val json = UqpayAppearanceMapper.toJson(
      JavaOnlyMap().apply {
        putString("primaryColor", "#112233")
        putDouble("cornerRadius", 6.0)
        putString("iosExtras", """{"ignored":true}""")
        putString("somethingElse", "dropped")
      },
    )!!
    assertEquals("#112233", json.getString("primaryColor"))
    assertEquals(6.0, json.getDouble("cornerRadius"), 0.001)
    assertEquals(false, json.has("somethingElse"))
  }
}
