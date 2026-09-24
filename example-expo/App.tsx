/**
 * Expo entry point.
 *
 * The app itself lives in `src/` and is the same code as the bare React Native
 * sample in `example/src/` — the point of this workspace is that *nothing*
 * about the integration changes under Expo. The only differences are in
 * `app.json` (the config plugin) and in how the native projects are produced
 * (`npx expo prebuild` instead of a checked-in `ios/` + `android/`).
 */
export { default } from './src/App';
