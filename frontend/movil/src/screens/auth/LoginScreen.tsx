import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import { useAuth } from '../../../context/AuthContext';
import type { AuthScreenProps } from '../../navigation/types';

export default function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const { iniciarSesion } = useAuth();

  const handleSimularLogin = () => {
    iniciarSesion({
      id: '1',
      nombre: 'Usuario Demo',
      correo: 'demo@ojoalgasto.cl',
      rol: 'titular',
      organizacion_id: 'org-demo',
      plan: 'gratuito',
    });
  };

  return (
    <ScreenPlaceholder
      testID="screen-login"
      titulo="Iniciar Sesión"
      tareaId="SE-09"
      responsable="Sebastian Mena"
      descripcion="Punto de entrada de autenticación móvil. Al autenticarse, el router conmuta a las pestañas privadas."
    >
      <NavButton
        testID="login-submit"
        title="Simular Iniciar Sesión"
        onPress={handleSimularLogin}
      />
      <NavButton
        testID="go-registro"
        title="Crear cuenta (Registro)"
        variant="secondary"
        onPress={() => navigation.navigate('Registro')}
      />
      <NavButton
        testID="go-recuperar"
        title="¿Olvidaste tu contraseña?"
        variant="secondary"
        onPress={() => navigation.navigate('RecuperarContrasena')}
      />
      <NavButton
        testID="go-verificar"
        title="Verificar correo"
        variant="secondary"
        onPress={() => navigation.navigate('VerificarCorreo')}
      />
    </ScreenPlaceholder>
  );
}
