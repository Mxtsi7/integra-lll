import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ContenidoConEstado } from '../../../components/estados';
import { NavButton } from '../NavButton';
import type { AlmacenIntento } from './almacenIntento';
import { COLORES_PLANES as C } from './estilos';
import { MENSAJE_PLAN_ACTIVANDO, TEXTOS_CONTRATACION } from './reglasPlanes';
import { TarjetaPlan } from './TarjetaPlan';
import { usePlanes, type ApiPlanes } from './usePlanes';

export interface PlanesContenidoProps {
  /** Abre la página de pago en el navegador (en la app, `Linking.openURL`). */
  abrirUrl: (url: string) => Promise<unknown>;
  /** Avisa cuando la persona vuelve a esta pantalla. Devuelve la función para dejar de escuchar. */
  alVolverAPantalla?: (alVolver: () => void) => () => void;
  /** Solo en pruebas. */
  api?: ApiPlanes;
  /** Almacén persistente del intento de contratación pendiente. */
  almacen?: AlmacenIntento | null;
}

/** Planes Gratuito y Premium, estado del plan y contratación (AN-08). */
export function PlanesContenido({ abrirUrl, alVolverAPantalla, api, almacen }: PlanesContenidoProps) {
  const { estado, contrato, idSinCargar, operacion, mensajeError, cargar, contratar, verificar, cancelar, releerPermisos } =
    usePlanes(abrirUrl, api, almacen);
  const ocupado = operacion !== null;

  // Al volver a la pantalla: si había un pago pendiente se consulta cómo terminó; si no, se relee el plan.
  const hayPagoPendiente = contrato?.estado === 'pendiente' || idSinCargar !== null;
  const verificarRef = useRef(verificar);
  verificarRef.current = verificar;
  const releerPermisosRef = useRef(releerPermisos);
  releerPermisosRef.current = releerPermisos;
  const pendienteRef = useRef(hayPagoPendiente);
  pendienteRef.current = hayPagoPendiente;
  useEffect(
    () =>
      alVolverAPantalla?.(() => {
        if (pendienteRef.current) {
          void verificarRef.current();
        } else {
          void releerPermisosRef.current();
        }
      }),
    [alVolverAPantalla],
  );

  return (
    <ContenidoConEstado
      estado={estado}
      onReintentar={() => void cargar()}
      esVacio={({ planes }) => planes.length === 0}
      vacio={{ titulo: 'Sin planes disponibles', descripcion: 'Por ahora no hay planes para mostrar.' }}
    >
      {({ planes, permisos }) => {
        const esPremium = permisos.plan === 'premium';
        const contratoTerminado = contrato && contrato.estado !== 'pendiente';
        return (
          <View testID="planes-contenido" style={styles.contenedor}>
            <Text testID="plan-vigente" style={styles.estado}>
              Tu plan: {esPremium ? 'Premium' : 'Gratuito'}
            </Text>

            {planes.map((plan) => (
              <View key={plan.codigo} style={styles.bloque}>
                <TarjetaPlan plan={plan} esActual={plan.codigo === permisos.plan} />
                {plan.codigo === 'premium' && !esPremium && !hayPagoPendiente ? (
                  <NavButton
                    testID="contratar-premium"
                    title={contratoTerminado ? 'Intentar de nuevo' : 'Contratar Premium'}
                    loading={operacion === 'iniciando'}
                    disabled={ocupado}
                    onPress={() => void contratar()}
                  />
                ) : null}
              </View>
            ))}

            {!contrato && idSinCargar !== null ? (
              <View testID="contratacion-sin-cargar" style={styles.resultado}>
                <Text style={styles.tituloResultado} accessibilityRole="header">
                  {TEXTOS_CONTRATACION.pendiente.titulo}
                </Text>
                <Text style={styles.texto}>{TEXTOS_CONTRATACION.pendiente.detalle}</Text>
                <NavButton
                  testID="verificar-estado"
                  title="Verificar estado"
                  variant="secondary"
                  loading={operacion === 'verificando'}
                  disabled={ocupado}
                  onPress={() => void verificar()}
                />
                <NavButton
                  testID="cancelar-contratacion"
                  title="Cancelar contratación"
                  variant="danger"
                  loading={operacion === 'cancelando'}
                  disabled={ocupado}
                  onPress={() => void cancelar()}
                />
              </View>
            ) : null}

            {contrato ? (
              <View testID={`contratacion-${contrato.estado}`} style={styles.resultado}>
                <Text style={styles.tituloResultado} accessibilityRole="header">
                  {TEXTOS_CONTRATACION[contrato.estado].titulo}
                </Text>
                <Text style={styles.texto}>{TEXTOS_CONTRATACION[contrato.estado].detalle}</Text>
                {contrato.estado === 'exitosa' && !esPremium ? (
                  <Text testID="plan-activando" style={styles.texto}>
                    {MENSAJE_PLAN_ACTIVANDO}
                  </Text>
                ) : null}

                {hayPagoPendiente || (contrato.estado === 'exitosa' && !esPremium) ? (
                  <NavButton
                    testID="verificar-estado"
                    title="Verificar estado"
                    variant="secondary"
                    loading={operacion === 'verificando'}
                    disabled={ocupado}
                    onPress={() => void verificar()}
                  />
                ) : null}
                {hayPagoPendiente ? (
                  <NavButton
                    testID="cancelar-contratacion"
                    title="Cancelar contratación"
                    variant="danger"
                    loading={operacion === 'cancelando'}
                    disabled={ocupado}
                    onPress={() => void cancelar()}
                  />
                ) : null}
              </View>
            ) : null}

            {mensajeError ? (
              <Text testID="error-planes" style={styles.error} accessibilityRole="alert">
                {mensajeError}
              </Text>
            ) : null}
          </View>
        );
      }}
    </ContenidoConEstado>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 14 },
  bloque: { gap: 8 },
  estado: { color: C.tinta, fontSize: 16, fontWeight: '700' },
  resultado: { gap: 8, padding: 14, borderRadius: 12, backgroundColor: C.superficie, borderWidth: 1, borderColor: C.borde },
  tituloResultado: { color: C.tinta, fontSize: 16, fontWeight: '700' },
  texto: { color: C.tinta2, fontSize: 14 },
  error: { color: C.error, fontSize: 14 },
});
