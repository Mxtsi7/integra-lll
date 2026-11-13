import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { NavButton } from '../components/NavButton';
import { COLORES_PLANES as C } from '../components/planes/estilos';
import { RestriccionesPremiumContenido } from '../components/planes/RestriccionesPremiumContenido';
import type { ConfiguracionScreenProps } from '../../navigation/types';

/** AN-11. La lógica está en `components/planes/`; esta pantalla solo la coloca. */
export default function RestriccionesPremiumScreen({ navigation }: ConfiguracionScreenProps<'RestriccionesPremium'>) {
  return (
    <ScrollView testID="screen-restricciones-premium" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Restricciones Premium</Text>
      <RestriccionesPremiumContenido onVerPlanes={() => navigation.navigate('Planes')} />
      <NavButton testID="go-back" title="Volver" variant="secondary" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
