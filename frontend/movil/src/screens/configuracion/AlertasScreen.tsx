import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { ConfiguracionScreenProps } from '../../navigation/types';

export default function AlertasScreen({ navigation }: ConfiguracionScreenProps<'Alertas'>) {
  return (
    <ScreenPlaceholder
      testID="screen-alertas"
      titulo="Centro de Alertas"
      tareaId="AN-10"
      responsable="Andrea Travola"
      descripcion="Configuración de notificaciones push, avisos de cobro y límites de gasto."
    >
      <NavButton
        testID="go-back"
        title="Volver"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}
