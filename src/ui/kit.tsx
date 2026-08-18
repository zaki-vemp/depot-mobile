/* Shared primitives. These stand in for the desktop stylesheet's component
   classes — `.btn`, `.tag`, `.field`, `.kv`, `.side-item`, `.progress`,
   `.row-card`, `.toggle-row` — so the two builds keep the same vocabulary. */

import React, {createContext, memo, useContext, useMemo} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {Icon, type IconName} from '../lib/icons';
import {dark, light, radius, type Theme} from '../theme';

/* ── theme plumbing ─────────────────────────────────────────── */

const ThemeContext = createContext<Theme>(light);

export function ThemeProvider({mode, children}: {mode: 'light' | 'dark'; children: React.ReactNode}) {
  const theme = mode === 'dark' ? dark : light;
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** Builds a StyleSheet once per theme instead of once per render. */
export function useThemed<T extends Record<string, ViewStyle | TextStyle>>(
  factory: (t: Theme) => T,
) {
  const theme = useTheme();
  // The factory is defined at module scope by every caller, so theme identity is
  // the only thing that can invalidate the sheet.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
}

export const MONO = Platform.select({android: 'monospace', default: 'Menlo'});

/* ── buttons ────────────────────────────────────────────────── */

export type BtnKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Btn = memo(function Btn({
  label,
  icon,
  kind = 'secondary',
  block,
  disabled,
  small,
  onPress,
  style,
}: {
  label?: string;
  icon?: IconName;
  kind?: BtnKind;
  block?: boolean;
  disabled?: boolean;
  small?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const s = btnStyles(t, kind, disabled);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? icon}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{color: t.divider, borderless: false}}
      style={({pressed}) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          minHeight: small ? 34 : 42,
          paddingHorizontal: label ? (small ? 12 : 16) : small ? 8 : 11,
          borderRadius: radius.md,
          backgroundColor: s.bg,
          borderWidth: s.border ? 1 : 0,
          borderColor: s.border,
          opacity: pressed ? 0.72 : disabled ? 0.42 : 1,
          alignSelf: block ? 'stretch' : 'auto',
        },
        style,
      ]}>
      {icon ? <Icon name={icon} size={small ? 15 : 17} color={s.fg} /> : null}
      {label ? (
        <Text style={{color: s.fg, fontWeight: '600', fontSize: small ? 13 : 14.5}}>{label}</Text>
      ) : null}
    </Pressable>
  );
});

function btnStyles(t: Theme, kind: BtnKind, disabled?: boolean) {
  switch (kind) {
    case 'primary':
      return {bg: t.accent, fg: t.onAccent, border: ''};
    case 'ghost':
      return {bg: 'transparent', fg: disabled ? t.neutral600 : t.text, border: ''};
    case 'danger':
      return {bg: 'transparent', fg: t.danger, border: t.divider};
    default:
      return {bg: t.raised, fg: t.text, border: t.divider};
  }
}

/** Square icon-only chrome button — the desktop `.btn-ghost.btn-icon`. */
export const IconBtn = memo(function IconBtn({
  icon,
  size = 19,
  on,
  disabled,
  label,
  onPress,
  color,
}: {
  icon: IconName;
  size?: number;
  on?: boolean;
  disabled?: boolean;
  label?: string;
  onPress?: () => void;
  color?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? icon}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({pressed}) => ({
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        backgroundColor: on ? t.accent100 : 'transparent',
        opacity: pressed ? 0.6 : disabled ? 0.35 : 1,
      })}>
      <Icon name={icon} size={size} color={color ?? (on ? t.accent : t.text)} />
    </Pressable>
  );
});

/* ── tags, headings, rows ───────────────────────────────────── */

export const Tag = memo(function Tag({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'accent' | 'accent2' | 'outline' | 'danger';
}) {
  const t = useTheme();
  const map = {
    neutral: {bg: t.neutral300, fg: t.neutral800, border: 'transparent'},
    accent: {bg: t.accent100, fg: t.accent700, border: 'transparent'},
    accent2: {bg: t.accent2_100, fg: t.accent2_700, border: 'transparent'},
    outline: {bg: 'transparent', fg: t.neutral700, border: t.divider},
    danger: {bg: 'transparent', fg: t.danger, border: t.divider},
  }[tone];
  return (
    <View
      style={{
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: map.bg,
        borderWidth: 1,
        borderColor: map.border,
      }}>
      <Text style={{color: map.fg, fontSize: 11.5, fontWeight: '600'}}>{label}</Text>
    </View>
  );
});

export function Heading({
  children,
  size = 20,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  size?: number;
  style?: StyleProp<TextStyle>;
  /** Headings that share a toolbar row need a limit, or the row grows. */
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{color: t.text, fontSize: size, fontWeight: '600', letterSpacing: -0.2}, style]}>
      {children}
    </Text>
  );
}

export function Muted({
  children,
  size = 13,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  size?: number;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{color: t.neutral700, fontSize: size}, style]}>
      {children}
    </Text>
  );
}

/** The inspector's `.kv` row: label left, value right, value wraps. */
export const KV = memo(function KV({k, v}: {k: string; v: string}) {
  const t = useTheme();
  return (
    <View style={{flexDirection: 'row', alignItems: 'flex-start', gap: 14}}>
      <Text style={{color: t.neutral700, fontSize: 12.5, width: 84}}>{k}</Text>
      <Text style={{color: t.text, fontSize: 12.5, flex: 1, textAlign: 'right'}} selectable>
        {v}
      </Text>
    </View>
  );
});

/* ── forms ──────────────────────────────────────────────────── */

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  autoFocus,
  onSubmitEditing,
  keyboardType,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  keyboardType?: 'default' | 'url';
}) {
  const t = useTheme();
  return (
    <View style={{gap: 5}}>
      {label ? <Text style={{color: t.neutral700, fontSize: 12}}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.neutral600}
        secureTextEntry={secure}
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
        keyboardType={keyboardType === 'url' ? 'url' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          minHeight: 42,
          paddingHorizontal: 13,
          paddingVertical: 9,
          fontSize: 14.5,
          color: t.text,
          backgroundColor: t.raised,
          borderWidth: 1,
          borderColor: t.divider,
          borderRadius: radius.md,
        }}
      />
    </View>
  );
}

export const Toggle = memo(function Toggle({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked: on}}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        backgroundColor: t.raised,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: t.divider,
      }}>
      <Text style={{color: t.text, fontSize: 14.5, flex: 1}}>{label}</Text>
      <View
        style={{
          width: 44,
          height: 26,
          borderRadius: radius.pill,
          padding: 3,
          backgroundColor: on ? t.accent : t.neutral400,
          alignItems: on ? 'flex-end' : 'flex-start',
        }}>
        <View style={{width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff'}} />
      </View>
    </Pressable>
  );
});

/* ── progress + cards ───────────────────────────────────────── */

export const Progress = memo(function Progress({
  percent,
  color,
}: {
  percent: number;
  color?: string;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        height: 6,
        borderRadius: radius.pill,
        backgroundColor: t.neutral300,
        overflow: 'hidden',
      }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: color ?? t.accent,
        }}
      />
    </View>
  );
});

/** The desktop `.row-card`: title row, meter, facts. */
export function RowCard({children}: {children: React.ReactNode}) {
  const t = useTheme();
  return (
    <View
      style={{
        gap: 10,
        padding: 14,
        borderRadius: radius.lg,
        backgroundColor: t.raised,
        borderWidth: 1,
        borderColor: t.divider,
      }}>
      {children}
    </View>
  );
}

export function Facts({items}: {items: string[]}) {
  const t = useTheme();
  return (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 12}}>
      {items.filter(Boolean).map((f, i) => (
        <Text key={i} style={{color: t.neutral700, fontSize: 12}}>
          {f}
        </Text>
      ))}
    </View>
  );
}

export function Notice({children}: {children: React.ReactNode}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 11,
        padding: 13,
        borderRadius: radius.md,
        backgroundColor: t.accent2_100,
        borderWidth: 1,
        borderColor: t.divider,
      }}>
      <Icon name="warn" size={18} color={t.accent2_700} />
      <Text style={{color: t.accent2_700, fontSize: 12.5, flex: 1, lineHeight: 18}}>{children}</Text>
    </View>
  );
}

export function Empty({children}: {children: React.ReactNode}) {
  const t = useTheme();
  return (
    <Text style={{color: t.neutral600, fontSize: 14, textAlign: 'center', paddingVertical: 36}}>
      {children}
    </Text>
  );
}

/* ── drawer pieces ──────────────────────────────────────────── */

export function SideGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{marginBottom: 18}}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingHorizontal: 12,
          marginBottom: 6,
        }}>
        <Text
          style={{
            color: t.neutral600,
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.7,
            textTransform: 'uppercase',
          }}>
          {label}
        </Text>
        {hint ? <Text style={{color: t.neutral600, fontSize: 11}}>{hint}</Text> : null}
      </View>
      <View style={{gap: 2}}>{children}</View>
    </View>
  );
}

export const SideItem = memo(function SideItem({
  icon,
  label,
  badge,
  tint,
  on,
  onPress,
}: {
  icon: IconName;
  label: string;
  badge?: string;
  tint?: string;
  on?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={{color: t.divider}}
      style={({pressed}) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginHorizontal: 6,
        borderRadius: radius.md,
        backgroundColor: on ? t.accent100 : pressed ? t.neutral200 : 'transparent',
      })}>
      <Icon name={icon} size={17} color={tint ?? (on ? t.accent : t.neutral700)} />
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          color: on ? t.accent : t.text,
          fontSize: 14.5,
          fontWeight: on ? '600' : '500',
        }}>
        {label}
      </Text>
      {badge ? <Tag label={badge} tone={on ? 'accent' : 'neutral'} /> : null}
    </Pressable>
  );
});

/* ── layout helpers ─────────────────────────────────────────── */

export function Divider() {
  const t = useTheme();
  return <View style={{height: StyleSheet.hairlineWidth, backgroundColor: t.divider}} />;
}

export function Stack({
  children,
  gap = 18,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{gap}, style]}>{children}</View>;
}

export function Page({children, footer}: {children: React.ReactNode; footer?: number}) {
  return (
    <ScrollView
      contentContainerStyle={{padding: 16, paddingBottom: (footer ?? 0) + 32, gap: 22}}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}
