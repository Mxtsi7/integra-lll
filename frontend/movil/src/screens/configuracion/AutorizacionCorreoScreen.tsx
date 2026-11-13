import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { NavButton } from '../components/NavButton';
import { AutorizacionCorreoContenido } from '../components/cuentas/AutorizacionCorreoContenido';
import { COLORES_CUENTAS as C } from '../components/cuentas/estilos';
import type { ConfiguracionScreenProps } from '../../navigation/types';

/** AN-09. La lógica está en `components/cuentas/`; esta pantalla solo la coloca. */
export default function AutorizacionCorreoScreen({ navigation }: ConfiguracionScreenProps<'AutorizacionCorreo'>) {
  return (
    <ScrollView testID="screen-autorizacion-correo" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Autorización de correo</Text>
      <AutorizacionCorreoContenido onVerCuentas={() => navigation.navigate('CuentasConectadas')} />
      <NavButton testID="go-back" title="Volver" variant="secondary" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
