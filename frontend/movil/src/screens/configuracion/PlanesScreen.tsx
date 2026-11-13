import React, { useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, Text } from 'react-native';
import { NavButton } from '../components/NavButton';
import { COLORES_PLANES as C } from '../components/planes/estilos';
import { PlanesContenido } from '../components/planes/PlanesContenido';
import type { ConfiguracionScreenProps } from '../../navigation/types';

/** AN-08. La lógica está en `components/planes/`; esta pantalla solo la coloca. */
export default function PlanesScreen({ navigation }: ConfiguracionScreenProps<'Planes'>) {
  // Se arma una sola vez para que el contenido no se vuelva a suscribir en cada render.
  const alVolverAPantalla = useMemo(() => (aviso: () => void) => navigation.addListener('focus', aviso), [navigation]);

  return (
    <ScrollView testID="screen-planes" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Planes y Suscripción Premium</Text>
      <PlanesContenido abrirUrl={(url) => Linking.openURL(url)} alVolverAPantalla={alVolverAPantalla} />
      <NavButton testID="go-back" title="Volver" variant="secondary" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
