//
//  Uqpay.h
//  uqpay-react-native
//
//  Thin Objective-C++ Turbo Module shim. It exists only because the UQPAY iOS
//  SDK has a Swift-only surface with zero `@objc` API (AC RN-BR3), so the module
//  itself cannot be written in Swift: Codegen emits a C++ protocol. Every method
//  converts the generated `JS::NativeUqpay::*` structs into `NSDictionary` and
//  forwards to `UqpayBridge` (Swift), which owns all state and all decisions.
//
//  `RCTEventEmitter` is the base class because the RN floor is 0.79, where the
//  Codegen `EventEmitter` type is not available (bridge-contract §0.6).
//

#import <React/RCTEventEmitter.h>
#import <UqpaySpec/UqpaySpec.h>

@interface Uqpay : RCTEventEmitter <NativeUqpaySpec>

@end
