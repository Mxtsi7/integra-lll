import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import { useAuth } from '../../../context/AuthContext';
import type { HomeScreenProps } from '../../navigation/types';

export default function HomeScreen({ navigation }: HomeScreenProps<'HomeScreen'>) {
  const { usuario, cerrarSesion } = useAuth();

  return (
    <ScreenPlaceholder
      testID="screen-home"
      titulo="Home de Suscripciones"
      tareaId="SE-17"
      responsable="Sebastian Mena"
      descripcion={`Pantalla principal con listado de suscripciones activas. Usuario: ${usuario?.nombre ?? 'Cargando...'}`}
    >
      <NavButton
        testID="go-detalle"
        title="Ver Detalle Suscripción #1"
        onPress={() => navigation.navigate('SuscripcionDetalle', { id: '1' })}
      />
      <NavButton
        testID="go-nueva-suscripcion"
        title="Crear Nueva Suscripción"
        variant="secondary"
        onPress={() => navigation.navigate('SuscripcionNueva')}
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
