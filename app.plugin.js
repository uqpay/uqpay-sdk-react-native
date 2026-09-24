// Expo resolves `@uqpay/react-native` as a config plugin through this file.
// It is the ONLY place `@expo/config-plugins` is required, so a
// bare React Native app never loads it.
//
// `plugin/build` is produced by `yarn plugin:build` (`tsc -p plugin`) and is
// published; `plugin/src` is the source of truth.
module.exports = require('./plugin/build/withUqpay');
