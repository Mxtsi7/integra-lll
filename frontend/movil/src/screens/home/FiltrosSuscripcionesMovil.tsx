import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  descomponerOrden,
  esFechaReal,
  ORDENES_SUSCRIPCIONES,
  ORDEN_PREDETERMINADO,
  type CampoOrdenSuscripciones,
  type DireccionOrden,
  type EstadoSuscripcion,
  type OrdenSuscripciones,
} from '@ojoalgasto/shared';
import { NavButton } from '../components/NavButton';

export type FiltroEstado = 'todas' | EstadoSuscripcion;

export const OPCIONES_FILTRO_ESTADO: { valor: FiltroEstado; etiqueta: string }[] = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'activo', etiqueta: 'Activas' },
  { valor: 'fantasma', etiqueta: 'Sin uso' },
  { valor: 'prueba', etiqueta: 'Pruebas' },
  { valor: 'por_confirmar', etiqueta: 'Por confirmar' },
  { valor: 'cancelado', etiqueta: 'Canceladas' },
];

export interface OpcionOrdenConfig {
  valor: OrdenSuscripciones;
  campo: CampoOrdenSuscripciones;
  direccion: DireccionOrden;
  etiqueta: string;
  etiquetaCorta: string;
}

const DESCRIPCIONES_ORDEN: Record<
  OrdenSuscripciones,
  { etiqueta: string; etiquetaCorta: string }
> = {
  fecha_proximo_cobro: {
    etiqueta: 'Próximo cobro: más cercano primero',
    etiquetaCorta: 'Cobro ↑ (más cercano)',
  },
  '-fecha_proximo_cobro': {
    etiqueta: 'Próximo cobro: más lejano primero',
    etiquetaCorta: 'Cobro ↓ (más lejano)',
  },
  nombre: {
    etiqueta: 'Nombre: de la A a la Z',
    etiquetaCorta: 'Nombre (A-Z)',
  },
  '-nombre': {
    etiqueta: 'Nombre: de la Z a la A',
    etiquetaCorta: 'Nombre (Z-A)',
  },
  monto: {
    etiqueta: 'Monto: de menor a mayor',
    etiquetaCorta: 'Monto (menor a mayor)',
  },
  '-monto': {
    etiqueta: 'Monto: de mayor a menor',
    etiquetaCorta: 'Monto (mayor a menor)',
  },
};

export const OPCIONES_ORDEN: OpcionOrdenConfig[] = ORDENES_SUSCRIPCIONES.map(
  (valor) => ({
    valor,
    ...descomponerOrden(valor),
    ...DESCRIPCIONES_ORDEN[valor],
  }),
);

export interface FiltrosSuscripcionesMovilProps {
  filtroEstado: FiltroEstado;
  filtroFecha: string;
  onCambiarEstado: (estado: FiltroEstado) => void;
  onCambiarFecha: (fecha: string) => void;
  onLimpiarFiltros: () => void;
  hayFiltrosActivos: boolean;
  totalResultados?: number;
  orden?: OrdenSuscripciones;
  onCambiarOrden?: (orden: OrdenSuscripciones) => void;
}

/**
 * Describe de forma legible los criterios activos para el usuario y accesibilidad (SE-27, SE-29).
 */
export function describirCriterioActivo(
  filtroEstado: FiltroEstado,
  filtroFecha: string,
  orden?: OrdenSuscripciones,
): string {
  const partes: string[] = [];

  if (filtroEstado !== 'todas') {
    const etiqueta =
      OPCIONES_FILTRO_ESTADO.find((o) => o.valor === filtroEstado)?.etiqueta ??
      filtroEstado;
    partes.push(`Estado: ${etiqueta}`);
  }

  if (filtroFecha.trim() && esFechaReal(filtroFecha.trim())) {
    partes.push(`Cobro: ${filtroFecha.trim()}`);
  }

  if (orden) {
    const opcionOrden = OPCIONES_ORDEN.find((o) => o.valor === orden);
    if (opcionOrden) {
      partes.push(`Orden: ${opcionOrden.etiqueta}`);
    }
  }

  if (partes.length === 0) return '';
  return `Filtro activo: ${partes.join(' · ')}`;
}

/**
 * Barra de controles de filtrado y ordenamiento accesible para móvil (SE-27, SE-29).
 * Permite filtrar por estado, fecha de cobro y ordenar por nombre/monto/próximo cobro en servidor,
 * mostrando el criterio activo y la acción para limpiar.
 */
export function FiltrosSuscripcionesMovil({
  filtroEstado,
  filtroFecha,
  onCambiarEstado,
  onCambiarFecha,
  onLimpiarFiltros,
  hayFiltrosActivos,
  totalResultados,
  orden,
  onCambiarOrden,
}: FiltrosSuscripcionesMovilProps) {
  const criterioTexto = describirCriterioActivo(filtroEstado, filtroFecha, orden);
  const opcionOrdenActiva = orden
    ? OPCIONES_ORDEN.find((o) => o.valor === orden)
    : undefined;

  return (
    <View style={styles.contenedor} testID="filtros-suscripciones">
      {/* Selector de Estado en Chips horizontales */}
      <View style={styles.seccionEstado}>
        <Text style={styles.etiquetaSeccion} accessibilityRole="header">
          Filtrar por estado
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollChips}
          accessibilityRole="radiogroup"
        >
          {OPCIONES_FILTRO_ESTADO.map((opcion) => {
            const seleccionada = filtroEstado === opcion.valor;
            return (
              <Pressable
                key={opcion.valor}
                testID={`filtro-estado-${opcion.valor}`}
                accessibilityRole="button"
                accessibilityLabel={`Filtrar por ${opcion.etiqueta}`}
                accessibilityState={{ selected: seleccionada }}
                style={[
                  styles.chip,
                  seleccionada ? styles.chipSeleccionado : styles.chipInactivo,
                ]}
                onPress={() => onCambiarEstado(opcion.valor)}
              >
                <Text
                  style={[
                    styles.chipTexto,
                    seleccionada
                      ? styles.chipTextoSeleccionado
                      : styles.chipTextoInactivo,
                  ]}
                >
                  {opcion.etiqueta}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Selector de Orden con chips horizontales e indicador de criterio activo (SE-29) */}
      <View style={styles.seccionOrden} testID="seccion-orden">
        <View style={styles.encabezadoOrdenFila}>
          <Text style={styles.etiquetaSeccion} accessibilityRole="header">
            Ordenar por
          </Text>
          <Text
            testID="indicador-orden-activo"
            style={styles.indicadorOrdenTexto}
            accessibilityRole="text"
          >
            {opcionOrdenActiva
              ? `Activo: ${opcionOrdenActiva.etiqueta}`
              : 'Predeterminado: Próximo cobro (más cercano)'}
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollChips}
          accessibilityRole="radiogroup"
          testID="orden-chips-scroll"
        >
          {OPCIONES_ORDEN.map((opcion) => {
            const seleccionada = orden === opcion.valor;
            return (
              <Pressable
                key={opcion.valor}
                testID={`orden-chip-${opcion.valor}`}
                accessibilityRole="button"
                accessibilityLabel={`Ordenar por ${opcion.etiqueta}${seleccionada ? ' (activo)' : ''}`}
                accessibilityState={{ selected: seleccionada }}
                aria-pressed={seleccionada}
                style={[
                  styles.chip,
                  seleccionada ? styles.chipSeleccionado : styles.chipInactivo,
                ]}
                onPress={() => onCambiarOrden?.(opcion.valor)}
              >
                <Text
                  style={[
                    styles.chipTexto,
                    seleccionada
                      ? styles.chipTextoSeleccionado
                      : styles.chipTextoInactivo,
                  ]}
                >
                  {opcion.etiquetaCorta}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Input de Fecha de Cobro */}
      <View style={styles.seccionFecha}>
        <Text style={styles.etiquetaSeccion}>Próximo cobro (AAAA-MM-DD)</Text>
        <View style={styles.filaFecha}>
          <TextInput
            testID="input-filtro-fecha"
            style={styles.inputFecha}
            placeholder="Ej: 2026-10-05"
            placeholderTextColor="#64748b"
            value={filtroFecha}
            onChangeText={onCambiarFecha}
            accessibilityLabel="Filtrar por fecha de próximo cobro"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {hayFiltrosActivos ? (
            <NavButton
              testID="btn-limpiar-filtros"
              title="Limpiar"
              variant="secondary"
              onPress={onLimpiarFiltros}
              style={styles.botonLimpiar}
            />
          ) : null}
        </View>
      </View>

      {/* Criterio activo descriptivo */}
      {criterioTexto ? (
        <View style={styles.criterioBarra}>
          <Text
            style={styles.criterioTexto}
            testID="criterio-filtro-activo"
            accessibilityRole="text"
          >
            {criterioTexto}
            {totalResultados !== undefined ? ` (${totalResultados})` : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  seccionEstado: {
    marginBottom: 10,
  },
  seccionOrden: {
    marginBottom: 10,
  },
  encabezadoOrdenFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    flexWrap: 'wrap',
    gap: 4,
  },
  indicadorOrdenTexto: {
    fontSize: 12,
    color: '#38bdf8',
    fontWeight: '500',
  },
  etiquetaSeccion: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scrollChips: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipSeleccionado: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  chipInactivo: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
  },
  chipTexto: {
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextoSeleccionado: {
    color: '#ffffff',
  },
  chipTextoInactivo: {
    color: '#94a3b8',
  },
  seccionFecha: {
    marginTop: 4,
  },
  filaFecha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputFecha: {
    flex: 1,
    height: 40,
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#ffffff',
  },
  botonLimpiar: {
    height: 40,
    paddingHorizontal: 12,
  },
  criterioBarra: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  criterioTexto: {
    fontSize: 12,
    color: '#38bdf8',
    fontWeight: '500',
  },
});
