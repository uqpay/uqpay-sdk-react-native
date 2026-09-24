/**
 * Webhooks — the server's view of the same payment.
 *
 * This screen exists to make AC RN-CB5 concrete. Run a 3DS payment on the
 * Home tab, switch here, and watch the outcome arrive at the merchant backend
 * independently of whatever the sheet told the app. THAT is what you fulfil an
 * order from.
 *
 * The 3 s poll is against the **merchant backend**, not UQPAY. The wrapper
 * itself polls nothing (AC RN-FLOW4); this is ordinary merchant-app code.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fetchRecentWebhooks, type RecentWebhooks } from '../backend';
import { backendUrl } from '../config';
import { describeThrown, fireAndForget, prettyJson } from '../errors';
import { ui } from '../theme';
import {
  Badge,
  Banner,
  Button,
  KeyValue,
  Mono,
  Section,
} from '../components/ui';

const POLL_INTERVAL_MS = 3_000;

export function WebhooksScreen() {
  const [data, setData] = useState<RecentWebhooks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await fetchRecentWebhooks());
      setError(null);
    } catch (err) {
      setError(describeThrown(err).developerMessage);
    }
  }, []);

  useEffect(() => {
    fireAndForget(load());
    if (!polling) return;
    const id = setInterval(() => fireAndForget(load()), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load, polling]);

  const events = data?.events ?? [];

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => fireAndForget(load())}
          tintColor={ui.textDim}
        />
      }
    >
      <Section
        title="Webhook inbox"
        subtitle={`Polling ${backendUrl}/webhooks/recent every ${POLL_INTERVAL_MS / 1000} s.`}
      >
        <Banner
          tone="warning"
          title="THIS IS THE SOURCE OF TRUTH"
          body="The client result is a UX signal. The payment outcome your business acts on is the one that lands here, on your server. Fulfil orders from this, never from the sheet's return value."
        />
        <View style={styles.row}>
          <Badge
            label={`${events.length} STORED`}
            tone={events.length > 0 ? 'success' : 'neutral'}
          />
          {data === null ? null : (
            <Badge label={`CAP ${data.capacity}`} tone="neutral" />
          )}
          <Badge
            label={polling ? 'POLLING' : 'PAUSED'}
            tone={polling ? 'info' : 'neutral'}
          />
        </View>
        <Button
          title={polling ? 'Pause polling' : 'Resume polling'}
          tone="secondary"
          onPress={() => setPolling((p) => !p)}
        />
        {data?.signatureVerified === false ? (
          <Banner
            tone="danger"
            title="NO SIGNATURE VERIFICATION"
            body="This demo accepts any POST to /webhooks/uqpay. A production merchant MUST verify the signature before trusting a payload — otherwise anyone who finds your URL can mark orders paid."
          />
        ) : null}
        {error === null ? null : (
          <Banner
            tone="danger"
            title="BACKEND UNREACHABLE"
            body={`${error}\n\nStart it with:  node example/backend/server.mjs`}
          />
        )}
      </Section>

      {events.length === 0 && error === null ? (
        <Section
          title="Nothing yet"
          subtitle="Webhooks appear here as UQPAY delivers them."
        >
          <Text style={styles.dim}>
            UQPAY must be able to reach your backend. On a laptop that means a
            tunnel (ngrok / Cloudflare Tunnel) pointed at {backendUrl}, with the
            public URL registered as your webhook endpoint and set as
            UQPAY_WEBHOOK_URL in example/.env.
          </Text>
          <Text style={styles.dim}>
            To prove the screen works without a tunnel, POST one yourself:
          </Text>
          <Mono>
            {`curl -X POST ${backendUrl}/webhooks/uqpay \\\n  -H 'content-type: application/json' \\\n  -d '{"type":"payment_intent.succeeded","data":{"payment_intent_id":"pi_demo","status":"SUCCEEDED"}}'`}
          </Mono>
        </Section>
      ) : null}

      {events.map((event, index) => {
        const key = `${event.receivedAt}-${index}`;
        const isOpen = expanded === key;
        return (
          <Section key={key} title={event.eventType ?? '(no event type)'}>
            <KeyValue label="receivedAt" value={event.receivedAt} />
            <KeyValue
              label="paymentIntentId"
              value={event.paymentIntentId ?? '—'}
            />
            <KeyValue
              label="status"
              value={event.status ?? '—'}
              tone={event.status === 'SUCCEEDED' ? 'success' : 'neutral'}
            />
            <Button
              title={isOpen ? 'Hide raw payload' : 'Show raw payload'}
              tone="secondary"
              onPress={() => setExpanded(isOpen ? null : key)}
            />
            {isOpen ? <Mono>{prettyJson(event.payload)}</Mono> : null}
          </Section>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 48 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  dim: { color: ui.textDim, fontSize: 12, lineHeight: 18 },
});
