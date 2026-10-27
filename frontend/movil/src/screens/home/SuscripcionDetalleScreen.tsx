import React, { useState } from 'react';
import { Text, StyleSheet, View, Pressable } from 'react-native';
import { costoPorHora, formatearMonto } from '@ojoalgasto/shared';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import type { HomeScreenProps } from '../../navigation/types';

export default function SuscripcionDetalleScreen({
  navigation,
  route,
}: HomeScreenProps<'SuscripcionDetalle'>) {
  const { id } = route.params;

  // Demostración reactiva de la función costoPorHora importada desde @ojoalgasto/shared
  const montoMensual = 9900;
  const [horasUso, setHorasUso] = useState(2);

  const costoHora = costoPorHora(montoMensual, horasUso);

  return (
    <ScreenPlaceholder
      testID="screen-suscripcion-detalle"
      titulo="Detalle de Suscripción"
      tareaId="SE-21"
      responsable="Sebastian Mena"
      descripcion="Vista detallada de una suscripción seleccionada con historial de cobros y uso."
    >
      <Text style={styles.idText}>ID Suscripción: {id}</Text>

      {/* Tarjeta de cálculo en vivo consumiendo @ojoalgasto/shared */}
      <View style={styles.cardCalculo} testID="card-costo-por-hora">
        <Text style={styles.cardHeader}>Métrica compartida (@ojoalgasto/shared)</Text>
        <Text style={styles.subtituloCalculo}>Cálculo en vivo de Costo por Hora:</Text>

        <View style={styles.filaDato}>
          <Text style={styles.label}>Monto mensual:</Text>
          <Text style={styles.valor}>{formatearMonto(montoMensual)}</Text>
        </View>

        <View style={styles.filaDato}>
          <Text style={styles.label}>Horas de uso al mes:</Text>
          <View style={styles.selectorHoras}>
            <Pressable
              testID="btn-restar-hora"
              style={styles.btnControl}
              onPress={() => setHorasUso((h) => Math.max(0, h - 1))}
            >
              <Text style={styles.btnControlTexto}>-</Text>
            </Pressable>
            <Text style={styles.horasTexto}>{horasUso} hrs</Text>
            <Pressable
              testID="btn-sumar-hora"
              style={styles.btnControl}
              onPress={() => setHorasUso((h) => h + 1)}
            >
              <Text style={styles.btnControlTexto}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.resultadoContainer}>
          <Text style={styles.resultadoLabel}>Costo por hora resultante:</Text>
          <Text style={styles.resultadoValor} testID="resultado-costo-hora">
            {costoHora !== null ? `${formatearMonto(costoHora)} / hr` : 'Sin uso registrado (null)'}
          </Text>
        </View>
      </View>

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
    marginBottom: 8,
    textAlign: 'center',
  },
  cardCalculo: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
    width: '100%',
  },
  cardHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6366f1',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  subtituloCalculo: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 12,
  },
  filaDato: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  label: {
    fontSize: 14,
    color: '#334155',
  },
  valor: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  selectorHoras: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btnControl: {
    backgroundColor: '#f1f5f9',
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnControlTexto: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  horasTexto: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    minWidth: 44,
    textAlign: 'center',
  },
  resultadoContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    alignItems: 'center',
  },
  resultadoLabel: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
  },
  resultadoValor: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
});
