import { useState, useEffect, useCallback, useRef } from 'react';
import {
  descartarRecomendacion,
  ErrorDeApi,
  explicarRecomendacion,
  getRecomendaciones,
  type ExplicacionRecomendacion,
  type Recomendacion,
  type RecomendacionDescartada,
} from '@ojoalgasto/shared';
import { useAuth } from '../context/AuthContext';
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

/** Cómo va la explicación de una tarjeta (CH-22). Sin entrada: todavía no se pidió. */
export type EstadoExplicacion =
  | { tipo: 'cargando' }
  | { tipo: 'listo'; explicacion: ExplicacionRecomendacion }
  | { tipo: 'error'; mensaje: string };

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

const MENSAJE_RECOMENDACION_NO_DISPONIBLE = 'Esta recomendación ya no está disponible. Vuelve a cargar la lista.';

function mensajeErrorDescarte(err: unknown): string {
  if (err instanceof TypeError) return MENSAJE_SIN_RED;
  if (err instanceof ErrorDeApi && err.status === 404) return MENSAJE_RECOMENDACION_NO_DISPONIBLE;
  return 'No pudimos descartarla. Intenta de nuevo.';
}

function mensajeErrorExplicacion(err: unknown): string {
  if (err instanceof TypeError) return MENSAJE_SIN_RED;
  if (err instanceof ErrorDeApi && err.status === 404) return MENSAJE_RECOMENDACION_NO_DISPONIBLE;
  return 'No pudimos cargar la explicación. Intenta de nuevo.';
}

function sinClave<T>(registro: Record<string, T>, clave: string): Record<string, T> {
  const copia = { ...registro };
  delete copia[clave];
  return copia;
}

export function useRecomendaciones() {
  const { capturarSesion } = useAuth();
  // La sesión con la que se montó la página. Si cambia, <RutaPrivada> la
  // vuelve a montar desde cero (lista, errores y descartes nuevos); esto
  // cubre el descarte que se confirma entre el cambio y ese nuevo montaje, o
  // con la página ya cerrada: no se aplica ni se anuncia (revisión de #128).
  const [sesion] = useState(capturarSesion);
  const montado = useRef(false);
  const sigueVigente = useCallback(() => montado.current && capturarSesion() === sesion, [capturarSesion, sesion]);

  const [estado, setEstado] = useState<EstadoRecomendaciones>({ tipo: 'cargando' });
  const [descartes, setDescartes] = useState<Record<string, EstadoDescarte>>({});
  // CH-22: la explicación de cada tarjeta, que se pide solo cuando se abre.
  const [explicaciones, setExplicaciones] = useState<Record<string, EstadoExplicacion>>({});
  // Solo se muestra la última carga: si se reintenta antes de que llegue la
  // anterior, esa respuesta vieja se descarta.
  const cargaActual = useRef(0);
  // Las que se descartaron en esta visita. Una carga que el servidor respondió
  // antes de guardar el descarte todavía las traería: se filtran igual.
  const descartadas = useRef(new Set<string>());
  // Ref y no solo estado: un doble clic vería el estado viejo y mandaría dos.
  const enviando = useRef(new Set<string>());
  // Las explicaciones que se están pidiendo, como "carga:id". Con la carga en la
  // clave, una petición de la lista anterior no frena la de la lista nueva.
  const explicando = useRef(new Set<string>());

  const cargarRecomendaciones = useCallback(async () => {
    const esta = ++cargaActual.current;
    setEstado({ tipo: 'cargando' });
    // Las explicaciones son de la lista anterior: con la lista nueva se piden de nuevo.
    setExplicaciones({});
    try {
      const data = await getRecomendaciones();
      if (esta !== cargaActual.current) return;
      const lista = leerLista(data);
      if (lista === null) {
        setEstado({ tipo: 'error', mensaje: 'El servicio respondió en un formato inesperado.' });
        return;
      }
      setEstado({ tipo: 'listo', ...lista, items: lista.items.filter((recomendacion) => !descartadas.current.has(recomendacion.id)) });
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
   * o null si no se descartó o si ya no es de esta sesión y esta página.
   */
  const descartar = useCallback(async (id: string): Promise<RecomendacionDescartada | null> => {
    // Con la sesión ya cambiada no se manda: la tarjeta es de la cuenta anterior.
    if (!sigueVigente() || enviando.current.has(id)) return null;
    enviando.current.add(id);
    setDescartes((actuales) => ({ ...actuales, [id]: { tipo: 'enviando' } }));
    try {
      const confirmacion = await descartarRecomendacion(id);
      // Confirmado para la sesión anterior, o con la página ya cerrada: quien
      // llama no debe anunciarlo ni mover el foco.
      if (!sigueVigente()) return null;
      descartadas.current.add(id);
      setEstado((actual) => (actual.tipo === 'listo' ? { ...actual, items: actual.items.filter((recomendacion) => recomendacion.id !== id) } : actual));
      setDescartes((actuales) => sinClave(actuales, id));
      setExplicaciones((actuales) => sinClave(actuales, id));
      return confirmacion;
    } catch (err: unknown) {
      setDescartes((actuales) => ({ ...actuales, [id]: { tipo: 'error', mensaje: mensajeErrorDescarte(err) } }));
      return null;
    } finally {
      enviando.current.delete(id);
    }
  }, [sigueVigente]);

  /**
   * CH-22: pide la explicación de una recomendación (MX-25). No hace nada si ya
   * se está pidiendo (un doble clic no manda dos) ni si la sesión cambió. Una
   * respuesta de otra sesión o de una lista anterior no se aplica.
   */
  const cargarExplicacion = useCallback(async (id: string) => {
    const carga = cargaActual.current;
    const clave = `${carga}:${id}`;
    if (!sigueVigente() || explicando.current.has(clave)) return;
    explicando.current.add(clave);
    setExplicaciones((actuales) => ({ ...actuales, [id]: { tipo: 'cargando' } }));
    try {
      const explicacion = await explicarRecomendacion(id);
      if (!sigueVigente() || carga !== cargaActual.current) return;
      setExplicaciones((actuales) => ({ ...actuales, [id]: { tipo: 'listo', explicacion } }));
    } catch (err: unknown) {
      if (!sigueVigente() || carga !== cargaActual.current) return;
      setExplicaciones((actuales) => ({ ...actuales, [id]: { tipo: 'error', mensaje: mensajeErrorExplicacion(err) } }));
    } finally {
      explicando.current.delete(clave);
    }
  }, [sigueVigente]);

  useEffect(() => {
    montado.current = true;
    cargarRecomendaciones();
    return () => {
      // Al desmontar, la carga en vuelo ya no se muestra.
      montado.current = false;
      cargaActual.current += 1;
    };
  }, [cargarRecomendaciones]);

  return { estado, descartes, descartar, explicaciones, cargarExplicacion, recargar: cargarRecomendaciones };
}
