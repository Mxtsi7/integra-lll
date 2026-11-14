import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ContenidoConEstado } from '../../../components/estados';
import { NavButton } from '../NavButton';
import { COLORES_PLANES as C } from './estilos';
import { FEATURES, incluyeFeature, NOMBRES_FEATURES } from './reglasPlanes';
import { usePermisosPlan, type ApiPermisos } from './usePermisosPlan';

export interface RestriccionesPremiumContenidoProps {
  onVerPlanes: () => void;
  /** Solo en pruebas. */
  api?: ApiPermisos;
}

/** Qué funciones incluye el plan de la persona y cuáles necesitan Premium (AN-11). */
export function RestriccionesPremiumContenido({ onVerPlanes, api }: RestriccionesPremiumContenidoProps) {
  const { estado, cargar } = usePermisosPlan(api);

  return (
    <View testID="restricciones-contenido" style={styles.contenedor}>
      <ContenidoConEstado
        estado={estado}
        onReintentar={() => void cargar()}
        vacio={{ titulo: 'Sin información del plan', descripcion: 'No encontramos información de tu plan.' }}
      >
        {(permisos) => {
          const hayBloqueadas = FEATURES.some((feature) => !incluyeFeature(permisos, feature));
          return (
            <>
              {FEATURES.map((feature) => {
                const incluida = incluyeFeature(permisos, feature);
                return (
                  <View key={feature} testID={`funcion-${feature}`} style={styles.fila}>
                    <Text style={styles.nombre}>{NOMBRES_FEATURES[feature]}</Text>
                    {/* Texto y símbolo: el estado no depende solo del color. */}
                    <Text style={incluida ? styles.disponible : styles.bloqueada}>
                      {incluida ? '✓ Disponible' : '🔒 Requiere Premium'}
                    </Text>
                  </View>
                );
              })}
              {hayBloqueadas ? (
                <NavButton testID="ver-planes" title="Ver planes" onPress={onVerPlanes} />
              ) : (
                <Text testID="todo-incluido" style={styles.texto}>
                  Tu plan incluye todas las funciones.
                </Text>
              )}
            </>
          );
        }}
      </ContenidoConEstado>
      {estado.tipo === 'error' ? (
        <Text testID="funciones-bloqueadas" style={styles.texto}>
          Mientras no podamos confirmar tu plan, las funciones Premium se mantienen bloqueadas.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 12 },
  fila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: C.superficie, borderWidth: 1, borderColor: C.borde },
  nombre: { color: C.tinta, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  disponible: { color: C.acento, fontSize: 13, fontWeight: '700' },
  bloqueada: { color: C.tinta2, fontSize: 13, fontWeight: '700' },
  texto: { color: C.tinta2, fontSize: 14 },
});
