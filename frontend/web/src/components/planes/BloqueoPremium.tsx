import {
  NOMBRES_FEATURES,
  type FeaturesPlan,
} from '@ojoalgasto/shared';
import type { ReactNode } from 'react';
import { usePermisosPlan, type EstadoPermisos } from '../../hooks/usePermisosPlan';
import { BotonEnlace } from '../ui/Boton';
import { ErrorConReintento } from '../ui/ErrorConReintento';
import { Spinner } from '../Spinner';
import styles from './BloqueoPremium.module.css';

export interface BloqueoPremiumProps {
  /** Feature requerida según el contrato de backend (ej. 'asistente_financiero', 'recomendaciones_automaticas'). */
  feature: keyof FeaturesPlan;
  /** Estado de permisos del hook usePermisosPlan. */
  permisos: EstadoPermisos;
  /** Función para reintentar si la comprobación falló. */
  onReintentar?: () => void;
  /** Destino del botón para ver planes (por defecto '/perfil'). */
  enlacePlanes?: string;
  /** Contenido protegido que solo debe renderizarse cuando el plan incluye la feature. */
  children: ReactNode;
}

/**
 * Componente universal de restricción visual Premium (SE-02).
 *
 * Envuelve controles o secciones que requieren plan Premium:
 * - Si el plan incluye la feature (confirmado explícitamente por el servidor), muestra children.
 * - Mientras carga o si falla la comprobación, NO muestra children (seguro por omisión).
 * - Si no está incluida, muestra aviso con explicación del beneficio y botón para ver planes.
 *
 * El bloqueo visual complementa la seguridad del backend (el gateway retorna 403 en endpoints protegidos).
 */
export function BloqueoPremium({
  feature,
  permisos,
  onReintentar,
  enlacePlanes = '/perfil',
  children,
}: BloqueoPremiumProps) {
  const nombreFeature = NOMBRES_FEATURES[feature] ?? feature;

  if (permisos.tipo === 'cargando') {
    return (
      <div className={styles.cargando}>
        <Spinner size={18} etiqueta="Comprobando tu plan" />
      </div>
    );
  }

  if (permisos.tipo === 'error') {
    return (
      <div className={styles.error}>
        <ErrorConReintento mensaje={permisos.mensaje} onReintentar={onReintentar ?? (() => {})} />
      </div>
    );
  }

  // Si está listo y la feature está explícitamente en true, se renderiza el contenido protegido
  if (permisos.permisos.features[feature] === true) {
    return <>{children}</>;
  }

  // Si es Free o no tiene la feature habilitada, se muestra la restricción visual
  return (
    <section className={`tile ${styles.contenedor}`} aria-label={`${nombreFeature} en Premium`}>
      <p>El {nombreFeature.toLowerCase()} es parte del plan Premium.</p>
      <p>Mientras tanto puedes seguir usando el resto de la app.</p>
      <div className={styles.acciones}>
        <BotonEnlace to={enlacePlanes} variante="secundario" tamano="s">
          Ver planes
        </BotonEnlace>
      </div>
    </section>
  );
}

/**
 * Variante autocontenida que consulta automáticamente usePermisosPlan().
 */
export function BloqueoPremiumAuto(props: Omit<BloqueoPremiumProps, 'permisos' | 'onReintentar'>) {
  const { estado, reintentar } = usePermisosPlan();
  return <BloqueoPremium {...props} permisos={estado} onReintentar={reintentar} />;
}
