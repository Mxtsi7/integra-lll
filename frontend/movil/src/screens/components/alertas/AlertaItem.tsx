import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatearFechaHora, type Alerta } from '@ojoalgasto/shared';
import { NavButton } from '../NavButton';
import { COLORES_ALERTAS as C } from './estilos';

interface AlertaItemProps {
  alerta: Alerta;
  estaMarcando: boolean;
  onMarcarLeida: () => void;
}

/** Una alerta. Si está pendiente lleva la etiqueta "Nueva" y el botón para marcarla leída. */
export function AlertaItem({ alerta, estaMarcando, onMarcarLeida }: AlertaItemProps) {
  return (
    <View testID={`alerta-${alerta.id}`} style={[styles.tarjeta, alerta.pendiente && styles.tarjetaNueva]}>
      <View style={styles.encabezado}>
        <Text style={styles.tipo}>{alerta.tipo_legible}</Text>
        {alerta.pendiente ? (
          <Text testID={`alerta-nueva-${alerta.id}`} style={styles.etiquetaNueva}>
            Nueva
          </Text>
        ) : null}
      </View>
      <Text style={styles.titulo}>{alerta.titulo}</Text>
      <Text style={styles.mensaje}>{alerta.mensaje}</Text>
      <Text style={styles.fecha}>{formatearFechaHora(alerta.creado_en)}</Text>
      {alerta.pendiente ? (
        <NavButton
          testID={`marcar-leida-${alerta.id}`}
          title="Marcar como leída"
          variant="secondary"
          loading={estaMarcando}
          onPress={onMarcarLeida}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: { backgroundColor: C.superficie, borderRadius: 14, padding: 16, gap: 4, borderWidth: 1, borderColor: C.borde },
  tarjetaNueva: { borderColor: C.acento },
  encabezado: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tipo: { color: C.tinta2, fontSize: 13 },
  etiquetaNueva: { color: C.acento, fontSize: 12, fontWeight: '700' },
  titulo: { color: C.tinta, fontSize: 16, fontWeight: '700' },
  mensaje: { color: C.tinta2, fontSize: 14 },
  fecha: { color: C.tinta2, fontSize: 12 },
});
