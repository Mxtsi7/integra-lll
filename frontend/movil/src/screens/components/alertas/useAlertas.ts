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

interface ConfirmacionLeida {
  alerta: Alerta;
  epoca: number;
}

/**
 * Centro de alertas: lista paginada, badge y marcar como leída (AN-10 y AN-24).
 *
 * - Las LECTURAS (la carga y "ver más") se comparan con `numeroDeCarga`: si llega una respuesta vieja
 *   porque se recargó o se salió de la pantalla, se descarta.
 * - Las MUTACIONES confirmadas incrementan `epocaMutacion` y se registran para reconciliar cualquier
 *   lectura en vuelo que hubiera empezado antes de confirmarse el marcado (sin perder alertas nuevas).
 * - El filtrado al resolver una mutación usa siempre `filtroVigente` (el filtro actual, no el de inicio).
 */
export function useAlertas(api: ApiAlertas = API_REAL) {
  const [estado, setEstado] = useState<EstadoCarga<DatosAlertas>>({ tipo: 'cargando' });
  const [idsMarcando, setIdsMarcando] = useState<string[]>([]);
  const [marcandoTodas, setMarcandoTodas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroAlertas>('todas');
  const filtroVigente = useRef<FiltroAlertas>(filtro);
  const numeroDeCarga = useRef(0);
  const sigueMontado = useRef(true);
  const idsEnCurso = useRef(new Set<string>()); // candado contra doble toque
  const todasEnCurso = useRef(false);
  const masEnCurso = useRef(false);

  // Registro de mutaciones confirmadas para que una lectura iniciada antes no las deshaga.
  const epocaMutacion = useRef(0);
  const leidasConfirmadas = useRef(new Map<string, ConfirmacionLeida>());
  const epocaMarcarTodas = useRef(0);

  const cambiarFiltro = useCallback((nuevoFiltro: FiltroAlertas) => {
    filtroVigente.current = nuevoFiltro;
    setFiltro(nuevoFiltro);
  }, []);

  /** Reconcilia una instantánea de lectura con las mutaciones confirmadas después de `epocaInicio`. */
  const reconciliarInstantanea = useCallback(
    (
      alertasCrudas: Alerta[],
      pendientesCrudos: number | null,
      hayMas: boolean,
      epocaInicio: number,
    ): { alertas: Alerta[]; pendientes: number } => {
      const todasMarcadasDespues = epocaMarcarTodas.current > epocaInicio;
      const filtroActual = filtroVigente.current;

      const confirmadasPosteriores = new Map<string, Alerta>();
      for (const [id, info] of leidasConfirmadas.current.entries()) {
        if (info.epoca > epocaInicio) {
          confirmadasPosteriores.set(id, info.alerta);
        }
      }

      let descontarPendientes = 0;
      const idsVistos = new Set<string>();

      const alertasReconciliadas = alertasCrudas.map((alerta) => {
        idsVistos.add(alerta.id);
        const confirmada = confirmadasPosteriores.get(alerta.id);
        if (confirmada) {
          if (alerta.pendiente) descontarPendientes += 1;
          return confirmada;
        }
        if (todasMarcadasDespues && alerta.pendiente) {
          descontarPendientes += 1;
          return { ...alerta, pendiente: false, lectura: 'leida' as const, lectura_legible: 'Leída' };
        }
        return alerta;
      });

      // Si alguna alerta confirmada después de iniciar el GET no venía en esta página
      // (p. ej. estaba en otra página de "Todas"), también hay que descontarla del contador viejo.
      if (pendientesCrudos !== null && !todasMarcadasDespues) {
        for (const id of confirmadasPosteriores.keys()) {
          if (!idsVistos.has(id) && (filtroActual === 'todas' || hayMas)) {
            descontarPendientes += 1;
          }
        }
      }

      const alertasFiltradas =
        filtroActual === 'sin_leer' ? alertasReconciliadas.filter((alerta) => alerta.pendiente) : alertasReconciliadas;

      const pendientesReconciliados =
        pendientesCrudos === null
          ? 0
          : todasMarcadasDespues
            ? 0
            : Math.max(0, pendientesCrudos - descontarPendientes);

      return { alertas: alertasFiltradas, pendientes: pendientesReconciliados };
    },
    [],
  );

  useEffect(() => {
    sigueMontado.current = true;
    return () => {
      sigueMontado.current = false;
      numeroDeCarga.current += 1; // al salir de la pantalla, las respuestas pendientes se ignoran
    };
  }, []);

  /** `enSegundoPlano`: no vacía la pantalla ni la cambia por un error si falla (se usa para reconciliar). */
  const cargar = useCallback(
    async (opciones: { enSegundoPlano?: boolean } = {}) => {
      const { enSegundoPlano = false } = opciones;
      numeroDeCarga.current += 1;
      const miCarga = numeroDeCarga.current;
      const miEpoca = epocaMutacion.current;
      if (!enSegundoPlano) {
        setEstado({ tipo: 'cargando' });
        setMensajeError(null);
      }

      try {
        const [pagina, contador] = await Promise.all([api.getAlertas(consultaDe(filtro, 1)), api.getContadorAlertas()]);
        if (miCarga !== numeroDeCarga.current) return;
        const hayMas = pagina.next !== null;
        const { alertas, pendientes } = reconciliarInstantanea(pagina.results, contador.pendientes, hayMas, miEpoca);
        setEstado({
          tipo: 'listo',
          datos: { alertas, pendientes, pagina: 1, hayMas },
        });
      } catch {
        if (miCarga !== numeroDeCarga.current) return;
        // Una recarga en segundo plano que falla deja lo que ya se ve; si no había nada, muestra el error.
        setEstado((actual) => (enSegundoPlano && actual.tipo === 'listo' ? actual : { tipo: 'error' }));
      }
    },
    [api, filtro, reconciliarInstantanea],
  );

  // Al cambiar el filtro, `cargar` cambia y la lista se vuelve a pedir; la respuesta del filtro anterior se descarta.
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cargarMas = useCallback(async () => {
    if (masEnCurso.current || estado.tipo !== 'listo' || !estado.datos.hayMas) return;
    masEnCurso.current = true;
    setCargandoMas(true);
    setMensajeError(null);
    const miCarga = numeroDeCarga.current;
    const miEpoca = epocaMutacion.current;
    const paginaSiguiente = estado.datos.pagina + 1;
    try {
      const pagina = await api.getAlertas(consultaDe(filtro, paginaSiguiente));
      if (miCarga !== numeroDeCarga.current) return;
      const hayMas = pagina.next !== null;
      const { alertas: nuevasReconciliadas } = reconciliarInstantanea(pagina.results, null, hayMas, miEpoca);
      setEstado((actual) => {
        if (actual.tipo !== 'listo') return actual;
        // Si llegaron alertas nuevas mientras tanto, la página siguiente puede repetir alguna: no se duplica.
        const yaMostradas = new Set(actual.datos.alertas.map((alerta) => alerta.id));
        const nuevas = nuevasReconciliadas.filter((alerta) => !yaMostradas.has(alerta.id));
        return {
          tipo: 'listo',
          datos: {
            ...actual.datos,
            alertas: [...actual.datos.alertas, ...nuevas],
            pagina: paginaSiguiente,
            hayMas,
          },
        };
      });
    } catch {
      if (miCarga === numeroDeCarga.current) setMensajeError(MENSAJE_ERROR_VER_MAS);
    } finally {
      masEnCurso.current = false;
      if (sigueMontado.current) setCargandoMas(false);
    }
  }, [api, estado, filtro, reconciliarInstantanea]);

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
          const nuevaEpoca = ++epocaMutacion.current;
          leidasConfirmadas.current.set(id, { alerta: actualizada, epoca: nuevaEpoca });
          const filtroActual = filtroVigente.current;
          setEstado((actual) => {
            if (actual.tipo !== 'listo') return actual;
            const estabaPendiente = actual.datos.alertas.some((alerta) => alerta.id === id && alerta.pendiente);
            const alertas = actual.datos.alertas.map((alerta) => (alerta.id === id ? actualizada : alerta));
            return {
              tipo: 'listo',
              datos: {
                ...actual.datos,
                // Con el filtro vigente en "Sin leer", una alerta ya leída sale de la lista.
                alertas: filtroActual === 'sin_leer' ? alertas.filter((alerta) => alerta.pendiente) : alertas,
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
    [api],
  );

  const marcarTodasLeidas = useCallback(async () => {
    if (todasEnCurso.current) return;
    todasEnCurso.current = true;
    setMarcandoTodas(true);
    setMensajeError(null);
    try {
      await api.marcarTodasLasAlertasLeidas();
      if (sigueMontado.current) {
        const nuevaEpoca = ++epocaMutacion.current;
        epocaMarcarTodas.current = nuevaEpoca;
        // El backend dice cuántas cambió, pero no cuáles: se vuelve a pedir todo y se muestra lo que confirma.
        await cargar({ enSegundoPlano: true });
      }
    } catch {
      if (sigueMontado.current) setMensajeError(MENSAJE_ERROR_MARCAR_TODAS);
    } finally {
      todasEnCurso.current = false;
      if (sigueMontado.current) setMarcandoTodas(false);
    }
  }, [api, cargar]);

  return { estado, filtro, cambiarFiltro, idsMarcando, marcandoTodas, cargandoMas, mensajeError, cargar, cargarMas, marcarLeida, marcarTodasLeidas };
}
