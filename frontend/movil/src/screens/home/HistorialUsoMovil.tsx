import React from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  formatearDuracionMinutos,
  formatearFecha,
  type RegistroUso,
} from '@ojoalgasto/shared';
import { styles } from './HistorialUsoMovil.styles';

export type EstadoHistorialUso =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje?: string }
  | { tipo: 'listo'; usos: RegistroUso[] };

export interface HistorialUsoMovilProps {
  estado: EstadoHistorialUso;
  onReintentar: () => void;
}

/**
 * Componente presentacional del historial de uso móvil (SE-30 / CH-15).
 * Muestra los registros ordenados cronológicamente del más reciente al más antiguo,
 * tal cual los entrega el backend, con soporte para estados vacío, carga y error.
 */
export function HistorialUsoMovil({
  estado,
  onReintentar,
}: HistorialUsoMovilProps) {
  return (
    <View style={styles.contenedor} testID="historial-uso-movil">
      <Text style={styles.tituloHistorial} accessibilityRole="header">
        Historial de uso
      </Text>

      {estado.tipo === 'cargando' && (
        <View
          style={styles.cajaEstado}
          testID="historial-cargando"
          accessibilityRole="progressbar"
        >
          <Text style={styles.textoCargando}>Cargando historial de uso...</Text>
        </View>
      )}

      {estado.tipo === 'error' && (
        <View
          style={styles.cajaError}
          testID="historial-error"
          accessibilityRole="alert"
        >
          <Text style={styles.textoError}>
            {estado.mensaje ?? 'No pudimos cargar el historial de uso.'}
          </Text>
          <Pressable
            testID="btn-reintentar-historial"
            accessibilityRole="button"
            accessibilityLabel="Reintentar cargar historial de uso"
            style={styles.botonReintentar}
            onPress={onReintentar}
          >
            <Text style={styles.textoBotonReintentar}>Reintentar</Text>
          </Pressable>
        </View>
      )}

      {estado.tipo === 'listo' && estado.usos.length === 0 && (
        <View
          style={styles.cajaVacia}
          testID="historial-vacio"
          accessibilityRole="text"
        >
          <Text style={styles.textoVacio}>
            Todavía no registras uso de esta suscripción.
          </Text>
        </View>
      )}

      {estado.tipo === 'listo' && estado.usos.length > 0 && (
        <View
          style={styles.contenedorLista}
          testID="lista-historial-uso"
          accessibilityRole="list"
        >
          {estado.usos.map((uso, indice) => {
            const fechaFormateada = formatearFecha(uso.fecha);
            const duracionFormateada = formatearDuracionMinutos(uso.minutos);
            const etiquetaAccesible = `Uso de ${duracionFormateada} el ${fechaFormateada}`;

            return (
              <View
                key={`${uso.fecha}-${indice}`}
                style={styles.filaUso}
                testID={`historial-fila-${indice}`}
                accessibilityRole={'listitem' as any}
                accessibilityLabel={etiquetaAccesible}
              >
                <Text
                  style={styles.filaFecha}
                  testID={`historial-fecha-${indice}`}
                >
                  {fechaFormateada}
                </Text>
                <Text
                  style={styles.filaMinutos}
                  testID={`historial-minutos-${indice}`}
                >
                  {duracionFormateada}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export default HistorialUsoMovil;
