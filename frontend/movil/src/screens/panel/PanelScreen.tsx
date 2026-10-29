import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { PanelScreenProps } from '../../navigation/types';

export default function PanelScreen({ navigation }: PanelScreenProps<'PanelScreen'>) {
  return (
    <ScreenPlaceholder
      testID="screen-panel"
      titulo="Resumen de Gasto (Panel)"
      tareaId="AN-01"
      responsable="Andrea Travola"
      descripcion="Panel general con métricas de gasto mensual, suscripciones activas y alertas."
    >
      <NavButton
        testID="go-informes"
        title="Ver Informes por Periodo"
        onPress={() => navigation.navigate('Informes')}
      />
      <NavButton
        testID="go-recomendaciones"
        title="Ver Recomendaciones y Optimización"
        variant="secondary"
        onPress={() => navigation.navigate('Recomendaciones')}
      />
    </ScreenPlaceholder>
  );
}
