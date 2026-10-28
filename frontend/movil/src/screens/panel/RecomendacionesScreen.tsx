import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { PanelScreenProps } from '../../navigation/types';

export default function RecomendacionesScreen({
  navigation,
}: PanelScreenProps<'Recomendaciones'>) {
  return (
    <ScreenPlaceholder
      testID="screen-recomendaciones"
      titulo="Recomendaciones"
      tareaId="AN-05"
      responsable="Andrea Travola"
      descripcion="Sugerencias de ahorro, suscripciones infrautilizadas y alternativas más baratas."
    >
      <NavButton
        testID="go-back"
        title="Volver al Panel"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}
