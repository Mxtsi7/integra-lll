import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

export function NavButton({
  testID,
  title,
  onPress,
  variant = 'primary',
}: {
  testID?: string;
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <Pressable
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.text, variant === 'secondary' && styles.secondaryText]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#0f172a',
  },
  secondary: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  danger: {
    backgroundColor: '#ef4444',
  },
  pressed: {
    opacity: 0.8,
  },
  text: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryText: {
    color: '#1e293b',
  },
});
