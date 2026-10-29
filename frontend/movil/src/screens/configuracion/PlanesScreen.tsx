import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { ConfiguracionScreenProps } from '../../navigation/types';

export default function PlanesScreen({ navigation }: ConfiguracionScreenProps<'Planes'>) {
  return (
    <ScreenPlaceholder
      testID="screen-planes"
      titulo="Planes y Suscripción Premium"
      tareaId="AN-08"
      responsable="Andrea Travola"
      descripcion="Comparativa de planes Gratuito vs Premium y contratación."
    >
      <NavButton
        testID="go-back"
        title="Volver"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}
