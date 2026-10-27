import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { HomeScreenProps } from '../../navigation/types';

export default function SuscripcionNuevaScreen({
  navigation,
}: HomeScreenProps<'SuscripcionNueva'>) {
  return (
    <ScreenPlaceholder
      testID="screen-suscripcion-nueva"
      titulo="Nueva Suscripción"
      tareaId="SE-22"
      responsable="Sebastian Mena"
      descripcion="Formulario móvil para dar de alta una nueva suscripción."
    >
      <NavButton
        testID="go-back"
        title="Cancelar y Volver"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}
