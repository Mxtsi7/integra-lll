import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EstadoCarga, FeaturesPlan, PermisosPlan } from '@ojoalgasto/shared';
import { NavButton } from '../NavButton';
import { COLORES_PLANES as C } from './estilos';
import { NOMBRES_FEATURES } from './reglasPlanes';
import { estaPermitida } from './usePermisosPlan';

export interface BloqueoPremiumProps {
  /** Lo que devolvió `usePermisosPlan().estado`. */
  permisos: EstadoCarga<PermisosPlan>;
  feature: keyof FeaturesPlan;
  onVerPlanes: () => void;
  onReintentar?: () => void;
  children: ReactNode;
}

/**
 * Envuelve un control o una sección Premium (AN-11): si el plan la incluye, se ve normal; si no,
 * se reemplaza por el aviso con el botón «Ver planes». Mientras se confirma el plan, o si no se
 * pudo confirmar, el contenido NO se muestra (estado desconocido = no autorizado).
 *
 * Es solo la parte visual. Lo que realmente protege el dato es el backend (el gateway responde 403
 * a un plan gratuito), así que quitar este bloqueo no daría acceso a nada.
 */
export function BloqueoPremium({ permisos, feature, onVerPlanes, onReintentar, children }: BloqueoPremiumProps) {
  if (estaPermitida(permisos, feature)) return <>{children}</>;

  const nombre = NOMBRES_FEATURES[feature];

  if (permisos.tipo === 'cargando') {
    return (
      <Text testID={`bloqueo-${feature}`} style={styles.texto} accessibilityLiveRegion="polite">
        Verificando tu plan…
      </Text>
    );
  }

  return (
    <View testID={`bloqueo-${feature}`} style={styles.caja}>
      <Text style={styles.titulo}>🔒 {nombre} es una función Premium</Text>
      <Text style={styles.texto}>
        {permisos.tipo === 'error'
          ? 'No pudimos confirmar tu plan, así que esta función sigue bloqueada.'
          : 'Tu plan actual no la incluye.'}
      </Text>
      <NavButton testID={`ver-planes-${feature}`} title="Ver planes" onPress={onVerPlanes} />
      {permisos.tipo === 'error' && onReintentar ? (
        <NavButton testID={`reintentar-${feature}`} title="Reintentar" variant="secondary" onPress={onReintentar} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caja: { gap: 8, padding: 14, borderRadius: 12, backgroundColor: C.superficie, borderWidth: 1, borderColor: C.borde },
  titulo: { color: C.tinta, fontSize: 15, fontWeight: '700' },
  texto: { color: C.tinta2, fontSize: 14 },
});
