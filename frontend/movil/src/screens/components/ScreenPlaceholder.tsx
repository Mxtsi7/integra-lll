import React from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';

type ActionButtonProps = {
  children?: React.ReactNode;
};

export function ScreenPlaceholder({
  testID,
  titulo,
  tareaId,
  responsable,
  descripcion,
  children,
}: {
  testID: string;
  titulo: string;
  tareaId: string;
  responsable: string;
  descripcion?: string;
  children?: React.ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.container} testID={testID}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{tareaId} · {responsable}</Text>
      </View>
      <Text style={styles.titulo}>{titulo}</Text>
      {descripcion ? <Text style={styles.descripcion}>{descripcion}</Text> : null}
      <View style={styles.actions}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  badge: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  titulo: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 8,
    textAlign: 'center',
  },
  descripcion: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 24,
    maxWidth: 320,
  },
  actions: {
    width: '100%',
    maxWidth: 340,
    gap: 12,
  },
});
