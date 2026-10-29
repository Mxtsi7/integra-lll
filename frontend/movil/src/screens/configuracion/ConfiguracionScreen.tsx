import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import { useAuth } from '../../../context/AuthContext';
import type { ConfiguracionScreenProps } from '../../navigation/types';

export default function ConfiguracionScreen({
  navigation,
}: ConfiguracionScreenProps<'ConfiguracionScreen'>) {
  const { cerrarSesion } = useAuth();

  return (
    <ScreenPlaceholder
      testID="screen-configuracion"
      titulo="Configuración"
      tareaId="AN-04"
      responsable="Andrea Travola"
      descripcion="Ajustes generales, gestión de cuenta, planes y seguridad."
    >
      <NavButton
        testID="go-perfil"
        title="Mi Perfil"
        onPress={() => navigation.navigate('Perfil')}
      />
      <NavButton
        testID="go-cuentas"
        title="Cuentas Conectadas"
        variant="secondary"
        onPress={() => navigation.navigate('CuentasConectadas')}
      />
      <NavButton
        testID="go-planes"
        title="Planes y Suscripción Premium"
        variant="secondary"
        onPress={() => navigation.navigate('Planes')}
      />
      <NavButton
        testID="go-alertas"
        title="Centro de Alertas"
        variant="secondary"
        onPress={() => navigation.navigate('Alertas')}
      />
      <NavButton
        testID="go-autorizacion-correo"
        title="Autorización de Correo"
        variant="secondary"
        onPress={() => navigation.navigate('AutorizacionCorreo')}
      />
      <NavButton
        testID="go-restricciones"
        title="Restricciones Premium"
        variant="secondary"
        onPress={() => navigation.navigate('RestriccionesPremium')}
      />
      <NavButton
        testID="go-eliminar-cuenta"
        title="Eliminar Cuenta"
        variant="secondary"
        onPress={() => navigation.navigate('EliminarCuenta')}
      />
      <NavButton
        testID="logout"
        title="Cerrar Sesión"
        variant="danger"
        onPress={() => void cerrarSesion()}
      />
    </ScreenPlaceholder>
  );
}
