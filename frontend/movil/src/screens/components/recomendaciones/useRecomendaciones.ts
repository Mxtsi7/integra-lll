import { useCallback, useEffect, useRef, useState } from 'react';
import {
  descartarRecomendacion,
  ErrorDeApi,
  explicarRecomendacion,
  getRecomendaciones,
  type EstadoCarga,
  type ExplicacionRecomendacion,
} from '@ojoalgasto/shared';
import { leerListaRecomendaciones, type ListaLeida } from './reglasRecomendaciones';

/** Las llamadas al backend. Se reemplazan en las pruebas por funciones falsas. */
export interface ApiRecomendaciones {
  getRecomendaciones: typeof getRecomendaciones;
  explicarRecomendacion: typeof explicarRecomendacion;
  descartarRecomendacion: typeof descartarRecomendacion;
}

const API_REAL: ApiRecomendaciones = { getRecomendaciones, explicarRecomendacion, descartarRecomendacion };

export const MENSAJE_ERROR_DESCARTE = 'No pudimos descartar la recomendación. Inténtalo de nuevo.';

/** El detalle de una recomendación, pedido al abrirlo. */
export type EstadoDetalle = EstadoCarga<ExplicacionRecomendacion>;

/**
 * Lista de recomendaciones, detalle y descarte (AN-05, AN-21 y AN-25).
 * Una respuesta vieja de lectura (se recargó o se salió de la pantalla) se descarta comparando `numeroDeCarga`.
 * Las mutaciones (descarte) no dependen de `numeroDeCarga` y registran los IDs confirmados para que una
 * lectura en curso no restaure una tarjeta ya descartada.
 */
export function useRecomendaciones(api: ApiRecomendaciones = API_REAL) {
  const [estado, setEstado] = useState<EstadoCarga<ListaLeida>>({ tipo: 'cargando' });
  const [detalles, setDetalles] = useState<Record<string, EstadoDetalle>>({});
  const [idsDescartando, setIdsDescartando] = useState<string[]>([]);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  // El gateway responde 403 si el plan no incluye recomendaciones; no es un fallo de red.
  const [requierePremium, setRequierePremium] = useState(false);
  const numeroDeCarga = useRef(0);
  const sigueMontado = useRef(true);
  const descartesEnCurso = useRef(new Set<string>()); // candado contra doble toque
  const descartadosConfirmados = useRef(new Set<string>()); // evita que un GET atrasado restaure tarjetas descartadas

  const cargar = useCallback(async () => {
    numeroDeCarga.current += 1;
    const miCarga = numeroDeCarga.current;
    setEstado({ tipo: 'cargando' });
    setDetalles({});
    setMensajeError(null);
    setRequierePremium(false);

    try {
      const respuesta = await api.getRecomendaciones();
      if (!sigueMontado.current || miCarga !== numeroDeCarga.current) return;
      const lista = leerListaRecomendaciones(respuesta);
      const listaFiltrada = lista
        ? {
            ...lista,
            recomendaciones: lista.recomendaciones.filter((item) => !descartadosConfirmados.current.has(item.id)),
          }
        : null;
      setEstado(listaFiltrada ? { tipo: 'listo', datos: listaFiltrada } : { tipo: 'error' });
    } catch (error) {
      if (!sigueMontado.current || miCarga !== numeroDeCarga.current) return;
      if (error instanceof ErrorDeApi && error.status === 403) setRequierePremium(true);
      setEstado({ tipo: 'error' });
    }
  }, [api]);

  useEffect(() => {
    sigueMontado.current = true;
    void cargar();
    return () => {
      sigueMontado.current = false;
      numeroDeCarga.current += 1;
    };
  }, [cargar]);

  const verDetalle = useCallback(
    async (id: string) => {
      const miCarga = numeroDeCarga.current;
      setDetalles((actuales) => ({ ...actuales, [id]: { tipo: 'cargando' } }));
      try {
        const explicacion = await api.explicarRecomendacion(id);
        if (!sigueMontado.current || miCarga !== numeroDeCarga.current) return;
        setDetalles((actuales) => ({ ...actuales, [id]: { tipo: 'listo', datos: explicacion } }));
      } catch {
        if (!sigueMontado.current || miCarga !== numeroDeCarga.current) return;
        setDetalles((actuales) => ({ ...actuales, [id]: { tipo: 'error' } }));
      }
    },
    [api],
  );

  const ocultarDetalle = useCallback((id: string) => {
    setDetalles((actuales) => {
      const { [id]: _quitado, ...resto } = actuales;
      return resto;
    });
  }, []);

  /** "No me interesa" (AN-25). La tarjeta solo desaparece cuando el backend confirma. */
  const descartar = useCallback(
    async (id: string) => {
      if (descartesEnCurso.current.has(id)) return;
      descartesEnCurso.current.add(id);

      if (sigueMontado.current) {
        setIdsDescartando((ids) => [...ids, id]);
        setMensajeError(null);
      }

      try {
        await api.descartarRecomendacion(id);
        descartadosConfirmados.current.add(id);
        if (sigueMontado.current) {
          setEstado((actual) =>
            actual.tipo !== 'listo'
              ? actual
              : {
                  tipo: 'listo',
                  datos: {
                    ...actual.datos,
                    recomendaciones: actual.datos.recomendaciones.filter((item) => item.id !== id),
                  },
                },
          );
        }
      } catch {
        if (sigueMontado.current) {
          setMensajeError(MENSAJE_ERROR_DESCARTE);
        }
      } finally {
        descartesEnCurso.current.delete(id);
        if (sigueMontado.current) {
          setIdsDescartando((ids) => ids.filter((otroId) => otroId !== id));
        }
      }
    },
    [api],
  );

  return { estado, requierePremium, detalles, idsDescartando, mensajeError, cargar, verDetalle, ocultarDetalle, descartar };
}
