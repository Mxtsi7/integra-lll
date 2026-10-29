import { useState, useEffect, useCallback, useRef } from 'react';
import {
  descartarRecomendacion,
  ErrorDeApi,
  getRecomendaciones,
  type Recomendacion,
  type RecomendacionDescartada,
} from '@ojoalgasto/shared';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

export type EstadoRecomendaciones =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | {
      tipo: 'listo';
      items: Recomendacion[];
      /** false: Analytics no tiene con qué recomendar (falta configurar el umbral de ahorro). */
      disponible: boolean;
      /** Por qué no hay sugerencias, tal como lo explica el backend (null si no lo dice). */
      motivoSinSugerencias: string | null;
    };

/** Cómo va el "No me interesa" de una tarjeta (CH-32). Sin entrada: nada en curso. */
export type EstadoDescarte = { tipo: 'enviando' } | { tipo: 'error'; mensaje: string };

type Lista = { items: Recomendacion[]; disponible: boolean; motivoSinSugerencias: string | null };

/** La respuesta de VI-17 es { results, disponible, motivo_sin_sugerencias, … }; un arreglo suelto también vale. */
function leerLista(data: unknown): Lista | null {
  if (Array.isArray(data)) return { items: data as Recomendacion[], disponible: true, motivoSinSugerencias: null };
  if (typeof data === 'object' && data !== null) {
    const { results, disponible, motivo_sin_sugerencias } = data as Record<string, unknown>;
    if (Array.isArray(results)) {
      return {
        items: results as Recomendacion[],
        // Si no lo dice, no se asume que falta configuración.
        disponible: disponible !== false,
        motivoSinSugerencias: typeof motivo_sin_sugerencias === 'string' && motivo_sin_sugerencias ? motivo_sin_sugerencias : null,
      };
    }
  }
  return null;
}

function mensajeErrorDescarte(err: unknown): string {
  if (err instanceof TypeError) return MENSAJE_SIN_RED;
  if (err instanceof ErrorDeApi && err.status === 404) {
    return 'Esta recomendación ya no está disponible. Vuelve a cargar la lista.';
  }
  return 'No pudimos descartarla. Intenta de nuevo.';
}

function sinClave<T>(registro: Record<string, T>, clave: string): Record<string, T> {
  const copia = { ...registro };
  delete copia[clave];
  return copia;
}

export function useRecomendaciones() {
  const [estado, setEstado] = useState<EstadoRecomendaciones>({ tipo: 'cargando' });
  const [descartes, setDescartes] = useState<Record<string, EstadoDescarte>>({});
  // Solo se muestra la última carga: si se reintenta antes de que llegue la
  // anterior, esa respuesta vieja se descarta.
  const cargaActual = useRef(0);
  // Las que se descartaron en esta visita. Una carga que el servidor respondió
  // antes de guardar el descarte todavía las traería: se filtran igual.
  const descartadas = useRef(new Set<string>());
  // Ref y no solo estado: un doble clic vería el estado viejo y mandaría dos.
  const enviando = useRef(new Set<string>());

  const cargarRecomendaciones = useCallback(async () => {
    const esta = ++cargaActual.current;
    setEstado({ tipo: 'cargando' });
    try {
      const data = await getRecomendaciones();
      if (esta !== cargaActual.current) return;
      const lista = leerLista(data);
      if (lista === null) {
        setEstado({ tipo: 'error', mensaje: 'El servicio respondió en un formato inesperado.' });
        return;
      }
      setEstado({ tipo: 'listo', ...lista, items: lista.items.filter((i) => !descartadas.current.has(i.id)) });
    } catch (err: unknown) {
      if (esta !== cargaActual.current) return;
      setEstado({
        tipo: 'error',
        mensaje:
          err instanceof TypeError
            ? MENSAJE_SIN_RED
            : err instanceof Error && err.message
              ? err.message
              : 'El servicio de recomendaciones no está disponible actualmente.',
      });
    }
  }, []);

  /**
   * CH-32: la tarjeta se retira solo cuando el servidor confirma. Si falla, se
   * queda con el error y se puede volver a intentar. Devuelve la confirmación,
   * o null si no se descartó.
   */
  const descartar = useCallback(async (id: string): Promise<RecomendacionDescartada | null> => {
    if (enviando.current.has(id)) return null;
    enviando.current.add(id);
    setDescartes((d) => ({ ...d, [id]: { tipo: 'enviando' } }));
    try {
      const confirmacion = await descartarRecomendacion(id);
      descartadas.current.add(id);
      setEstado((e) => (e.tipo === 'listo' ? { ...e, items: e.items.filter((i) => i.id !== id) } : e));
      setDescartes((d) => sinClave(d, id));
      return confirmacion;
    } catch (err: unknown) {
      setDescartes((d) => ({ ...d, [id]: { tipo: 'error', mensaje: mensajeErrorDescarte(err) } }));
      return null;
    } finally {
      enviando.current.delete(id);
    }
  }, []);

  useEffect(() => {
    cargarRecomendaciones();
    return () => {
      // Al desmontar, la carga en vuelo ya no se muestra.
      cargaActual.current += 1;
    };
  }, [cargarRecomendaciones]);

  return { estado, descartes, descartar, recargar: cargarRecomendaciones };
}
