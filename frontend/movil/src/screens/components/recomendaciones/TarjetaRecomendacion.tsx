import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Recomendacion } from '@ojoalgasto/shared';
import { NavButton } from '../NavButton';
import { COLORES_RECOMENDACIONES as C } from './estilos';
import { formatearAhorro } from './reglasRecomendaciones';
import type { EstadoDetalle } from './useRecomendaciones';

export interface TarjetaRecomendacionProps {
  recomendacion: Recomendacion;
  /** Sin valor, el detalle está cerrado. */
  detalle?: EstadoDetalle;
  estaDescartando: boolean;
  onVerDetalle: (id: string) => void;
  onOcultarDetalle: (id: string) => void;
  onDescartar: (id: string) => void;
}

/** Una recomendación: motivo, ahorro estimado, detalle desplegable y "No me interesa". */
export function TarjetaRecomendacion({
  recomendacion,
  detalle,
  estaDescartando,
  onVerDetalle,
  onOcultarDetalle,
  onDescartar,
}: TarjetaRecomendacionProps) {
  const { id } = recomendacion;
  const ahorro = formatearAhorro(recomendacion.ahorro_estimado, recomendacion.moneda);

  return (
    <View testID={`recomendacion-${id}`} style={styles.tarjeta}>
      <Text style={styles.nombre}>{recomendacion.nombre ?? 'Suscripción'}</Text>
      {recomendacion.categoria ? <Text style={styles.categoria}>{recomendacion.categoria}</Text> : null}
      {recomendacion.motivo ? <Text style={styles.motivo}>{recomendacion.motivo}</Text> : null}
      {ahorro ? (
        <Text testID={`ahorro-${id}`} style={styles.ahorro}>
          Ahorro estimado: {ahorro}
        </Text>
      ) : null}

      {detalle ? <Detalle id={id} detalle={detalle} onReintentar={onVerDetalle} /> : null}

      <NavButton
        testID={detalle ? `ocultar-detalle-${id}` : `ver-detalle-${id}`}
        title={detalle ? 'Ocultar detalle' : 'Ver detalle'}
        variant="secondary"
        onPress={() => (detalle ? onOcultarDetalle(id) : onVerDetalle(id))}
      />
      <NavButton
        testID={`descartar-${id}`}
        title="No me interesa"
        variant="secondary"
        loading={estaDescartando}
        onPress={() => onDescartar(id)}
      />
    </View>
  );
}

function Detalle({ id, detalle, onReintentar }: { id: string; detalle: EstadoDetalle; onReintentar: (id: string) => void }) {
  if (detalle.tipo === 'cargando') {
    return <Text style={styles.textoSecundario}>Cargando detalle…</Text>;
  }
  if (detalle.tipo === 'error') {
    return (
      <View style={styles.detalle}>
        <Text testID={`error-detalle-${id}`} style={styles.error}>
          No pudimos cargar el detalle.
        </Text>
        <NavButton testID={`reintentar-detalle-${id}`} title="Reintentar" variant="secondary" onPress={() => onReintentar(id)} />
      </View>
    );
  }

  const explicacion = detalle.datos;
  // Con datos insuficientes el backend explica por qué; no se inventa una cifra.
  if (explicacion.estado === 'datos_insuficientes') {
    return (
      <View testID={`detalle-${id}`} style={styles.detalle}>
        <Text style={styles.textoSecundario}>{explicacion.motivo ?? 'Aún no hay datos suficientes para explicar esta recomendación.'}</Text>
      </View>
    );
  }
  return (
    <View testID={`detalle-${id}`} style={styles.detalle}>
      <Text style={styles.motivo}>{explicacion.explicacion}</Text>
      {explicacion.base_calculo ? <Text style={styles.textoSecundario}>Cómo se calculó: {explicacion.base_calculo}</Text> : null}
      {explicacion.advertencia_uso ? <Text style={styles.textoSecundario}>{explicacion.advertencia_uso}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: { backgroundColor: C.superficie, borderRadius: 14, padding: 16, gap: 8, borderWidth: 1, borderColor: C.borde },
  nombre: { color: C.tinta, fontSize: 16, fontWeight: '700' },
  categoria: { color: C.tinta2, fontSize: 12 },
  motivo: { color: C.tinta, fontSize: 14 },
  ahorro: { color: C.acento, fontSize: 14, fontWeight: '700' },
  detalle: { gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: C.borde },
  textoSecundario: { color: C.tinta2, fontSize: 13 },
  error: { color: C.error, fontSize: 13 },
});
