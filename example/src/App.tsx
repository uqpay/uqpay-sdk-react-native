/**
 * UQPAY React Native sample app.
 *
 * The whole integration is the `runInit` function below — about 15 lines. The
 * rest of this repo's `example/` is scaffolding to *show* the behaviour
 * (webhook inbox, pending/reconcile, theming, event log); a real checkout does
 * not need any of it.
 *
 * The one rule worth carrying away: the app holds a short-lived **token**,
 * never an API key. `tokenProvider` asks the merchant backend for one, and the
 * backend is the only thing that ever sees the merchant API key (D7, AC
 * RN-SEC3). This app does not name that variable anywhere — a tripwire test
 * fails the build if it ever does.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { init } from './uqpay';
import { clientId, environment, isConfigured } from './config';
import { fetchClientToken } from './backend';
import { describeThrown, fireAndForget, type DisplayError } from './errors';
import { APPEARANCE_PRESETS, ui, type ThemeName } from './theme';
import { HomeScreen } from './screens/HomeScreen';
import { WebhooksScreen } from './screens/WebhooksScreen';
import { Banner } from './components/ui';

type Tab = 'home' | 'webhooks';

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [theme, setTheme] = useState<ThemeName>('system');
  const [initError, setInitError] = useState<DisplayError | null>(null);
  const [initialising, setInitialising] = useState(true);

  /**
   * The entire SDK setup.
   *
   * `tokenProvider` is called by the native side before each present (iOS
   * cannot refresh a token mid-sheet), so keep it fast and let your backend
   * cache. `expiresAt` is epoch milliseconds; the backend already converts
   * UQPAY's epoch-seconds `expired_at` for us.
   */
  const runInit = useCallback(async (nextTheme: ThemeName) => {
    setInitialising(true);
    setInitError(null);
    try {
      const appearance = APPEARANCE_PRESETS[nextTheme];
      await init({
        environment,
        clientId,
        tokenProvider: async () => {
          const { authToken, expiresAt } = await fetchClientToken();
          return { authToken, expiresAt };
        },
        // `exactOptionalPropertyTypes` — omit the key rather than pass undefined.
        ...(appearance === undefined ? {} : { appearance }),
      });
    } catch (err) {
      setInitError(describeThrown(err));
    } finally {
      setInitialising(false);
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      // Nothing to initialise with; the Home screen explains how to fix it.
      setInitialising(false);
      return;
    }
    fireAndForget(runInit('system'));
  }, [runInit]);

  const changeTheme = useCallback(
    (next: ThemeName) => {
      setTheme(next);
      if (isConfigured) fireAndForget(runInit(next));
    },
    [runInit]
  );

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.title}>UQPAY React Native</Text>
        <Text style={styles.subtitle}>sample merchant app</Text>
      </View>

      <View style={styles.tabs}>
        {(['home', 'webhooks'] as const).map((name) => (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === name }}
            onPress={() => setTab(name)}
            style={[styles.tab, tab === name ? styles.tabActive : null]}
          >
            <Text
              style={[
                styles.tabText,
                tab === name ? styles.tabTextActive : null,
              ]}
            >
              {name === 'home' ? 'Checkout' : 'Webhooks'}
            </Text>
          </Pressable>
        ))}
      </View>

      {initError === null ? null : (
        <View style={styles.initError}>
          <Banner
            tone="danger"
            title="INIT FAILED"
            body={`${initError.userMessage}\n\n[${initError.code}] ${initError.developerMessage}`}
          />
        </View>
      )}

      <View style={styles.body}>
        {tab === 'home' ? (
          <HomeScreen
            theme={theme}
            onChangeTheme={changeTheme}
            themeBusy={initialising}
          />
        ) : (
          <WebhooksScreen />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ui.bg },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title: { color: ui.text, fontSize: 20, fontWeight: '800' },
  subtitle: { color: ui.textDim, fontSize: 12, marginTop: 2 },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: ui.cardAlt,
    borderRadius: 10,
    padding: 3,
  },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: ui.accent },
  tabText: { color: ui.textDim, fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  initError: { paddingHorizontal: 16, paddingBottom: 8 },
  body: { flex: 1 },
});
