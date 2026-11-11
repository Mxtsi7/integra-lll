import React from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  costoPorHora,
  equivalenteMensual,
  formatearFecha,
  formatearHoras,
  formatearMonto,
  type EstadoSuscripcion,
  type Frecuencia,
  type Suscripcion,
} from '@ojoalgasto/shared';
import { styles } from './TarjetaSuscripcion.styles';

export interface TarjetaSuscripcionProps {
  suscripcion: Suscripcion;
  onPress: (suscripcion: Suscripcion) => void;
  testID?: string;
}

/**
 * Estados del dominio mapeados a texto explícito y contraste visual accesible (WCAG).
 * El estado nunca se comunica solo mediante color.
 */
export const ESTADOS_SUSCRIPCION: Record<
  EstadoSuscripcion,
  { etiqueta: string; fondo: string; texto: string }
> = {
  activo: { etiqueta: 'Activa', fondo: '#064e3b', texto: '#34d399' },
  prueba: { etiqueta: 'Prueba gratis', fondo: '#451a03', texto: '#fbbf24' },
  por_confirmar: { etiqueta: 'Por confirmar', fondo: '#27272a', texto: '#e4e4e7' },
  fantasma: { etiqueta: 'Sin uso', fondo: '#312e81', texto: '#a5b4fc' },
  cancelado: { etiqueta: 'Cancelada', fondo: '#450a0a', texto: '#f87171' },
};

/** Formatea el sufijo de frecuencia según el estándar del producto. */
export function sufijoFrecuencia(frecuencia: Frecuencia): string {
  return frecuencia === 'anual' ? '/año' : '/mes';
}

/**
 * Deriva el texto descriptivo del próximo cobro o estado de cobros:
 * - Cancelada: "Sin cobros pendientes"
 * - Prueba con fin_prueba: "Prueba termina: <fecha>"
 * - Activa / otros: "Próximo cobro: <fecha>"
 */
export function formatearTextoCobro(suscripcion: Suscripcion): string {
  if (suscripcion.estado === 'cancelado') {
    return 'Sin cobros pendientes';
  }
  if (suscripcion.estado === 'prueba' && suscripcion.fin_prueba) {
    return `Prueba termina: ${formatearFecha(suscripcion.fin_prueba)}`;
  }
  return `Próximo cobro: ${formatearFecha(suscripcion.fecha_proximo_cobro)}`;
}

export function TarjetaSuscripcion({
  suscripcion,
  onPress,
  testID,
}: TarjetaSuscripcionProps) {
  const {
    id,
    nombre,
    monto,
    moneda,
    frecuencia,
    categoria,
    estado,
    horas_uso_mes,
  } = suscripcion;

  const infoEstado = ESTADOS_SUSCRIPCION[estado] ?? {
    etiqueta: estado,
    fondo: '#334155',
    texto: '#ffffff',
  };

  const inicial = (nombre.trim()[0] ?? '?').toUpperCase();
  const montoFormateado = formatearMonto(monto, moneda);
  const textoCobro = formatearTextoCobro(suscripcion);

  // Tratamiento explícito de valor opcional: horas_uso_mes
  const montoMensual = equivalenteMensual(monto, frecuencia);
  const valorPorHora =
    horas_uso_mes !== undefined && horas_uso_mes > 0
      ? costoPorHora(montoMensual, horas_uso_mes)
      : null;

  const targetTestId = testID ?? `card-suscripcion-${id}`;

  const etiquetaAccesible = `Suscripción ${nombre}, estado: ${infoEstado.etiqueta}, monto: ${montoFormateado} ${frecuencia}, ${textoCobro}${
    valorPorHora !== null ? `, costo por hora: ${formatearMonto(valorPorHora, moneda)}` : ''
  }`;

  return (
    <Pressable
      testID={targetTestId}
      style={styles.tarjeta}
      onPress={() => onPress(suscripcion)}
      accessibilityRole="button"
      accessibilityLabel={etiquetaAccesible}
      accessibilityHint="Toca para ver los detalles de esta suscripción"
    >
      {/* Fila superior: Identificador (Nombre + Categoría) y Badge de Estado */}
      <View style={styles.headerFila}>
        <View style={styles.identificador}>
          <View style={styles.avatar} aria-hidden={true}>
            <Text style={styles.avatarTexto}>{inicial}</Text>
          </View>
          <View style={styles.infoColumna}>
            <Text
              style={styles.nombreTexto}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {nombre}
            </Text>
            <Text
              style={styles.categoriaTexto}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {categoria || 'General'}
            </Text>
          </View>
        </View>

        <View
          style={[styles.badge, { backgroundColor: infoEstado.fondo }]}
          accessibilityRole="text"
        >
          <Text style={[styles.badgeTexto, { color: infoEstado.texto }]}>
            {infoEstado.etiqueta}
          </Text>
        </View>
      </View>

      {/* Fila inferior: Bloque de Monto y Bloque de Cobro/Uso */}
      <View style={styles.cuerpoFila}>
        <View style={styles.bloqueMonto}>
          <Text style={styles.montoTexto} numberOfLines={1}>
            {montoFormateado}
          </Text>
          <Text style={styles.frecuenciaTexto}>
            {sufijoFrecuencia(frecuencia)}
          </Text>
        </View>

        <View style={styles.bloqueDetalle}>
          <Text
            style={[
              styles.cobroTexto,
              estado === 'prueba' && styles.cobroAlerta,
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {textoCobro}
          </Text>
          {valorPorHora !== null ? (
            <Text
              style={styles.usoTexto}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {formatearMonto(valorPorHora, moneda)}/h ({formatearHoras(horas_uso_mes ?? 0)})
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default TarjetaSuscripcion;
