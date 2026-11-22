import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ContenidoConEstado, EmptyState } from '../../../components/estados';
import { NavButton } from '../NavButton';
import { COLORES_RECOMENDACIONES as C } from './estilos';
import { TarjetaRecomendacion } from './TarjetaRecomendacion';
import { useRecomendaciones, type ApiRecomendaciones } from './useRecomendaciones';

const DESCRIPCION_SIN_SUGERENCIAS = 'Cuando encontremos una forma de ahorrar en tus suscripciones, la verás aquí.';

export interface RecomendacionesContenidoProps {
  /** Lleva a la pantalla de planes cuando la función requiere Premium. */
  onVerPlanes?: () => void;
  /** Solo en pruebas. */
  api?: ApiRecomendaciones;
}

export function RecomendacionesContenido({ onVerPlanes, api }: RecomendacionesContenidoProps) {
  const { estado, requierePremium, detalles, idsDescartando, mensajeError, cargar, verDetalle, ocultarDetalle, descartar } = useRecomendaciones(api);

  if (requierePremium) {
    return (
      <View testID="recomendaciones-premium">
        <EmptyState
          titulo="Las recomendaciones son Premium"
          descripcion="Con Premium encontramos dónde puedes ahorrar en tus suscripciones."
          accion={onVerPlanes ? { etiqueta: 'Ver planes', onPress: onVerPlanes } : undefined}
        />
      </View>
    );
  }

  return (
    <View testID="recomendaciones-contenido" style={styles.contenedor}>
      <ContenidoConEstado
        estado={estado}
        onReintentar={() => void cargar()}
        esVacio={(lista) => lista.recomendaciones.length === 0}
        vacio={{
          titulo: 'No hay recomendaciones por ahora',
          // El motivo lo escribe el backend para mostrarlo tal cual.
          descripcion: estado.tipo === 'listo' && estado.datos.motivoSinSugerencias ? estado.datos.motivoSinSugerencias : DESCRIPCION_SIN_SUGERENCIAS,
        }}
      >
        {(lista) => (
          <>
            {mensajeError ? (
              <Text testID="error-recomendaciones" style={styles.error} accessibilityRole="alert">
                {mensajeError}
              </Text>
            ) : null}
            {lista.recomendaciones.map((recomendacion) => (
              <TarjetaRecomendacion
                key={recomendacion.id}
                recomendacion={recomendacion}
                detalle={detalles[recomendacion.id]}
                estaDescartando={idsDescartando.includes(recomendacion.id)}
                onVerDetalle={(id) => void verDetalle(id)}
                onOcultarDetalle={ocultarDetalle}
                onDescartar={(id) => void descartar(id)}
              />
            ))}
            <NavButton testID="actualizar-recomendaciones" title="Actualizar" variant="secondary" onPress={() => void cargar()} />
          </>
        )}
      </ContenidoConEstado>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 12 },
  error: { color: C.error, fontSize: 14 },
});
