import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAlertas,
  getContadorAlertas,
  marcarAlertaLeida,
  marcarTodasLasAlertasLeidas,
  type Alerta,
  type EstadoCarga,
} from '@ojoalgasto/shared';

/** Las llamadas al backend. Se reemplazan en las pruebas por funciones falsas. */
export interface ApiAlertas {
  getAlertas: typeof getAlertas;
  getContadorAlertas: typeof getContadorAlertas;
  marcarAlertaLeida: typeof marcarAlertaLeida;
  marcarTodasLasAlertasLeidas: typeof marcarTodasLasAlertasLeidas;
}

const API_REAL: ApiAlertas = { getAlertas, getContadorAlertas, marcarAlertaLeida, marcarTodasLasAlertasLeidas };

export const MENSAJE_ERROR_MARCAR = 'No pudimos marcar la alerta como leída. Inténtalo de nuevo.';
export const MENSAJE_ERROR_MARCAR_TODAS = 'No pudimos marcar todas como leídas. Inténtalo de nuevo.';
export const MENSAJE_ERROR_VER_MAS = 'No pudimos cargar más alertas. Inténtalo de nuevo.';

/** Qué alertas se listan: todas, o solo las que siguen sin leer. */
export type FiltroAlertas = 'todas' | 'sin_leer';

/** Arma lo que se le pide al backend; sin filtro se manda solo la página. */
function consultaDe(filtro: FiltroAlertas, pagina: number) {
  return filtro === 'sin_leer' ? { pagina, lectura: 'pendiente' as const } : { pagina };
}

/** Lo que muestra la pantalla cuando ya cargó. */
export interface DatosAlertas {
  alertas: Alerta[];
  /** El número del badge. Viene del backend (de toda la organización), no de contar lo que se ve. */
  pendientes: number;
  /** Última página pedida. */
  pagina: number;
  hayMas: boolean;
}

/**
 * Centro de alertas: lista paginada, badge y marcar como leída (AN-10 y AN-24).
 *
 * - Las LECTURAS (la carga y "ver más") se comparan con `numeroDeCarga`: si llega una respuesta vieja
 *   porque se recargó o se salió de la pantalla, se descarta.
 * - Las ACCIONES (marcar leída) no dependen de `numeroDeCarga`: su resultado vale aunque la lista se
 *   haya recargado en el medio. Solo se descartan si la pantalla ya se cerró.
 * - El badge baja solo si la alerta de verdad estaba pendiente en pantalla, y nunca queda bajo 0.
 */
export function useAlertas(api: ApiAlertas = API_REAL) {
  const [estado, setEstado] = useState<EstadoCarga<DatosAlertas>>({ tipo: 'cargando' });
  const [idsMarcando, setIdsMarcando] = useState<string[]>([]);
  const [marcandoTodas, setMarcandoTodas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroAlertas>('todas');
  const numeroDeCarga = useRef(0);
  const sigueMontado = useRef(true);
  const idsEnCurso = useRef(new Set<string>()); // candado contra doble toque
  const todasEnCurso = useRef(false);
  const masEnCurso = useRef(false);

  /** `enSegundoPlano`: no vacía la pantalla ni la cambia por un error si falla (se usa para reconciliar). */
  const cargar = useCallback(
    async (opciones: { enSegundoPlano?: boolean } = {}) => {
      const { enSegundoPlano = false } = opciones;
      numeroDeCarga.current += 1;
      const miCarga = numeroDeCarga.current;
      if (!enSegundoPlano) {
        setEstado({ tipo: 'cargando' });
        setMensajeError(null);
      }

      try {
        const [pagina, contador] = await Promise.all([api.getAlertas(consultaDe(filtro, 1)), api.getContadorAlertas()]);
        if (miCarga !== numeroDeCarga.current) return;
        setEstado({
          tipo: 'listo',
          datos: { alertas: pagina.results, pendientes: contador.pendientes, pagina: 1, hayMas: pagina.next !== null },
        });
      } catch {
        if (miCarga !== numeroDeCarga.current) return;
        // Una recarga en segundo plano que falla deja lo que ya se ve; si no había nada, muestra el error.
        setEstado((actual) => (enSegundoPlano && actual.tipo === 'listo' ? actual : { tipo: 'error' }));
      }
    },
    [api, filtro],
  );

  // Al cambiar el filtro, `cargar` cambia y la lista se vuelve a pedir; la respuesta del filtro anterior se descarta.
  useEffect(() => {
    sigueMontado.current = true;
    void cargar();
    return () => {
      sigueMontado.current = false;
      numeroDeCarga.current += 1; // al salir de la pantalla, las respuestas pendientes se ignoran
    };
  }, [cargar]);

  const cargarMas = useCallback(async () => {
    if (masEnCurso.current || estado.tipo !== 'listo' || !estado.datos.hayMas) return;
    masEnCurso.current = true;
    setCargandoMas(true);
    setMensajeError(null);
    const miCarga = numeroDeCarga.current;
    const paginaSiguiente = estado.datos.pagina + 1;
    try {
      const pagina = await api.getAlertas(consultaDe(filtro, paginaSiguiente));
      if (miCarga !== numeroDeCarga.current) return;
      setEstado((actual) => {
        if (actual.tipo !== 'listo') return actual;
        // Si llegaron alertas nuevas mientras tanto, la página siguiente puede repetir alguna: no se duplica.
        const yaMostradas = new Set(actual.datos.alertas.map((alerta) => alerta.id));
        const nuevas = pagina.results.filter((alerta) => !yaMostradas.has(alerta.id));
        return {
          tipo: 'listo',
          datos: {
            ...actual.datos,
            alertas: [...actual.datos.alertas, ...nuevas],
            pagina: paginaSiguiente,
            hayMas: pagina.next !== null,
          },
        };
      });
    } catch {
      if (miCarga === numeroDeCarga.current) setMensajeError(MENSAJE_ERROR_VER_MAS);
    } finally {
      masEnCurso.current = false;
      if (sigueMontado.current) setCargandoMas(false);
    }
  }, [api, estado, filtro]);

  const marcarLeida = useCallback(
    async (id: string) => {
      if (idsEnCurso.current.has(id)) return;
      idsEnCurso.current.add(id);
      setIdsMarcando((ids) => [...ids, id]);
      setMensajeError(null);
      try {
        // El backend devuelve la alerta ya actualizada (y es idempotente): se usa tal cual.
        const actualizada = await api.marcarAlertaLeida(id);
        if (sigueMontado.current) {
          setEstado((actual) => {
            if (actual.tipo !== 'listo') return actual;
            const estabaPendiente = actual.datos.alertas.some((alerta) => alerta.id === id && alerta.pendiente);
            const alertas = actual.datos.alertas.map((alerta) => (alerta.id === id ? actualizada : alerta));
            return {
              tipo: 'listo',
              datos: {
                ...actual.datos,
                // Con el filtro "Sin leer", una alerta ya leída sale de la lista.
                alertas: filtro === 'sin_leer' ? alertas.filter((alerta) => alerta.pendiente) : alertas,
                pendientes: estabaPendiente ? Math.max(0, actual.datos.pendientes - 1) : actual.datos.pendientes,
              },
            };
          });
        }
      } catch {
        if (sigueMontado.current) setMensajeError(MENSAJE_ERROR_MARCAR);
      } finally {
        idsEnCurso.current.delete(id);
        if (sigueMontado.current) setIdsMarcando((ids) => ids.filter((otroId) => otroId !== id));
      }
    },
    [api, filtro],
  );

  const marcarTodasLeidas = useCallback(async () => {
    if (todasEnCurso.current) return;
    todasEnCurso.current = true;
    setMarcandoTodas(true);
    setMensajeError(null);
    try {
      await api.marcarTodasLasAlertasLeidas();
      // El backend dice cuántas cambió, pero no cuáles: se vuelve a pedir todo y se muestra lo que confirma.
      if (sigueMontado.current) await cargar({ enSegundoPlano: true });
    } catch {
      if (sigueMontado.current) setMensajeError(MENSAJE_ERROR_MARCAR_TODAS);
    } finally {
      todasEnCurso.current = false;
      if (sigueMontado.current) setMarcandoTodas(false);
    }
  }, [api, cargar]);

  return { estado, filtro, cambiarFiltro: setFiltro, idsMarcando, marcandoTodas, cargandoMas, mensajeError, cargar, cargarMas, marcarLeida, marcarTodasLeidas };
}
