import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { COLORES_RESUMEN as C } from '../components/resumen/estilos';
import { BotonCompartirResumen } from '../components/resumen/BotonCompartirResumen';
import { ResumenPeriodoContenido } from '../components/resumen/ResumenPeriodoContenido';
import { NavButton } from '../components/NavButton';
import type { PanelScreenProps } from '../../navigation/types';

/**
 * AN-23. Usa el mismo contenido y la misma llamada que el Panel (AN-01), en su versión de informe.
 * AN-26: bajo el informe va el botón de compartir, con el resumen del periodo que se está viendo.
 */
export default function InformesScreen({ navigation }: PanelScreenProps<'Informes'>) {
  const alVolverAPantalla = useMemo(() => (aviso: () => void) => navigation.addListener('focus', aviso), [navigation]);

  return (
    <ScrollView testID="screen-informes" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Informes por Periodo</Text>
      <ResumenPeriodoContenido
        variante="informe"
        alVolverAPantalla={alVolverAPantalla}
        renderAcciones={(resumen) => <BotonCompartirResumen resumen={resumen} />}
      />
      <NavButton testID="go-back" title="Volver al Panel" variant="secondary" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
