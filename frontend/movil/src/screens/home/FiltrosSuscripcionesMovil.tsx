import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { esFechaReal, type EstadoSuscripcion } from '@ojoalgasto/shared';
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

export interface FiltrosSuscripcionesMovilProps {
  filtroEstado: FiltroEstado;
  filtroFecha: string;
  onCambiarEstado: (estado: FiltroEstado) => void;
  onCambiarFecha: (fecha: string) => void;
  onLimpiarFiltros: () => void;
  hayFiltrosActivos: boolean;
  totalResultados?: number;
}

/**
 * Describe de forma legible los criterios activos para el usuario y accesibilidad.
 */
export function describirCriterioActivo(
  filtroEstado: FiltroEstado,
  filtroFecha: string,
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

  if (partes.length === 0) return '';
  return `Filtro activo: ${partes.join(' · ')}`;
}

/**
 * Barra de controles de filtrado accesible para móvil (SE-27).
 * Permite filtrar por estado y fecha exacta de cobro en servidor,
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
}: FiltrosSuscripcionesMovilProps) {
  const criterioTexto = describirCriterioActivo(filtroEstado, filtroFecha);

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
