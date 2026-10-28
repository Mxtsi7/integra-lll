import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { ConfiguracionScreenProps } from '../../navigation/types';

export default function CuentasConectadasScreen({
  navigation,
}: ConfiguracionScreenProps<'CuentasConectadas'>) {
  return (
    <ScreenPlaceholder
      testID="screen-cuentas"
      titulo="Cuentas Conectadas"
      tareaId="AN-06"
      responsable="Andrea Travola"
      descripcion="Gestión de integraciones y bancos conectados."
    >
      <NavButton
        testID="go-back"
        title="Volver"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}
