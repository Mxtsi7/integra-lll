import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { NavButton } from '../components/NavButton';
import { RecomendacionesContenido } from '../components/recomendaciones/RecomendacionesContenido';
import { COLORES_RECOMENDACIONES as C } from '../components/recomendaciones/estilos';
import type { PanelScreenProps } from '../../navigation/types';

/** AN-05, AN-21 y AN-25. La lógica está en `components/recomendaciones/`; esta pantalla solo la coloca. */
export default function RecomendacionesScreen({ navigation }: PanelScreenProps<'Recomendaciones'>) {
  return (
    <ScrollView testID="screen-recomendaciones" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Recomendaciones</Text>
      <RecomendacionesContenido onVerPlanes={() => navigation.navigate('ConfiguracionTab', { screen: 'Planes' })} />
      <NavButton testID="go-back" title="Volver al Panel" variant="secondary" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
