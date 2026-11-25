import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { COLORES_ALERTAS as C } from '../components/alertas/estilos';
import { CentroAlertas } from '../components/alertas/CentroAlertas';
import { NavButton } from '../components/NavButton';
import type { ConfiguracionScreenProps } from '../../navigation/types';

/** AN-10 y AN-24. La lógica está en `components/alertas/`; esta pantalla solo la coloca. */
export default function AlertasScreen({ navigation }: ConfiguracionScreenProps<'Alertas'>) {
  // Se arma una sola vez para que el contenido no se vuelva a suscribir en cada render.
  const alVolverAPantalla = useMemo(() => (aviso: () => void) => navigation.addListener('focus', aviso), [navigation]);

  return (
    <ScrollView testID="screen-alertas" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Centro de Alertas</Text>
      <CentroAlertas alVolverAPantalla={alVolverAPantalla} />
      <NavButton testID="go-back" title="Volver" variant="secondary" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
