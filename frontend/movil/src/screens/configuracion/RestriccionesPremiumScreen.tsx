import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { ConfiguracionScreenProps } from '../../navigation/types';

export default function RestriccionesPremiumScreen({
  navigation,
}: ConfiguracionScreenProps<'RestriccionesPremium'>) {
  return (
    <ScreenPlaceholder
      testID="screen-restricciones-premium"
      titulo="Restricciones Premium"
      tareaId="AN-11"
      responsable="Andrea Travola"
      descripcion="Aviso de características bloqueadas y llamada a contratar el plan Premium."
    >
      <NavButton
        testID="go-back"
        title="Volver"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}
