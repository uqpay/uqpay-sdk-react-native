package com.uqpay.reactnative

import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.uqpay.sdk.appearance.UQPayAppearance
import org.json.JSONObject

/**
 * `NativeAppearance` → `UQPayAppearance` (bridge-contract §1, android_analysis §2).
 *
 * The common subset maps onto the ten-slot `Colors` of **both** modes; `androidExtras` is
 * the escape hatch and wins over it. Appearance is set once, on the configuration — never
 * per payment — so this runs inside `initialize` and inside the re-apply from
 * SharedPreferences.
 *
 * Nothing here throws: a malformed colour is dropped and the SDK's Material default stays.
 * An appearance is cosmetic, and failing `initialize` over a bad hex string would turn a
 * typo into a dead checkout.
 *
 * Colour conventions, kept apart on purpose:
 * - the common fields are CSS-shaped — `#RRGGBB` or `#RRGGBBAA` (alpha **last**);
 * - `androidExtras` is Android-shaped — `#RRGGBB` or `#AARRGGBB` (alpha **first**),
 *   matching the `@ColorInt` ARGB ints the SDK's `Colors` takes.
 */
internal object UqpayAppearanceMapper {

  /** The ten `Colors` slots, in the order `Colors(...)` declares them. */
  private val EXTRA_KEYS = listOf(
    "primary", "onPrimary", "background", "onBackground", "surface",
    "onSurface", "onSurfaceVariant", "outline", "error", "onError",
  )

  private val COMMON_KEYS = listOf(
    "colorMode", "primaryColor", "backgroundColor", "surfaceColor",
    "textColor", "secondaryTextColor", "errorColor", "cornerRadius", "androidExtras",
  )

  /**
   * Copies the appearance out of the init config into a JSON object, which is what gets
   * persisted (non-secret, cosmetic) and re-read after a process relaunch.
   */
  fun toJson(appearance: ReadableMap?): JSONObject? {
    if (appearance == null) return null
    val json = JSONObject()
    for (key in COMMON_KEYS) {
      if (!appearance.hasKey(key) || appearance.isNull(key)) continue
      when (appearance.getType(key)) {
        ReadableType.String -> json.put(key, appearance.getString(key))
        ReadableType.Number -> json.put(key, appearance.getDouble(key))
        else -> Unit
      }
    }
    return if (json.length() == 0) null else json
  }

  fun toAppearance(json: JSONObject?): UQPayAppearance {
    if (json == null) return UQPayAppearance.DEFAULT

    val builder = UQPayAppearance.Builder()
    builder.colorMode(colorMode(json.optString("colorMode", "")))

    val corner = json.opt("cornerRadius")
    if (corner is Number) builder.cornerRadiusDp(corner.toFloat())

    val extras = parseExtras(json.optString("androidExtras", ""))
    builder.lightColors(
      colors(UQPayAppearance.Colors.MATERIAL_LIGHT, json, extras?.optJSONObject("light")),
    )
    builder.darkColors(
      colors(UQPayAppearance.Colors.MATERIAL_DARK, json, extras?.optJSONObject("dark")),
    )
    return builder.build()
  }

  private fun colorMode(raw: String): UQPayAppearance.ColorMode = when (raw.lowercase()) {
    "light" -> UQPayAppearance.ColorMode.LIGHT
    "dark" -> UQPayAppearance.ColorMode.DARK
    else -> UQPayAppearance.ColorMode.SYSTEM
  }

  private fun parseExtras(raw: String): JSONObject? {
    if (raw.isBlank()) return null
    return try {
      JSONObject(raw)
    } catch (_: Exception) {
      null
    }
  }

  private fun colors(
    base: UQPayAppearance.Colors,
    common: JSONObject,
    extras: JSONObject?,
  ): UQPayAppearance.Colors {
    val builder = UQPayAppearance.Colors.Builder(base)

    // Common subset: one merchant colour can legitimately drive several slots.
    cssColor(common, "primaryColor")?.let { builder.primary(it) }
    cssColor(common, "backgroundColor")?.let { builder.background(it) }
    cssColor(common, "surfaceColor")?.let { builder.surface(it) }
    cssColor(common, "textColor")?.let {
      builder.onBackground(it)
      builder.onSurface(it)
    }
    cssColor(common, "secondaryTextColor")?.let { builder.onSurfaceVariant(it) }
    cssColor(common, "errorColor")?.let { builder.error(it) }

    // androidExtras wins: it is the per-slot escape hatch.
    if (extras != null) {
      for (key in EXTRA_KEYS) {
        val value = argbColor(extras, key) ?: continue
        when (key) {
          "primary" -> builder.primary(value)
          "onPrimary" -> builder.onPrimary(value)
          "background" -> builder.background(value)
          "onBackground" -> builder.onBackground(value)
          "surface" -> builder.surface(value)
          "onSurface" -> builder.onSurface(value)
          "onSurfaceVariant" -> builder.onSurfaceVariant(value)
          "outline" -> builder.outline(value)
          "error" -> builder.error(value)
          "onError" -> builder.onError(value)
        }
      }
    }
    return builder.build()
  }

  private fun cssColor(json: JSONObject, key: String): Int? = parseCss(json.optString(key, ""))

  private fun argbColor(json: JSONObject, key: String): Int? = parseArgb(json.optString(key, ""))

  /** `#RRGGBB` / `#RRGGBBAA` (alpha last) → ARGB int. */
  fun parseCss(raw: String): Int? {
    val hex = normalise(raw) ?: return null
    return when (hex.length) {
      6 -> hex.toLongOrNull(16)?.toInt()?.or(0xFF000000.toInt())
      8 -> hex.toLongOrNull(16)?.let { rgba ->
        val alpha = (rgba and 0xFF).toInt()
        val rgb = (rgba ushr 8).toInt()
        (alpha shl 24) or (rgb and 0x00FFFFFF)
      }
      else -> null
    }
  }

  /** `#RRGGBB` / `#AARRGGBB` (alpha first) → ARGB int. */
  fun parseArgb(raw: String): Int? {
    val hex = normalise(raw) ?: return null
    return when (hex.length) {
      6 -> hex.toLongOrNull(16)?.toInt()?.or(0xFF000000.toInt())
      8 -> hex.toLongOrNull(16)?.toInt()
      else -> null
    }
  }

  private fun normalise(raw: String): String? {
    val trimmed = raw.trim().removePrefix("#")
    if (trimmed.isEmpty()) return null
    if (!trimmed.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' }) return null
    return trimmed
  }
}
