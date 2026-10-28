import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { AuthScreenProps } from '../../navigation/types';

export default function VerificarCorreoScreen({
  navigation,
  route,
}: AuthScreenProps<'VerificarCorreo'>) {
  const token = route.params?.token;

  return (
    <ScreenPlaceholder
      testID="screen-verificar-correo"
      titulo="Verificar Correo"
      tareaId="AN-12"
      responsable="Andrea Travola"
      descripcion="Confirmación de verificación de correo electrónico desde la app móvil."
    >
      {token ? <Text style={styles.tokenText}>Token recibido: {token}</Text> : null}
      <NavButton
        testID="go-login"
        title="Ir a Iniciar Sesión"
        onPress={() => navigation.navigate('Login')}
      />
      <NavButton
        testID="go-back"
        title="Volver"
        variant="secondary"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}

const styles = StyleSheet.create({
  tokenText: {
    fontSize: 13,
    color: '#0284c7',
    marginBottom: 8,
    textAlign: 'center',
  },
});
