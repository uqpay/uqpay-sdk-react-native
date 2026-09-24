[**@uqpay/react-native**](../README.md)

***

[@uqpay/react-native](../README.md) / Appearance

# Type Alias: Appearance

> **Appearance** = `object`

Theming for the native sheet. Colours are hex strings (`'#RRGGBB'` or
`'#RRGGBBAA'`; Android also accepts `'#AARRGGBB'`), validated at `init` —
an invalid value rejects rather than rendering something unexpected.

The common subset is mapped onto iOS `PaymentSheet.Appearance` and Android
`UQPayAppearance.Colors`. Anything outside it goes through the per-platform
escape hatches, which are passed to the native untouched.

Appearance is an **`init`** option because the Android native binds it to its
configuration; changing it means re-`init`, which rebuilds Android's token
cache. The iOS 3DS screen is not themeable (native limitation).

## Example

```ts
await init({
  environment: 'sandbox',
  clientId: 'ck_test_123',
  tokenProvider,
  appearance: {
    colorMode: 'system',
    primaryColor: '#0A84FF',
    cornerRadius: 12,
    ios: { payButtonColor: '#0A84FF', fieldBorderColor: '#D1D1D6' },
    android: { light: { primary: '#FF0A84FF' }, dark: { primary: '#FF64D2FF' } },
  },
});
```

## Properties

### android?

> `optional` **android?**: `object`

Android-only escape hatch: `UQPayAppearance.Colors` keys to hex colours, per colour scheme.

#### dark?

> `optional` **dark?**: `Record`\<`string`, `string`\>

Colours used when the host is in dark mode.

#### light?

> `optional` **light?**: `Record`\<`string`, `string`\>

Colours used when the host is in light mode.

***

### backgroundColor?

> `optional` **backgroundColor?**: `string`

Sheet background.

***

### colorMode?

> `optional` **colorMode?**: `"system"` \| `"light"` \| `"dark"`

Follow the host app (`'system'`, the default) or pin light / dark.

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Corner radius in dp (Android) / pt (iOS).

***

### errorColor?

> `optional` **errorColor?**: `string`

Error text and invalid field borders.

***

### ios?

> `optional` **ios?**: `Record`\<`string`, `string`\>

iOS-only escape hatch: `PaymentSheet.Appearance` colour property names to
hex colours, for example `primaryColorLight`, `titleColor`, `labelColor`,
`fieldBackgroundColor`, `fieldBorderColor`, `payButtonColor`,
`payButtonTextColor`, `closeButtonColor`, `cardBrand.visa` or
`system.separator`. An unknown key is ignored with a native debug warning.

***

### primaryColor?

> `optional` **primaryColor?**: `string`

Accent / call-to-action colour.

***

### secondaryTextColor?

> `optional` **secondaryTextColor?**: `string`

Secondary / helper text.

***

### surfaceColor?

> `optional` **surfaceColor?**: `string`

Cards and fields drawn on top of the background.

***

### textColor?

> `optional` **textColor?**: `string`

Primary text.
