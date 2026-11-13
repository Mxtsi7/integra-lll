import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useAuth } from '../../../context/AuthContext';
import { NavButton } from '../components/NavButton';
import { COLORES_VERIFICACION as C } from '../components/verificacionCorreo/estilos';
import { VerificarCorreoContenido } from '../components/verificacionCorreo/VerificarCorreoContenido';
import type { AuthScreenProps } from '../../navigation/types';

/** AN-12. La lógica está en `components/verificacionCorreo/`; esta pantalla solo la coloca. */
export default function VerificarCorreoScreen({ navigation, route }: AuthScreenProps<'VerificarCorreo'>) {
  const { haySesion, recargarPerfil } = useAuth();

  return (
    <ScrollView testID="screen-verificar-correo" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Verificar correo</Text>
      <VerificarCorreoContenido
        token={route.params?.token}
        haySesion={haySesion}
        onIrALogin={() => navigation.navigate('Login')}
        // Con sesión, el estado del correo se vuelve a pedir al servidor en vez de suponerlo.
        onVerificado={haySesion ? () => void recargarPerfil() : undefined}
      />
      <NavButton testID="go-login" title="Ir a Iniciar Sesión" variant="secondary" onPress={() => navigation.navigate('Login')} />
      <NavButton testID="go-back" title="Volver" variant="secondary" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, backgroundColor: C.fondo, gap: 16 },
  titulo: { fontSize: 26, fontWeight: 'bold', color: C.tinta },
});
