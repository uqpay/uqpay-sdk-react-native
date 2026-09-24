require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "uqpay-react-native"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  # iOS floor is 15.1 (React Native's own floor).
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/uqpay/uqpay-sdk-react-native.git", :tag => "v#{s.version}" }

  # Only the bridge itself — `ios/Tests` belongs to the test spec below, and a
  # recursive glob would compile the XCTest sources into the shipping pod.
  s.source_files = "ios/*.{h,m,mm,swift}"
  s.private_header_files = "ios/*.h"

  s.swift_version = "5.9"
  s.static_framework = true

  # The ObjC++ shim imports the Swift half through the generated module header
  # (`uqpay_react_native-Swift.h`), which only exists when the pod defines a
  # module. Module name = pod name with hyphens replaced by underscores
  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20"
  }

  # Published native SDK at a patch-only range.
  # `~> 1.1.0` admits 1.1.x only; `~> 1.1` would admit 1.2.
  s.dependency "UqpaySDKiOS", "~> 1.1.0"

  # Bridge contract tests. `pod install` in a host app generates a
  # `uqpay-react-native-Unit-Tests` target/scheme in Pods.xcodeproj; run it with
  #   xcodebuild test -workspace example/ios/ReactNativeExample.xcworkspace \
  #     -scheme uqpay-react-native-Unit-Tests -destination '<simulator>'
  s.test_spec "Tests" do |test_spec|
    test_spec.source_files = "ios/Tests/**/*.{swift,h,m,mm}"
    test_spec.resources = ["ios/Tests/Fixtures/**/*.json"]
    # Pure logic tests: mapper, encoder, buffer, broker, presenter walk and the
    # outcome state machine. No app host needed, and none is available inside a
    # Pods-only test target.
    test_spec.requires_app_host = false
  end

  # Defined by React Native's Podfile scripts; absent under a bare `pod lib lint`,
  # where React-Core from trunk is the closest stand-in.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
