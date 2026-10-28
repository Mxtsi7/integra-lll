import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { PanelScreenProps } from '../../navigation/types';

export default function InformesScreen({ navigation }: PanelScreenProps<'Informes'>) {
  return (
    <ScreenPlaceholder
      testID="screen-informes"
      titulo="Informes por Periodo"
      tareaId="AN-23"
      responsable="Andrea Travola"
      descripcion="Gráficos y reportes de gasto histórico por mes, trimestre y año."
    >
      <NavButton
        testID="go-back"
        title="Volver al Panel"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}
