import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  Text,
  ViewStyle,
} from 'react-native';
import styles from './NavButton.styles';

export interface NavButtonProps {
  testID?: string;
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function NavButton({
  testID,
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: NavButtonProps) {
  const isBloqueado = Boolean(disabled || loading);

  return (
    <Pressable
      testID={testID}
      disabled={isBloqueado}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        disabled: isBloqueado,
        busy: Boolean(loading),
      }}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && !isBloqueado && styles.pressed,
        isBloqueado && styles.disabled,
        style,
      ]}
      onPress={() => {
        if (!isBloqueado) {
          onPress();
        }
      }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'secondary' ? '#0f172a' : '#ffffff'}
        />
      ) : (
        <Text style={[styles.text, variant === 'secondary' && styles.secondaryText]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

