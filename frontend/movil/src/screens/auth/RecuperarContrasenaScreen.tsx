import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { AuthScreenProps } from '../../navigation/types';

export default function RecuperarContrasenaScreen({
  navigation,
}: AuthScreenProps<'RecuperarContrasena'>) {
  return (
    <ScreenPlaceholder
      testID="screen-recuperar-contrasena"
      titulo="Recuperar Contraseña"
      tareaId="SE-14"
      responsable="Sebastian Mena"
      descripcion="Permite solicitar el enlace de restablecimiento de contraseña vía correo."
    >
      <NavButton
        testID="go-login"
        title="Volver a Iniciar Sesión"
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
