//
//  UqpayAppearanceMapperTests.swift
//  AC RN-TEST5, RN-UX9 (appearance mapping), RN-BR3
//

import XCTest
import UIKit
import UqpayPaymentSheet

@testable import uqpay_react_native

final class UqpayAppearanceMapperTests: XCTestCase {

    private func components(_ color: UIColor?) -> [CGFloat] {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color?.getRed(&r, green: &g, blue: &b, alpha: &a)
        return [r, g, b, a].map { ($0 * 255).rounded() }
    }

    func testSixDigitHexIsParsedOpaque() {
        XCTAssertEqual(components(UqpayAppearanceMapper.color(fromHex: "#7C4DFF")), [124, 77, 255, 255])
        XCTAssertEqual(components(UqpayAppearanceMapper.color(fromHex: "7C4DFF")), [124, 77, 255, 255])
    }

    func testEightDigitHexCarriesAlpha() {
        XCTAssertEqual(components(UqpayAppearanceMapper.color(fromHex: "#7C4DFF80")), [124, 77, 255, 128])
    }

    func testMalformedHexIsRejectedRatherThanGuessed() {
        for value in ["#FFF", "", "#GGGGGG", "#7C4DF", "rgb(1,2,3)", "#7C4DFF801"] {
            XCTAssertNil(UqpayAppearanceMapper.color(fromHex: value), value)
        }
        XCTAssertNil(UqpayAppearanceMapper.color(fromHex: nil))
    }

    func testColorModeMapsToUserInterfaceStyle() {
        XCTAssertEqual(UqpayAppearanceMapper.userInterfaceStyle(fromColorMode: "light"), .light)
        XCTAssertEqual(UqpayAppearanceMapper.userInterfaceStyle(fromColorMode: "dark"), .dark)
        XCTAssertEqual(UqpayAppearanceMapper.userInterfaceStyle(fromColorMode: "system"), .unspecified)
        XCTAssertEqual(UqpayAppearanceMapper.userInterfaceStyle(fromColorMode: nil), .unspecified)
        XCTAssertEqual(UqpayAppearanceMapper.userInterfaceStyle(fromColorMode: "neon"), .unspecified)
    }

    func testFlatFieldsAreApplied() {
        let appearance = UqpayAppearanceMapper.appearance(from: [
            "colorMode": "dark",
            "primaryColor": "#112233",
            "backgroundColor": "#000000",
            "surfaceColor": "#010203",
            "textColor": "#FFFFFF",
            "secondaryTextColor": "#888888",
            "cornerRadius": NSNumber(value: 20),
        ])
        XCTAssertEqual(appearance.userInterfaceStyle, .dark)
        XCTAssertEqual(components(appearance.primaryColor), [17, 34, 51, 255])
        // The designated initialiser derives the pay button and light variant
        // from `primaryColor`, so they must follow it.
        XCTAssertEqual(components(appearance.payButtonColor), [17, 34, 51, 255])
        XCTAssertEqual(components(appearance.backgroundColor), [0, 0, 0, 255])
        XCTAssertEqual(components(appearance.fieldBackgroundColor), [1, 2, 3, 255])
        XCTAssertEqual(components(appearance.titleColor), [255, 255, 255, 255])
        XCTAssertEqual(components(appearance.secondaryTextColor), [136, 136, 136, 255])
        XCTAssertEqual(appearance.cornerRadius, 20)
    }

    func testAnEmptyDictionaryKeepsTheSdkDefaults() {
        let defaults = PaymentSheet.Appearance()
        let appearance = UqpayAppearanceMapper.appearance(from: [:])
        XCTAssertEqual(appearance.cornerRadius, defaults.cornerRadius)
        XCTAssertEqual(components(appearance.primaryColor), components(defaults.primaryColor))
        XCTAssertEqual(appearance.userInterfaceStyle, .unspecified)
    }

    func testIosExtrasAreAppliedByName() {
        let appearance = PaymentSheet.Appearance()
        UqpayAppearanceMapper.applyExtras(
            ##"{"payButtonTextColor":"#FF0000","cardBrand.visa":"#00FF00","system.separator":"#0000FF","cornerRadius":4}"##,
            to: appearance
        )
        XCTAssertEqual(components(appearance.payButtonTextColor), [255, 0, 0, 255])
        XCTAssertEqual(components(appearance.cardBrand.visa), [0, 255, 0, 255])
        XCTAssertEqual(components(appearance.system.separator), [0, 0, 255, 255])
        XCTAssertEqual(appearance.cornerRadius, 4)
    }

    func testUnknownIosExtrasKeysAreIgnored() {
        let appearance = PaymentSheet.Appearance()
        let before = components(appearance.primaryColor)
        UqpayAppearanceMapper.applyExtras(
            ##"{"notAThing":"#FF0000","alsoNot":123}"##, to: appearance
        )
        XCTAssertEqual(components(appearance.primaryColor), before)
    }

    func testMalformedIosExtrasAreIgnoredEntirely() {
        let appearance = PaymentSheet.Appearance()
        let before = components(appearance.payButtonTextColor)
        UqpayAppearanceMapper.applyExtras("not json", to: appearance)
        UqpayAppearanceMapper.applyExtras("[1,2,3]", to: appearance)
        UqpayAppearanceMapper.applyExtras("", to: appearance)
        UqpayAppearanceMapper.applyExtras(nil, to: appearance)
        XCTAssertEqual(components(appearance.payButtonTextColor), before)
    }

    func testAMalformedColourInsideIosExtrasIsSkippedButSiblingsApply() {
        let appearance = PaymentSheet.Appearance()
        UqpayAppearanceMapper.applyExtras(
            ##"{"payButtonTextColor":"nope","closeButtonColor":"#123456"}"##, to: appearance
        )
        XCTAssertEqual(components(appearance.closeButtonColor), [18, 52, 86, 255])
    }
}
