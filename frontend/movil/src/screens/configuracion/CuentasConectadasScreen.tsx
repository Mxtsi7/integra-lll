import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { NavButton } from '../components/NavButton';
import { CuentasContenido } from '../components/cuentas/CuentasContenido';
import { COLORES_CUENTAS as C } from '../components/cuentas/estilos';
import type { ConfiguracionScreenProps } from '../../navigation/types';

/** AN-06. La lógica está en `components/cuentas/`; esta pantalla solo la coloca. */
export default function CuentasConectadasScreen({ navigation }: ConfiguracionScreenProps<'CuentasConectadas'>) {
  // Al volver del navegador (o de la pantalla de autorización) se vuelve a pedir la lista.
  const alVolverAPantalla = useCallback(
    (recargar: () => void) => navigation.addListener('focus', recargar),
    [navigation],
  );

  return (
    <ScrollView testID="screen-cuentas" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Cuentas conectadas</Text>
      <CuentasContenido
        onConectar={() => navigation.navigate('AutorizacionCorreo')}
        alVolverAPantalla={alVolverAPantalla}
      />
      <NavButton testID="go-back" title="Volver" variant="secondary" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
