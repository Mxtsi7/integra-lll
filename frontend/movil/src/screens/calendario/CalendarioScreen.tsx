import React from 'react';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import type { CalendarioScreenProps } from '../../navigation/types';

export default function CalendarioScreen({}: CalendarioScreenProps<'CalendarioScreen'>) {
  return (
    <ScreenPlaceholder
      testID="screen-calendario"
      titulo="Calendario y Agenda"
      tareaId="AN-07"
      responsable="Andrea Travola"
      descripcion="Vista de calendario con fechas de cobro, renovaciones y recordatorios."
    />
  );
}
