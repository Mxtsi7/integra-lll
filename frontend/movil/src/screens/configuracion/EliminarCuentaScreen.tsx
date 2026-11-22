import React from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { useAuth } from '../../../context/AuthContext';
import { EliminarCuentaContenido } from '../components/eliminarCuenta/EliminarCuentaContenido';
import { COLORES_ELIMINAR_CUENTA as C } from '../components/eliminarCuenta/estilos';
import { MENSAJE_CUENTA_ELIMINADA, MENSAJE_ELIMINACION_PENDIENTE } from '../components/eliminarCuenta/reglasEliminacion';
import type { ConfiguracionScreenProps } from '../../navigation/types';

/** AN-19. La lógica está en `components/eliminarCuenta/`; esta pantalla solo la coloca. */
export default function EliminarCuentaScreen({ navigation }: ConfiguracionScreenProps<'EliminarCuenta'>) {
  const { cerrarSesion } = useAuth();

  return (
    <ScrollView testID="screen-eliminar-cuenta" contentContainerStyle={styles.contenedor} keyboardShouldPersistTaps="handled">
      <Text style={styles.titulo}>Eliminar cuenta</Text>
      <EliminarCuentaContenido
        onCancelar={() => navigation.goBack()}
        onEliminada={(resultado) => {
          // El backend ya revocó las sesiones. cerrarSesion borra los tokens del teléfono y la app vuelve al login.
          void cerrarSesion();
          Alert.alert('Cuenta', resultado.estado === 'pendiente' ? MENSAJE_ELIMINACION_PENDIENTE : MENSAJE_CUENTA_ELIMINADA);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
