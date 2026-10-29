import { ErrorDeApi, getImportacion, type Importacion } from '@ojoalgasto/shared';
import { useEffect, useState } from 'react';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

/** Cada cuánto se pregunta (CH-27). Empieza rápido y se espacia mientras no cambia nada. */
export const INTERVALO_INICIAL_MS = 1000;
export const INTERVALO_MAXIMO_MS = 10000;
/** Fallos seguidos antes de dejar de preguntar y ofrecer reintentar a mano. */
export const FALLOS_ANTES_DE_DETENERSE = 3;

export type EstadoProgreso =
  | { tipo: 'cargando' }
  | { tipo: 'no-encontrada' }
  /** Nunca llegó a responder: no hay nada que mostrar. */
  | { tipo: 'error'; mensaje: string }
  | {
      tipo: 'listo';
      importacion: Importacion;
      /**
       * null: todo bien. 'reintentando': la última consulta falló pero se sigue
       * preguntando. 'detenido': fallaron varias seguidas y se dejó de preguntar;
       * lo que se ve puede estar desactualizado.
       */
      problema: null | 'reintentando' | 'detenido';
    };

function mensajeError(err: unknown): string {
  return err instanceof TypeError ? MENSAJE_SIN_RED : 'No pudimos consultar la importación. Intenta de nuevo.';
}

/**
 * Pregunta por una importación hasta que llega a un estado terminal (FE-08:
 * completada o fallida, que ya no cambian). Se detiene al terminar, al
 * desmontar o al cambiar de id, y no pregunta mientras la pestaña está oculta.
 * Si no hay avance, o si falla, espera el doble cada vez (hasta 10 s).
 */
export function useProgresoImportacion(id: string | undefined) {
  const [estado, setEstado] = useState<EstadoProgreso>({ tipo: 'cargando' });
  // Cambiarlo vuelve a empezar (botón Reintentar tras detenerse).
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!id) return;
    let activo = true;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    // true si tocaba preguntar con la pestaña oculta: se pregunta al volver.
    let enPausa = false;
    let espera = INTERVALO_INICIAL_MS;
    let fallos = 0;
    let ultima: Importacion | null = null;

    const programar = () => {
      temporizador = setTimeout(() => {
        temporizador = undefined;
        if (document.visibilityState === 'hidden') {
          enPausa = true;
          return;
        }
        void consultar();
      }, espera);
    };

    const consultar = async () => {
      try {
        const actual = await getImportacion(id);
        if (!activo) return;
        fallos = 0;
        const avanzo =
          ultima === null || actual.estado !== ultima.estado || actual.filas_procesadas !== ultima.filas_procesadas;
        ultima = actual;
        setEstado({ tipo: 'listo', importacion: actual, problema: null });
        if (actual.terminada) return; // terminal: ya no cambia, no se pregunta más
        espera = avanzo ? INTERVALO_INICIAL_MS : Math.min(espera * 2, INTERVALO_MAXIMO_MS);
        programar();
      } catch (err: unknown) {
        if (!activo) return;
        if (err instanceof ErrorDeApi && err.status === 404) {
          setEstado({ tipo: 'no-encontrada' });
          return;
        }
        fallos += 1;
        if (fallos >= FALLOS_ANTES_DE_DETENERSE) {
          setEstado(ultima ? { tipo: 'listo', importacion: ultima, problema: 'detenido' } : { tipo: 'error', mensaje: mensajeError(err) });
          return;
        }
        if (ultima) setEstado({ tipo: 'listo', importacion: ultima, problema: 'reintentando' });
        espera = Math.min(espera * 2, INTERVALO_MAXIMO_MS);
        programar();
      }
    };

    const alCambiarVisibilidad = () => {
      if (document.visibilityState !== 'visible' || !enPausa) return;
      enPausa = false;
      void consultar();
    };
    document.addEventListener('visibilitychange', alCambiarVisibilidad);

    // Al reintentar se sigue viendo lo último de esta misma importación; de otra, no.
    setEstado((e) => (e.tipo === 'listo' && e.importacion.id === id ? { ...e, problema: null } : { tipo: 'cargando' }));
    void consultar(); // la primera va siempre, aunque la pestaña esté oculta

    return () => {
      activo = false;
      if (temporizador !== undefined) clearTimeout(temporizador);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [id, intento]);

  return { estado, reintentar: () => setIntento((n) => n + 1) };
}
