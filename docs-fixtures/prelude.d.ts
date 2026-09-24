/**
 * Ambient stand-ins for things the documentation samples legitimately use but
 * this package does not depend on.
 *
 * `@react-native-async-storage/async-storage` is the storage package almost
 * every React Native app already has; the persist-and-reconcile pattern reads
 * much better with a real name than with a placeholder. Declaring it here keeps
 * it out of `package.json` (AC RN-DEP1: the runtime dependency tree stays
 * `react` + `react-native` and nothing else).
 */
declare module '@react-native-async-storage/async-storage' {
  const AsyncStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  export default AsyncStorage;
}

/**
 * `process.env` — real in both places the samples use it: Node (the reference
 * backend snippets) and React Native, where Expo and `babel-plugin-dotenv`
 * inline `EXPO_PUBLIC_*` at build time.
 */
declare const process: { env: Record<string, string | undefined> };

/** React Native's build-time flag, injected by Metro. */
declare const __DEV__: boolean;
