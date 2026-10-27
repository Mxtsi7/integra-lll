import { vistaDeEstado, type EstadoCarga } from '@ojoalgasto/shared';
import type { ReactNode } from 'react';
import { EmptyState, type EmptyStateProps } from './EmptyState';
import { Loading } from './Loading';
import { NetworkError } from './NetworkError';

export interface ContenidoConEstadoProps<T> {
  estado: EstadoCarga<T>;
  onReintentar: () => void;
  /** Decide si los datos listos cuentan como "vacío". */
  esVacio?: (datos: T) => boolean;
  /** Texto/acción del estado vacío. */
  vacio: EmptyStateProps;
  /** Solo se llama con datos listos y no vacíos. */
  children: (datos: T) => ReactNode;
}

/**
 * Único contrato de estados para pantallas móviles (Home, Panel, Calendario, Recomendaciones).
 * La decisión de qué mostrar vive en shared (vistaDeEstado) y está probada allí.
 * - Sin estado interno: no copia ni guarda los datos. Mientras carga o falla, `children` ni se ejecuta,
 *   así no queda a la vista información privada de la pantalla anterior.
 * - Para limpiar al cambiar de usuario o de pantalla, el padre usa una `key` distinta.
 */
export function ContenidoConEstado<T>({ estado, onReintentar, esVacio, vacio, children }: ContenidoConEstadoProps<T>) {
  const vista = vistaDeEstado(estado, esVacio);
  if (vista === 'cargando') return <Loading />;
  if (vista === 'error') return <NetworkError onReintentar={onReintentar} />;
  if (vista === 'vacio') return <EmptyState {...vacio} />;
  return estado.tipo === 'listo' ? <>{children(estado.datos)}</> : null;
}
