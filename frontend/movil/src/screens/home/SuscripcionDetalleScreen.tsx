import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { HomeScreenProps } from '../../navigation/types';

export default function SuscripcionDetalleScreen({
  navigation,
  route,
}: HomeScreenProps<'SuscripcionDetalle'>) {
  const { id } = route.params;

  return (
    <ScreenPlaceholder
      testID="screen-suscripcion-detalle"
      titulo="Detalle de Suscripción"
      tareaId="SE-21"
      responsable="Sebastian Mena"
      descripcion="Vista detallada de una suscripción seleccionada con historial de cobros y uso."
    >
      <Text style={styles.idText}>ID Suscripción: {id}</Text>

      <NavButton
        testID="go-back"
        title="Volver a la lista"
        variant="secondary"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}

const styles = StyleSheet.create({
  idText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0284c7',
    marginBottom: 16,
    textAlign: 'center',
  },
});

