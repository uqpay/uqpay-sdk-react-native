//
//  UqpayAppearanceMapper.swift
//  uqpay-react-native
//
//  `NativeAppearance` (flat, JSON-safe) → `PaymentSheet.Appearance` (UIColor).
//
//  Hex strings are already validated in JavaScript, but this mapper is
//  defensive: an unparseable colour is dropped with an `os_log` warning rather
//  than crashing or painting something arbitrary. Unknown `iosExtras` keys are
//  ignored with a warning too, so a newer JS release cannot break an older
//  native build.
//

import Foundation
import UIKit
import UqpayPaymentSheet

enum UqpayAppearanceMapper {

    // MARK: - Hex

    /// `#RRGGBB` / `#RRGGBBAA` (with or without the `#`) → `UIColor`.
    static func color(fromHex hex: String?) -> UIColor? {
        guard let hex else { return nil }
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6 || value.count == 8,
              value.allSatisfy({ $0.isHexDigit }),
              let raw = UInt64(value, radix: 16)
        else {
            UqpayBridgeLog.warn("appearance: ignoring malformed colour value (expected #RRGGBB or #RRGGBBAA)")
            return nil
        }
        let hasAlpha = value.count == 8
        let r = CGFloat((raw >> (hasAlpha ? 24 : 16)) & 0xFF) / 255.0
        let g = CGFloat((raw >> (hasAlpha ? 16 : 8)) & 0xFF) / 255.0
        let b = CGFloat((raw >> (hasAlpha ? 8 : 0)) & 0xFF) / 255.0
        let a = hasAlpha ? CGFloat(raw & 0xFF) / 255.0 : 1.0
        return UIColor(red: r, green: g, blue: b, alpha: a)
    }

    /// `'system' | 'light' | 'dark'` → `UIUserInterfaceStyle`.
    static func userInterfaceStyle(fromColorMode mode: String?) -> UIUserInterfaceStyle {
        switch (mode ?? "system").lowercased() {
        case "light": return .light
        case "dark": return .dark
        case "system", "": return .unspecified
        default:
            UqpayBridgeLog.warn("appearance: unknown colorMode, falling back to 'system'")
            return .unspecified
        }
    }

    // MARK: - Building

    /// Builds a `PaymentSheet.Appearance` from the bridged dictionary.
    ///
    /// `primaryColor` and `cornerRadius` go through the designated initialiser so
    /// the SDK's derived values (`primaryColorLight`, `payButtonColor`) stay
    /// consistent; everything else is assigned afterwards.
    static func appearance(from dict: [String: Any]?) -> PaymentSheet.Appearance {
        guard let dict else { return PaymentSheet.Appearance() }

        let primary = color(fromHex: dict["primaryColor"] as? String)
        let background = color(fromHex: dict["backgroundColor"] as? String)
        let radius = (dict["cornerRadius"] as? NSNumber).map { CGFloat($0.doubleValue) }

        let defaults = PaymentSheet.Appearance()
        let appearance = PaymentSheet.Appearance(
            cornerRadius: radius ?? defaults.cornerRadius,
            primaryColor: primary ?? defaults.primaryColor,
            backgroundColor: background ?? defaults.backgroundColor
        )

        appearance.userInterfaceStyle = userInterfaceStyle(fromColorMode: dict["colorMode"] as? String)

        if let background {
            appearance.system.background = background
            appearance.system.toolbarBackground = background
            appearance.alertBackgroundColor = background
        }
        if let surface = color(fromHex: dict["surfaceColor"] as? String) {
            appearance.fieldBackgroundColor = surface
            appearance.closeButtonBackgroundColor = surface
        }
        if let text = color(fromHex: dict["textColor"] as? String) {
            appearance.titleColor = text
            appearance.labelColor = text
            appearance.alertTitleColor = text
            appearance.system.defaultText = text
        }
        if let secondary = color(fromHex: dict["secondaryTextColor"] as? String) {
            appearance.secondaryTextColor = secondary
            appearance.alertMessageColor = secondary
            appearance.system.placeholder = secondary
        }
        if dict["errorColor"] != nil {
            // `PaymentSheet.Appearance` has no error colour; the SDK uses
            // `.systemRed` throughout. Documented iOS limitation (RN-DOC7).
            UqpayBridgeLog.warn("appearance: `errorColor` is not themeable on iOS and was ignored")
        }

        applyExtras(dict["iosExtras"] as? String, to: appearance)
        return appearance
    }

    // MARK: - iosExtras

    /// Every `PaymentSheet.Appearance` colour reachable by name, including the
    /// two nested value structs via dotted keys.
    static let colorSetters: [String: (PaymentSheet.Appearance, UIColor) -> Void] = [
        "primaryColor": { $0.primaryColor = $1 },
        "primaryColorLight": { $0.primaryColorLight = $1 },
        "backgroundColor": { $0.backgroundColor = $1 },
        "titleColor": { $0.titleColor = $1 },
        "labelColor": { $0.labelColor = $1 },
        "secondaryTextColor": { $0.secondaryTextColor = $1 },
        "closeButtonColor": { $0.closeButtonColor = $1 },
        "fieldBackgroundColor": { $0.fieldBackgroundColor = $1 },
        "fieldBorderColor": { $0.fieldBorderColor = $1 },
        "closeButtonBackgroundColor": { $0.closeButtonBackgroundColor = $1 },
        "payButtonColor": { $0.payButtonColor = $1 },
        "payButtonTextColor": { $0.payButtonTextColor = $1 },
        "loadingIndicatorColor": { $0.loadingIndicatorColor = $1 },
        "emptyViewBackgroundColor": { $0.emptyViewBackgroundColor = $1 },
        "alertBackgroundColor": { $0.alertBackgroundColor = $1 },
        "alertTitleColor": { $0.alertTitleColor = $1 },
        "alertMessageColor": { $0.alertMessageColor = $1 },
        "cardBrand.visa": { $0.cardBrand.visa = $1 },
        "cardBrand.masterCard": { $0.cardBrand.masterCard = $1 },
        "cardBrand.amex": { $0.cardBrand.amex = $1 },
        "cardBrand.unknown": { $0.cardBrand.unknown = $1 },
        "system.toolbarBackground": { $0.system.toolbarBackground = $1 },
        "system.iconTint": { $0.system.iconTint = $1 },
        "system.defaultText": { $0.system.defaultText = $1 },
        "system.background": { $0.system.background = $1 },
        "system.white": { $0.system.white = $1 },
        "system.separator": { $0.system.separator = $1 },
        "system.placeholder": { $0.system.placeholder = $1 },
    ]

    /// Applies the `iosExtras` JSON object. Unknown keys are ignored with a
    /// warning; malformed JSON is ignored entirely.
    static func applyExtras(_ json: String?, to appearance: PaymentSheet.Appearance) {
        guard let json, !json.isEmpty else { return }
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let extras = object as? [String: Any]
        else {
            UqpayBridgeLog.warn("appearance: `iosExtras` is not a JSON object and was ignored")
            return
        }

        for (key, value) in extras {
            if key == "cornerRadius", let number = value as? NSNumber {
                appearance.cornerRadius = CGFloat(number.doubleValue)
                continue
            }
            if key == "userInterfaceStyle", let mode = value as? String {
                appearance.userInterfaceStyle = userInterfaceStyle(fromColorMode: mode)
                continue
            }
            guard let setter = colorSetters[key] else {
                UqpayBridgeLog.warn("appearance: ignoring unknown `iosExtras` key")
                continue
            }
            guard let hex = value as? String, let parsed = color(fromHex: hex) else {
                UqpayBridgeLog.warn("appearance: ignoring `iosExtras` entry with a malformed colour")
                continue
            }
            setter(appearance, parsed)
        }
    }
}
