import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PlanDisponible } from '@ojoalgasto/shared';
import { COLORES_PLANES as C } from './estilos';
import { FEATURES, formatearPrecio, incluyeFeature, NOMBRES_FEATURES } from './reglasPlanes';

export interface TarjetaPlanProps {
  plan: PlanDisponible;
  /** ¿Es el plan que la persona tiene hoy, según el servidor? */
  esActual: boolean;
}

/** Un plan con su precio y lo que incluye. Los botones los pone quien la usa. */
export function TarjetaPlan({ plan, esActual }: TarjetaPlanProps) {
  return (
    <View testID={`plan-${plan.codigo}`} style={[styles.tarjeta, esActual && styles.actual]}>
      <View style={styles.encabezado}>
        <Text style={styles.nombre} accessibilityRole="header">
          {plan.nombre}
        </Text>
        {esActual ? (
          <Text testID={`plan-actual-${plan.codigo}`} style={styles.etiqueta}>
            Tu plan actual
          </Text>
        ) : null}
      </View>

      <Text style={styles.precio}>
        {formatearPrecio(plan.precio, plan.moneda)} <Text style={styles.periodo}>/ mes</Text>
      </Text>
      {plan.precio_demo ? <Text style={styles.demo}>Precio de demostración: no se hace ningún cobro real.</Text> : null}

      {FEATURES.map((feature) => {
        const incluida = incluyeFeature(plan, feature);
        return (
          <Text key={feature} style={incluida ? styles.incluida : styles.noIncluida}>
            {/* El texto dice lo mismo que el símbolo: no se depende del color. */}
            {incluida ? '✓ Incluye' : '✗ No incluye'} {NOMBRES_FEATURES[feature].toLowerCase()}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: { padding: 16, gap: 6, borderRadius: 14, backgroundColor: C.superficie, borderWidth: 1, borderColor: C.borde },
  actual: { borderColor: C.acento },
  encabezado: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  nombre: { color: C.tinta, fontSize: 18, fontWeight: '700' },
  etiqueta: { color: C.acento, fontSize: 12, fontWeight: '700' },
  precio: { color: C.tinta, fontSize: 22, fontWeight: '700' },
  periodo: { color: C.tinta2, fontSize: 13, fontWeight: '400' },
  demo: { color: C.tinta2, fontSize: 12 },
  incluida: { color: C.tinta, fontSize: 14 },
  noIncluida: { color: C.tinta2, fontSize: 14 },
});
