/**
 * Small presentational pieces shared by the two screens. Plain React Native —
 * the sample app deliberately adds no UI or navigation dependency, so that
 * `yarn install` in `example/` stays a single `react-native` tree.
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ui } from '../theme';

export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle === undefined ? null : (
        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      )}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export type BadgeTone =
  'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'pending';

const TONE_COLORS: Record<BadgeTone, string> = {
  neutral: ui.textDim,
  success: ui.success,
  warning: ui.warning,
  danger: ui.danger,
  info: ui.accent,
  pending: ui.pending,
};

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: BadgeTone;
}) {
  const color = TONE_COLORS[tone];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function KeyValue({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: BadgeTone;
}) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{label}</Text>
      <Text
        style={[
          styles.kvValue,
          tone === undefined ? null : { color: TONE_COLORS[tone] },
        ]}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  tone = 'primary',
  disabled = false,
  busy = false,
}: {
  title: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const background =
    tone === 'primary'
      ? ui.accent
      : tone === 'danger'
        ? ui.danger
        : 'transparent';
  const isDisabled = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          opacity: isDisabled ? 0.45 : pressed ? 0.75 : 1,
        },
        tone === 'secondary' ? styles.buttonOutline : null,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={ui.text} /> : null}
      <Text
        style={[
          styles.buttonText,
          tone === 'secondary' ? { color: ui.text } : null,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'none',
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
  autoCapitalize?: 'none' | 'characters';
  hint?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? ''}
        placeholderTextColor={ui.textDim}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
      />
      {hint === undefined ? null : <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labels?: Record<string, string>;
}) {
  return (
    <View style={styles.segment}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option)}
            style={[
              styles.segmentItem,
              active ? styles.segmentItemActive : null,
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                active ? styles.segmentTextActive : null,
              ]}
            >
              {labels?.[option] ?? option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Banner({
  tone,
  title,
  body,
}: {
  tone: BadgeTone;
  title: string;
  body: string;
}) {
  const color = TONE_COLORS[tone];
  return (
    <View style={[styles.banner, { borderLeftColor: color }]}>
      <Text style={[styles.bannerTitle, { color }]}>{title}</Text>
      <Text style={styles.bannerBody}>{body}</Text>
    </View>
  );
}

export function Mono({ children }: { children: string }) {
  return (
    <Text style={styles.mono} selectable>
      {children}
    </Text>
  );
}

export const styles = StyleSheet.create({
  section: {
    backgroundColor: ui.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ui.border,
    padding: 16,
    marginBottom: 14,
  },
  sectionTitle: { color: ui.text, fontSize: 16, fontWeight: '700' },
  sectionSubtitle: {
    color: ui.textDim,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
  sectionBody: { marginTop: 12, gap: 10 },

  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  kv: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  kvKey: { color: ui.textDim, fontSize: 12, width: 132 },
  kvValue: {
    color: ui.text,
    fontSize: 12,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  buttonOutline: { borderWidth: 1, borderColor: ui.border },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  field: { gap: 6 },
  fieldLabel: { color: ui.textDim, fontSize: 12, fontWeight: '600' },
  fieldHint: { color: ui.textDim, fontSize: 11 },
  input: {
    backgroundColor: ui.cardAlt,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ui.border,
    color: ui.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },

  segment: {
    flexDirection: 'row',
    backgroundColor: ui.cardAlt,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentItemActive: { backgroundColor: ui.accent },
  segmentText: { color: ui.textDim, fontSize: 12, fontWeight: '600' },
  segmentTextActive: { color: '#fff' },

  banner: {
    backgroundColor: ui.cardAlt,
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  bannerTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  bannerBody: { color: ui.text, fontSize: 12, lineHeight: 18 },

  mono: {
    color: ui.textDim,
    fontSize: 11,
    fontFamily: 'Courier',
    lineHeight: 16,
  },
});
