import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { ConfiguracionScreenProps } from '../../navigation/types';

export default function AutorizacionCorreoScreen({
  navigation,
}: ConfiguracionScreenProps<'AutorizacionCorreo'>) {
  return (
    <ScreenPlaceholder
      testID="screen-autorizacion-correo"
      titulo="Autorización de Correo"
      tareaId="AN-09"
      responsable="Andrea Travola"
      descripcion="Conexión de bandeja de entrada para detección automática de comprobantes de pago."
    >
      <NavButton
        testID="go-back"
        title="Volver"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}
