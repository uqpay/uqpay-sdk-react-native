/**
 * Renders `UqpayPaymentResult` **exhaustively**.
 *
 * The `switch (result.kind)` below is the point of AC RN-API2: the union is
 * discriminated, the four variants are frozen for 1.x, and under `strict` the
 * `assertNever` default arm stops compiling the day someone adds a fifth. Copy
 * this shape into your own app — the compiler then tells you when a new field
 * lands instead of a customer telling you.
 */

import { View, Text, StyleSheet } from 'react-native';

import type { UqpayPaymentResult, UqpayError } from '../uqpay';
import { isUnknownErrorCode } from '../uqpay';
import { Badge, KeyValue, Banner } from './ui';
import { ui } from '../theme';

function assertNever(value: never): never {
  throw new Error(`unhandled result kind: ${JSON.stringify(value)}`);
}

function ErrorDetail({ error, title }: { error: UqpayError; title: string }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {/* What the customer sees. */}
      <Banner
        tone="danger"
        title="SHOWN TO THE USER"
        body={error.userMessage}
      />
      {/* Developer-only from here down. */}
      <KeyValue label="code" value={error.code} tone="danger" />
      <KeyValue
        label="isUnknownErrorCode"
        value={String(isUnknownErrorCode(error.code))}
        tone={isUnknownErrorCode(error.code) ? 'warning' : 'neutral'}
      />
      <KeyValue label="isRetryable" value={String(error.isRetryable)} />
      <KeyValue
        label="isOutcomeUnknown"
        value={String(error.isOutcomeUnknown)}
        tone={error.isOutcomeUnknown ? 'warning' : 'neutral'}
      />
      <KeyValue label="platform" value={error.platform} />
      {error.declineCode === undefined ? null : (
        <KeyValue label="declineCode" value={error.declineCode} />
      )}
      {error.httpStatus === undefined ? null : (
        <KeyValue label="httpStatus" value={String(error.httpStatus)} />
      )}
      {error.traceId === undefined ? null : (
        <KeyValue label="traceId" value={error.traceId} />
      )}
      <KeyValue label="developerMessage" value={error.developerMessage} />
      {error.isOutcomeUnknown ? (
        <Banner
          tone="warning"
          title="OUTCOME UNKNOWN"
          body="The money may or may not have moved. Do NOT retry blindly and do NOT tell the customer it failed — resolve it from your server (webhook or a status read) before deciding."
        />
      ) : null}
    </View>
  );
}

export function ResultCard({ result }: { result: UqpayPaymentResult }) {
  switch (result.kind) {
    case 'completed':
      return (
        <View style={styles.card}>
          <Badge label="COMPLETED" tone="success" />
          <KeyValue label="paymentIntentId" value={result.paymentIntentId} />
          <KeyValue
            label="status"
            value={result.status}
            tone={result.status === 'REQUIRES_CAPTURE' ? 'warning' : 'success'}
          />
          {result.amount === undefined ? null : (
            <KeyValue label="amount" value={result.amount} />
          )}
          {result.currency === undefined ? null : (
            <KeyValue label="currency" value={result.currency} />
          )}
          {result.paymentMethodType === undefined ? null : (
            <KeyValue
              label="paymentMethodType"
              value={result.paymentMethodType}
            />
          )}
          {result.transactionId === undefined ? null : (
            <KeyValue label="transactionId" value={result.transactionId} />
          )}
          {result.merchantOrderId === undefined ? null : (
            <KeyValue label="merchantOrderId" value={result.merchantOrderId} />
          )}
          {result.completedAt === undefined ? null : (
            <KeyValue label="completedAt" value={result.completedAt} />
          )}
          {result.status === 'REQUIRES_CAPTURE' ? (
            <Banner
              tone="warning"
              title="REQUIRES_CAPTURE IS SUCCESS"
              body="The payment is authorised, not captured. Capture it server-side. Treat this as a successful authorisation, never as a failure."
            />
          ) : null}
        </View>
      );

    case 'failed':
      return (
        <View style={styles.card}>
          <Badge label="FAILED" tone="danger" />
          <KeyValue label="paymentIntentId" value={result.paymentIntentId} />
          <ErrorDetail error={result.error} title="error" />
        </View>
      );

    case 'canceled':
      return (
        <View style={styles.card}>
          <Badge label="CANCELED" tone="neutral" />
          <KeyValue label="paymentIntentId" value={result.paymentIntentId} />
          <KeyValue label="reason" value={result.reason} />
          <Banner
            tone="neutral"
            title="NOT AN ERROR"
            body={
              result.reason === 'intent_cancelled'
                ? 'The intent itself was cancelled server-side — a fresh intent is needed. This is not a decline.'
                : 'The customer (or your own cancelPaymentSheet call) closed the sheet before paying. Offer the sheet again with the SAME intent id.'
            }
          />
        </View>
      );

    case 'pending':
      return (
        <View style={styles.card}>
          <Badge label="PENDING" tone="pending" />
          <KeyValue label="paymentIntentId" value={result.paymentIntentId} />
          {result.lastKnownStatus === undefined ? null : (
            <KeyValue
              label="lastKnownStatus"
              value={result.lastKnownStatus}
              tone="pending"
            />
          )}
          {result.cause === undefined ? null : (
            <ErrorDetail error={result.cause} title="cause" />
          )}
          <Banner
            tone="pending"
            title="PENDING IS FINAL FOR THE PROMISE"
            body="The sheet is done; the payment is not. It may still succeed. Persist paymentIntentId, show the customer a 'we're confirming' state, and resolve it from your server — or call reconcile() below."
          />
        </View>
      );

    default:
      return assertNever(result);
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: ui.cardAlt,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ui.border,
  },
  group: {
    gap: 8,
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: ui.border,
  },
  groupTitle: {
    color: ui.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
});
