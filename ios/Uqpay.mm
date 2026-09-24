//
//  Uqpay.mm
//  uqpay-react-native
//
//  Marshalling only. Every method turns the generated C++ struct into an
//  `NSDictionary` and hands it to `UqpayBridge` (Swift); nothing here inspects
//  or decides anything, and nothing here is logged (AC RN-SEC1).
//

#import "Uqpay.h"

#if __has_include(<uqpay_react_native/uqpay_react_native-Swift.h>)
#import <uqpay_react_native/uqpay_react_native-Swift.h>
#else
#import "uqpay_react_native-Swift.h"
#endif

#pragma mark - Struct → NSDictionary

static inline void UqpaySetString(NSMutableDictionary *dict, NSString *key, NSString *value)
{
  if (value != nil) {
    dict[key] = value;
  }
}

static NSDictionary *UqpayAppearanceDictionary(const JS::NativeUqpay::NativeAppearance &appearance)
{
  NSMutableDictionary *dict = [NSMutableDictionary new];
  UqpaySetString(dict, @"colorMode", appearance.colorMode());
  UqpaySetString(dict, @"primaryColor", appearance.primaryColor());
  UqpaySetString(dict, @"backgroundColor", appearance.backgroundColor());
  UqpaySetString(dict, @"surfaceColor", appearance.surfaceColor());
  UqpaySetString(dict, @"textColor", appearance.textColor());
  UqpaySetString(dict, @"secondaryTextColor", appearance.secondaryTextColor());
  UqpaySetString(dict, @"errorColor", appearance.errorColor());
  UqpaySetString(dict, @"iosExtras", appearance.iosExtras());
  // `androidExtras` is deliberately not forwarded: it is meaningless here.
  std::optional<double> cornerRadius = appearance.cornerRadius();
  if (cornerRadius.has_value()) {
    dict[@"cornerRadius"] = @(cornerRadius.value());
  }
  return dict;
}

static NSDictionary *UqpayInitConfigDictionary(const JS::NativeUqpay::NativeInitConfig &config)
{
  NSMutableDictionary *dict = [NSMutableDictionary new];
  UqpaySetString(dict, @"environment", config.environment());
  UqpaySetString(dict, @"clientId", config.clientId());
  UqpaySetString(dict, @"onBehalfOf", config.onBehalfOf());
  UqpaySetString(dict, @"configId", config.configId());
  dict[@"debugLogging"] = @(config.debugLogging());
  std::optional<JS::NativeUqpay::NativeAppearance> appearance = config.appearance();
  if (appearance.has_value()) {
    dict[@"appearance"] = UqpayAppearanceDictionary(appearance.value());
  }
  return dict;
}

static NSDictionary *UqpayBillingDetailsDictionary(const JS::NativeUqpay::NativeBillingDetails &billing)
{
  NSMutableDictionary *dict = [NSMutableDictionary new];
  UqpaySetString(dict, @"firstName", billing.firstName());
  UqpaySetString(dict, @"lastName", billing.lastName());
  UqpaySetString(dict, @"email", billing.email());
  UqpaySetString(dict, @"phone", billing.phone());
  UqpaySetString(dict, @"addressLine1", billing.addressLine1());
  UqpaySetString(dict, @"addressLine2", billing.addressLine2());
  UqpaySetString(dict, @"city", billing.city());
  UqpaySetString(dict, @"state", billing.state());
  UqpaySetString(dict, @"postalCode", billing.postalCode());
  UqpaySetString(dict, @"countryCode", billing.countryCode());
  return dict;
}

static NSDictionary *UqpayPresentOptionsDictionary(const JS::NativeUqpay::NativePresentOptions &options)
{
  NSMutableDictionary *dict = [NSMutableDictionary new];
  UqpaySetString(dict, @"paymentIntentId", options.paymentIntentId());
  UqpaySetString(dict, @"returnUrl", options.returnUrl());
  UqpaySetString(dict, @"presentationMode", options.presentationMode());
  UqpaySetString(dict, @"singleWalletMethod", options.singleWalletMethod());
  UqpaySetString(dict, @"merchantDisplayName", options.merchantDisplayName());

  std::optional<facebook::react::LazyVector<NSString *>> allowed = options.allowedPaymentMethods();
  if (allowed.has_value()) {
    const auto &vector = allowed.value();
    NSMutableArray<NSString *> *methods = [NSMutableArray arrayWithCapacity:(NSUInteger)vector.size()];
    for (decltype(vector.size()) index = 0; index < vector.size(); index++) {
      NSString *method = vector.at(index);
      if (method != nil) {
        [methods addObject:method];
      }
    }
    dict[@"allowedPaymentMethods"] = methods;
  }

  std::optional<JS::NativeUqpay::NativeBillingDetails> billing = options.billingDetails();
  if (billing.has_value()) {
    dict[@"billingDetails"] = UqpayBillingDetailsDictionary(billing.value());
  }
  return dict;
}

#pragma mark - Module

@implementation Uqpay {
  BOOL _hasListeners;
}

// Declares the module and its `+moduleName` ("Uqpay", the class name — the one
// name JS knows, bridge-contract §8).
RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    __weak Uqpay *weakSelf = self;
    [UqpayBridge.shared setEventSink:^(NSString *name, NSDictionary *body) {
      Uqpay *strongSelf = weakSelf;
      // AC RN-BR8 / bridge-contract §6: never send an event with no listener.
      if (strongSelf != nil && strongSelf->_hasListeners) {
        [strongSelf sendEventWithName:name body:body];
      }
    }];
  }
  return self;
}

- (void)invalidate
{
  _hasListeners = NO;
  [UqpayBridge.shared invalidate];
  [super invalidate];
}

#pragma mark - RCTEventEmitter

- (NSArray<NSString *> *)supportedEvents
{
  // The same three names as `src/nativeEvents.ts` (AC RN-BR8).
  return @[ @"uqpay_tokenRequested", @"uqpay_paymentReconciled", @"uqpay_requiresAction" ];
}

- (void)startObserving
{
  _hasListeners = YES;
  [UqpayBridge.shared setListening:YES];
}

- (void)stopObserving
{
  _hasListeners = NO;
  [UqpayBridge.shared setListening:NO];
}

#pragma mark - NativeUqpaySpec

- (void)initialize:(JS::NativeUqpay::NativeInitConfig &)config
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  [UqpayBridge.shared initializeWithConfig:UqpayInitConfigDictionary(config)
      onSuccess:^{
        resolve(nil);
      }
      onError:^(NSString *code, NSString *message) {
        reject(code, message, nil);
      }];
}

- (void)presentPaymentSheet:(JS::NativeUqpay::NativePresentOptions &)options
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject
{
  [UqpayBridge.shared presentPaymentSheetWithOptions:UqpayPresentOptionsDictionary(options)
      onResult:^(NSDictionary *result) {
        resolve(result);
      }
      onError:^(NSString *code, NSString *message) {
        reject(code, message, nil);
      }];
}

- (void)cancelPaymentSheet:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [UqpayBridge.shared cancelPaymentSheetWithCompletion:^{
    resolve(nil);
  }];
}

- (void)notifyReturnedFromBank
{
  [UqpayBridge.shared notifyReturnedFromBank];
}

- (void)getPendingResult:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [UqpayBridge.shared getPendingResultWithCompletion:^(NSDictionary *_Nullable result) {
    resolve(result);
  }];
}

- (void)provideToken:(NSString *)requestId
           authToken:(NSString *)authToken
    expiresAtEpochMs:(double)expiresAtEpochMs
{
  [UqpayBridge.shared provideTokenWithRequestId:requestId
                                      authToken:authToken
                               expiresAtEpochMs:expiresAtEpochMs];
}

- (void)failToken:(NSString *)requestId developerMessage:(NSString *)developerMessage
{
  [UqpayBridge.shared failTokenWithRequestId:requestId developerMessage:developerMessage];
}

- (void)getNativeInfo:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [UqpayBridge.shared getNativeInfoWithCompletion:^(NSDictionary *info) {
    resolve(info);
  }];
}

- (void)addListener:(NSString *)eventName
{
  [super addListener:eventName];
}

- (void)removeListeners:(double)count
{
  [super removeListeners:count];
}

#pragma mark - TurboModule

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeUqpaySpecJSI>(params);
}

@end
