import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { CalendarioContenido } from '../components/calendario/CalendarioContenido';
import { COLORES_CALENDARIO as C } from '../components/calendario/estilos';
import type { CalendarioScreenProps } from '../../navigation/types';

/** AN-07. La lógica está en `components/calendario/`; esta pantalla solo la coloca. */
export default function CalendarioScreen({}: CalendarioScreenProps<'CalendarioScreen'>) {
  return (
    <ScrollView testID="screen-calendario" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Calendario</Text>
      <CalendarioContenido />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
