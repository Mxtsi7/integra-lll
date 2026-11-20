import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { COLORES_RESUMEN as C } from '../components/resumen/estilos';
import { ResumenPeriodoContenido } from '../components/resumen/ResumenPeriodoContenido';
import { NavButton } from '../components/NavButton';
import type { PanelScreenProps } from '../../navigation/types';

/** AN-01. La lógica está en `components/resumen/`; esta pantalla solo la coloca y enlaza a las otras. */
export default function PanelScreen({ navigation }: PanelScreenProps<'PanelScreen'>) {
  // Se arma una sola vez para que el contenido no se vuelva a suscribir en cada render.
  const alVolverAPantalla = useMemo(() => (aviso: () => void) => navigation.addListener('focus', aviso), [navigation]);

  return (
    <ScrollView testID="screen-panel" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Resumen de Gasto</Text>
      <ResumenPeriodoContenido variante="panel" alVolverAPantalla={alVolverAPantalla} />
      <NavButton testID="go-informes" title="Ver Informes por Periodo" onPress={() => navigation.navigate('Informes')} />
      <NavButton
        testID="go-recomendaciones"
        title="Ver Recomendaciones y Optimización"
        variant="secondary"
        onPress={() => navigation.navigate('Recomendaciones')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
