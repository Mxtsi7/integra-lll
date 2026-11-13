import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatearFecha, type CobroCalendario } from '@ojoalgasto/shared';
import { COLORES_CALENDARIO as C } from './estilos';
import { formatearImporte } from './reglasCalendario';

export interface ListaCobrosProps {
  cobros: CobroCalendario[];
  /** Mensaje cuando la lista no tiene cobros. */
  textoVacio: string;
  /** Si es true, cada cobro muestra su fecha (útil en la agenda de todo el mes). */
  mostrarFecha?: boolean;
}

/** Lista de cobros con importe y moneda. Los proyectados se marcan: todavía no ocurren. */
export function ListaCobros({ cobros, textoVacio, mostrarFecha = false }: ListaCobrosProps) {
  if (cobros.length === 0) return <Text style={styles.vacio}>{textoVacio}</Text>;

  return (
    <View style={styles.lista}>
      {cobros.map((cobro) => (
        <View key={cobro.id} testID={`cobro-${cobro.id}`} style={styles.fila}>
          <View style={styles.datos}>
            <Text style={styles.servicio}>{cobro.servicio}</Text>
            <Text style={styles.detalle}>
              {mostrarFecha ? `${formatearFecha(cobro.fecha)} · ` : ''}
              {cobro.tipo === 'proyectado' ? 'Proyectado' : 'Confirmado'}
            </Text>
          </View>
          <Text style={styles.importe}>{formatearImporte(cobro.importe, cobro.moneda)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  lista: { gap: 8 },
  fila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: C.superficie, borderWidth: 1, borderColor: C.borde },
  datos: { flexShrink: 1, gap: 2 },
  servicio: { color: C.tinta, fontSize: 15, fontWeight: '700' },
  detalle: { color: C.tinta2, fontSize: 12 },
  importe: { color: C.acento, fontSize: 15, fontWeight: '700' },
  vacio: { color: C.tinta2, fontSize: 14 },
});
