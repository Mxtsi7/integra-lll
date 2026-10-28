import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { ConfiguracionScreenProps } from '../../navigation/types';

export default function EliminarCuentaScreen({
  navigation,
}: ConfiguracionScreenProps<'EliminarCuenta'>) {
  return (
    <ScreenPlaceholder
      testID="screen-eliminar-cuenta"
      titulo="Eliminar Cuenta"
      tareaId="AN-19"
      responsable="Andrea Travola"
      descripcion="Flujo de confirmación y borrado definitivo de cuenta y datos personales."
    >
      <NavButton
        testID="go-back"
        title="Cancelar y Volver"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}
