import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { AuthScreenProps } from '../../navigation/types';

export default function RegistroScreen({ navigation }: AuthScreenProps<'Registro'>) {
  return (
    <ScreenPlaceholder
      testID="screen-registro"
      titulo="Registro de Cuenta"
      tareaId="SE-11"
      responsable="Sebastian Mena"
      descripcion="Formulario móvil para registro de nuevos usuarios."
    >
      <NavButton
        testID="go-login"
        title="Ya tengo cuenta (Iniciar sesión)"
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
