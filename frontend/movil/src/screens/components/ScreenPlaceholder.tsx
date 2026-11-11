import React from 'react';
import { Text, View, ScrollView } from 'react-native';
import styles from './ScreenPlaceholder.styles';


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

