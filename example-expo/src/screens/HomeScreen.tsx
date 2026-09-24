/**
 * Home — the whole checkout loop in one screen.
 *
 * Order of operations, which is also the order a merchant implements it in:
 *
 *   1. YOUR SERVER creates the intent (it needs the API key; the app must not
 *      have one).                                        → AC RN-SEC3, RN-DOC3
 *   2. The app presents the sheet for that intent id.     → AC §2.1
 *   3. The native SDK does the payment: card form, 3DS, QR, polling. The
 *      wrapper adds none of that and polls nothing.       → AC RN-FLOW4
 *   4. The resolved result is a **UX signal**. Fulfilment is driven by the
 *      webhook your server receives.                      → AC RN-CB5
 *   5. A `pending` result is not a failure: persist the id, `reconcile()`.
 *                                                         → AC RN-CB7
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';

import {
  presentPaymentSheet,
  cancelPaymentSheet,
  getPendingResult,
  addPaymentListener,
} from '../uqpay';
import type {
  PaymentEvent,
  PaymentMethodType,
  PresentOptions,
  UqpayPaymentResult,
} from '../uqpay';
import {
  backendUrl,
  backendUrlConfigured,
  backendUrlRewritten,
  clientId,
  environment,
  isConfigured,
  isProduction,
  RETURN_URL,
} from '../config';
import {
  createPaymentIntent,
  fetchHealth,
  retrievePaymentIntent,
  type HealthResponse,
} from '../backend';
import {
  describeThrown,
  fireAndForget,
  prettyJson,
  type DisplayError,
} from '../errors';
import { getLastStartedPayment, rememberStartedPayment } from '../lastPayment';
import { THEME_LABELS, THEME_ORDER, ui, type ThemeName } from '../theme';
import {
  Badge,
  Banner,
  Button,
  Field,
  KeyValue,
  Mono,
  SegmentedControl,
  Section,
} from '../components/ui';
import { ResultCard } from '../components/ResultCard';

type PresentationMode = 'methodList' | 'cardOnly' | 'singleWallet';

const PRESENTATION_LABELS: Record<PresentationMode, string> = {
  methodList: 'Method list',
  cardOnly: 'Card only',
  singleWallet: 'Single wallet',
};

type HealthState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'ok'; health: HealthResponse }
  | { phase: 'error'; message: string };

export function HomeScreen({
  theme,
  onChangeTheme,
  themeBusy,
}: {
  theme: ThemeName;
  onChangeTheme: (next: ThemeName) => void;
  themeBusy: boolean;
}) {
  const [amount, setAmount] = useState('8.98');
  const [currency, setCurrency] = useState('SGD');
  const [description, setDescription] = useState('RN sample order');
  const [presentation, setPresentation] =
    useState<PresentationMode>('methodList');
  const [wallet, setWallet] = useState('grabpay');

  const [health, setHealth] = useState<HealthState>({ phase: 'idle' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UqpayPaymentResult | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Keeps `setTimeout` cancellable across unmount (sample app only). */
  const cancelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------- events
  // Both idioms are equivalent (AC RN-API8): the promise below resolves the
  // outcome, and this subscription sees `paymentReconciled` (both platforms)
  // and `requiresAction` (iOS only — Android's callback is result-only).
  useEffect(() => {
    const subscription = addPaymentListener((event: PaymentEvent) => {
      const stamp = new Date().toISOString().slice(11, 19);
      if (event.type === 'paymentReconciled') {
        setEvents((prev) =>
          [
            `${stamp}  paymentReconciled → ${event.result.kind} (${event.result.paymentIntentId})`,
            ...prev,
          ].slice(0, 20)
        );
        // A late outcome for the payment on screen replaces it.
        setResult((current) =>
          current !== null &&
          current.paymentIntentId === event.result.paymentIntentId
            ? event.result
            : current
        );
      } else {
        setEvents((prev) =>
          [
            `${stamp}  requiresAction → ${event.action.type} (iOS only)`,
            ...prev,
          ].slice(0, 20)
        );
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(
    () => () => {
      if (cancelTimer.current !== null) clearTimeout(cancelTimer.current);
    },
    []
  );

  // ---------------------------------------------------------------- health
  const checkHealth = useCallback(async () => {
    setHealth({ phase: 'checking' });
    try {
      setHealth({ phase: 'ok', health: await fetchHealth() });
    } catch (err) {
      setHealth({
        phase: 'error',
        message: describeThrown(err).developerMessage,
      });
    }
  }, []);

  useEffect(() => {
    fireAndForget(checkHealth());
  }, [checkHealth]);

  // ------------------------------------------------------------- checkout
  const presentOptions = useMemo((): Omit<
    PresentOptions,
    'paymentIntentId'
  > => {
    const base = { returnUrl: RETURN_URL };
    if (presentation === 'methodList')
      return { ...base, presentation: 'methodList' };
    if (presentation === 'cardOnly')
      return { ...base, presentation: 'cardOnly' };
    return {
      ...base,
      presentation: { singleWallet: wallet.trim() as PaymentMethodType },
    };
  }, [presentation, wallet]);

  const payNow = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setServerStatus(null);
    setNotice(null);
    try {
      // Step 1 — YOUR SERVER. This call needs the API key, so it cannot
      // happen in the app. The backend holds the key; the app never sees it.
      const intent = await createPaymentIntent({
        amount: amount.trim(),
        currency: currency.trim().toUpperCase(),
        description: description.trim(),
        returnUrl: RETURN_URL,
      });
      if (intent.paymentIntentId === null) {
        throw new Error('the backend did not return a payment_intent_id');
      }
      rememberStartedPayment({
        paymentIntentId: intent.paymentIntentId,
        amount: amount.trim(),
        currency: currency.trim().toUpperCase(),
        startedAt: new Date().toISOString(),
      });

      // Step 2 — the sheet. Expected outcomes RESOLVE (AC RN-API5): a decline,
      // a cancel, a timeout and a pending result all arrive here, not in
      // `catch`. Only programmer error rejects.
      setResult(
        await presentPaymentSheet({
          paymentIntentId: intent.paymentIntentId,
          ...presentOptions,
        })
      );
    } catch (err) {
      setError(describeThrown(err));
    } finally {
      setBusy(false);
    }
  }, [amount, currency, description, presentOptions]);

  const reconcile = useCallback(async () => {
    if (result === null || result.kind !== 'pending') return;
    setBusy(true);
    setNotice(null);
    try {
      setResult(await result.reconcile());
    } catch (err) {
      setError(describeThrown(err));
    } finally {
      setBusy(false);
    }
  }, [result]);

  /**
   * Recovers a result that arrived while JS was not listening — a Metro
   * reload mid-flow, or an Android process death during 3DS. The native side
   * buffers it; this hands it over exactly once (AC RN-CB6, RN-API9).
   */
  const recoverPending = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const recovered = await getPendingResult();
      if (recovered === null) {
        setNotice(
          'No buffered result. That is the normal answer when nothing was interrupted.'
        );
      } else {
        setResult(recovered);
        setNotice(
          'Recovered a buffered result. getPendingResult() clears it — a second call returns null.'
        );
      }
    } catch (err) {
      setError(describeThrown(err));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Presents, then dismisses the sheet from our own code after 3 s (RN-UX6). */
  const cancelAfterDelay = useCallback(() => {
    if (cancelTimer.current !== null) clearTimeout(cancelTimer.current);
    setNotice(
      'Sheet will be cancelled in 3 s — expect canceled / merchant_cancelled.'
    );
    cancelTimer.current = setTimeout(() => {
      fireAndForget(
        cancelPaymentSheet().catch((err: unknown) =>
          setError(describeThrown(err))
        )
      );
    }, 3_000);
    fireAndForget(payNow());
  }, [payNow]);

  /** The merchant-side truth for the intent on screen (AC RN-CB5). */
  const checkServerStatus = useCallback(async () => {
    const id =
      result?.paymentIntentId ?? getLastStartedPayment()?.paymentIntentId;
    if (id === undefined || id === null) {
      setNotice('No payment yet — create one first.');
      return;
    }
    setBusy(true);
    try {
      const intent = await retrievePaymentIntent(id);
      setServerStatus(
        `${intent.status ?? 'unknown'}  (${intent.amount ?? '-'} ${intent.currency ?? ''})`
      );
    } catch (err) {
      setError(describeThrown(err));
    } finally {
      setBusy(false);
    }
  }, [result]);

  const lastStarted = getLastStartedPayment();
  const wirePreview = JSON.stringify({
    amount: amount.trim(),
    currency: currency.trim().toUpperCase(),
  });

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      {isProduction ? (
        <Banner
          tone="danger"
          title="PRODUCTION"
          body="This build points at the production UQPAY host. Payments here move real money."
        />
      ) : null}

      {!isConfigured ? (
        <Banner
          tone="warning"
          title="NOT CONFIGURED"
          body={
            'Copy example-expo/.env.template to example-expo/.env and fill it in, ' +
            'then run: node example-expo/scripts/gen-env.mjs  (and restart Metro with ' +
            '--reset-cache).'
          }
        />
      ) : null}

      <Section
        title="Environment"
        subtitle="Read from example-expo/.env via example-expo/scripts/gen-env.mjs."
      >
        <View style={styles.row}>
          <Badge
            label={environment.toUpperCase()}
            tone={isProduction ? 'danger' : 'info'}
          />
        </View>
        <KeyValue
          label="clientId"
          value={isConfigured ? `${clientId.slice(0, 4)}****` : '<unset>'}
        />
        <KeyValue label="returnUrl" value={RETURN_URL} />
        <KeyValue label="backend" value={backendUrl} />
        {backendUrlRewritten ? (
          <Banner
            tone="info"
            title="ANDROID EMULATOR"
            body={`${backendUrlConfigured} was rewritten to ${backendUrl}. An emulator's "localhost" is the emulator; 10.0.2.2 is your Mac. On the iOS simulator localhost works as-is.`}
          />
        ) : null}
      </Section>

      <Section
        title="Merchant backend"
        subtitle="GET /health — the reference backend in example/backend/."
      >
        {health.phase === 'ok' ? (
          <>
            <Badge
              label={health.health.ok ? 'BACKEND OK' : 'BACKEND NOT CONFIGURED'}
              tone={health.health.ok ? 'success' : 'warning'}
            />
            <KeyValue label="environment" value={health.health.environment} />
            <KeyValue
              label="clientIdMasked"
              value={health.health.clientIdMasked}
            />
            <KeyValue
              label="tokenCached"
              value={String(health.health.tokenCached)}
            />
            {health.health.message === undefined ? null : (
              <Banner
                tone="warning"
                title="BACKEND SAYS"
                body={health.health.message}
              />
            )}
          </>
        ) : health.phase === 'error' ? (
          <Banner
            tone="danger"
            title="BACKEND UNREACHABLE"
            body={`${health.message}\n\nStart it with:  node example/backend/server.mjs`}
          />
        ) : (
          <Text style={styles.dim}>Checking…</Text>
        )}
        <Button
          title="Re-check health"
          tone="secondary"
          onPress={() => fireAndForget(checkHealth())}
        />
      </Section>

      <Section
        title="Order"
        subtitle="Amounts are STRINGS in major units, end to end. No parseFloat, no ×100, ever."
      >
        <Field
          label="Amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          hint='"8.98" means 8 dollars 98 cents — not 898.'
        />
        <Field
          label="Currency"
          value={currency}
          onChangeText={setCurrency}
          autoCapitalize="characters"
          hint="ISO 4217."
        />
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          hint="Max 32 characters — the gateway rejects 33 with a bare invalid_parameter."
        />
        <View style={styles.previewBox}>
          <Text style={styles.previewLabel}>ON THE WIRE</Text>
          <Mono>{wirePreview}</Mono>
        </View>
      </Section>

      <Section title="Presentation" subtitle="How the native sheet opens.">
        <SegmentedControl
          options={['methodList', 'cardOnly', 'singleWallet'] as const}
          value={presentation}
          onChange={setPresentation}
          labels={PRESENTATION_LABELS}
        />
        {presentation === 'singleWallet' ? (
          <Field
            label="Wallet method type"
            value={wallet}
            onChangeText={setWallet}
            hint="Wire method type, e.g. grabpay. Sandbox QR wallets settle on REAL rails — do not scan casually."
          />
        ) : null}
      </Section>

      <Section
        title="Checkout"
        subtitle="Create the intent on the server, then present the sheet."
      >
        <Button
          title="Create intent & pay"
          onPress={() => fireAndForget(payNow())}
          busy={busy}
        />
        <Button
          title="Cancel sheet after 3 s"
          tone="secondary"
          onPress={cancelAfterDelay}
          disabled={busy}
        />
        <Button
          title="Recover last result (getPendingResult)"
          tone="secondary"
          onPress={() => fireAndForget(recoverPending())}
          disabled={busy}
        />
        {notice === null ? null : (
          <Banner tone="info" title="NOTE" body={notice} />
        )}
      </Section>

      {error === null ? null : (
        <Section
          title="Rejected"
          subtitle="presentPaymentSheet only rejects for programmer error."
        >
          <Banner
            tone="danger"
            title="SHOWN TO THE USER"
            body={error.userMessage}
          />
          <KeyValue label="code" value={error.code} tone="danger" />
          <KeyValue label="source" value={error.source} />
          <KeyValue label="developerMessage" value={error.developerMessage} />
        </Section>
      )}

      {result === null ? null : (
        <Section
          title="Result"
          subtitle="Rendered with an exhaustive switch (result.kind)."
        >
          <Banner
            tone="warning"
            title="A UX SIGNAL, NOT PROOF OF PAYMENT"
            body="Never ship goods on this alone. Your server decides, from the webhook it receives or a server-side status read. The Webhooks tab shows the same payment arriving server-side."
          />
          <ResultCard result={result} />
          {result.kind === 'pending' ? (
            <Button
              title="Pending → reconcile()"
              onPress={() => fireAndForget(reconcile())}
              busy={busy}
            />
          ) : null}
          <Button
            title="Check server-side status"
            tone="secondary"
            onPress={() => fireAndForget(checkServerStatus())}
            disabled={busy}
          />
          {serverStatus === null ? null : (
            <KeyValue label="server says" value={serverStatus} tone="info" />
          )}
        </Section>
      )}

      <Section
        title="Last started payment"
        subtitle="Held in a module variable — lost on a cold start, which is the lesson."
      >
        {lastStarted === null ? (
          <Text style={styles.dim}>Nothing yet.</Text>
        ) : (
          <>
            <KeyValue
              label="paymentIntentId"
              value={lastStarted.paymentIntentId}
            />
            <KeyValue
              label="amount"
              value={`${lastStarted.amount} ${lastStarted.currency}`}
            />
            <KeyValue label="startedAt" value={lastStarted.startedAt} />
          </>
        )}
        <Banner
          tone="info"
          title="IN A REAL APP"
          body="Persist paymentIntentId durably (MMKV / AsyncStorage / your own server) the moment you create the intent. After a process death mid-3DS it is the only handle you have left."
        />
      </Section>

      <Section
        title="Events"
        subtitle="addPaymentListener — paymentReconciled (both platforms), requiresAction (iOS only)."
      >
        {events.length === 0 ? (
          <Text style={styles.dim}>No events yet.</Text>
        ) : (
          events.map((line) => <Mono key={line}>{line}</Mono>)
        )}
      </Section>

      <Section
        title="Theming"
        subtitle="appearance is an init-time option — changing it re-calls init()."
      >
        <SegmentedControl
          options={THEME_ORDER}
          value={theme}
          onChange={onChangeTheme}
          labels={THEME_LABELS}
        />
        {themeBusy ? <Text style={styles.dim}>Re-initialising…</Text> : null}
        <Banner
          tone="info"
          title="RE-INIT SIDE EFFECT"
          body="Android binds appearance to UQPayConfiguration at init, so a theme change means init() again. A re-init with a DIFFERENT config rebuilds the native token cache, so the next present calls your tokenProvider again. An identical config is a no-op."
        />
      </Section>

      <Section
        title="Debug"
        subtitle="Developer-only. None of this belongs in front of a customer."
      >
        <Mono>
          {prettyJson({
            environment,
            backendUrl,
            returnUrl: RETURN_URL,
            presentation: presentOptions.presentation,
          })}
        </Mono>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 48 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dim: { color: ui.textDim, fontSize: 12 },
  previewBox: {
    backgroundColor: ui.bg,
    borderRadius: 8,
    padding: 10,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ui.border,
  },
  previewLabel: {
    color: ui.textDim,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
});
