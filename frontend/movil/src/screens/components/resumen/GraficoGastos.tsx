import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { GastoPorMoneda } from '@ojoalgasto/shared';
import { COLORES_RESUMEN as C } from './estilos';
import { datosDelGrafico } from './reglasGrafico';

/**
 * Barra de gasto de una moneda: lo gastado y lo que falta por cobrar (AN-02).
 *
 * Se entiende sin color y sin ver el gráfico:
 * - Las dos partes se distinguen por relleno (sólido / solo borde), no solo por color.
 * - La leyenda dice el nombre y el porcentaje de cada parte.
 * - El lector de pantalla lee UNA descripción con importes y porcentajes (los mismos de la tarjeta).
 */
export function GraficoGastos({ gasto }: { gasto: GastoPorMoneda }) {
  const grafico = datosDelGrafico(gasto);
  if (!grafico) return null; // sin gasto no hay gráfico: queda el texto

  const [gastado, porCobrar] = grafico.partes;
  return (
    <View testID={`grafico-${gasto.moneda}`} style={styles.contenedor} accessible accessibilityRole="image" accessibilityLabel={grafico.descripcion}>
      <View style={styles.barra}>
        {gastado.porcentaje > 0 ? <View style={[styles.parteGastado, { flex: gastado.porcentaje }]} /> : null}
        {porCobrar.porcentaje > 0 ? <View style={[styles.partePorCobrar, { flex: porCobrar.porcentaje }]} /> : null}
      </View>
      <View style={styles.leyenda}>
        <Text style={styles.textoLeyenda}>{`● Gastado ${gastado.porcentaje}%`}</Text>
        <Text style={styles.textoLeyenda}>{`○ Por cobrar ${porCobrar.porcentaje}%`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 6, paddingVertical: 4 },
  barra: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', borderWidth: 1, borderColor: C.acento },
  parteGastado: { backgroundColor: C.acento },
  partePorCobrar: { backgroundColor: 'transparent' },
  leyenda: { flexDirection: 'row', justifyContent: 'space-between' },
  textoLeyenda: { color: C.tinta2, fontSize: 12 },
});
