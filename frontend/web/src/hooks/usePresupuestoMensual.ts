import {
  ErrorDeApi,
  getComparacionDePresupuesto,
  guardarPresupuesto,
  type ComparacionDePresupuesto,
} from '@ojoalgasto/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

export const MENSAJE_ERROR_AL_CARGAR_PRESUPUESTO = 'No pudimos cargar tu presupuesto. Intenta de nuevo.';
export const MENSAJE_ERROR_AL_GUARDAR_PRESUPUESTO = 'No pudimos guardar tu presupuesto. Inténtalo de nuevo.';
export const MENSAJE_SIN_PERMISO_PARA_GUARDAR = 'No tienes permiso para guardar el presupuesto de esta organización.';

const ESTADO_HTTP_SIN_PERMISO = 403;
const ESTADO_HTTP_DATOS_INVALIDOS = 400;

export type CargaDePresupuesto =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; comparacion: ComparacionDePresupuesto };

/** El formulario del monto: cerrado, abierto (con el error del último intento, si lo hubo) o guardando. */
export type EdicionDePresupuesto = { tipo: 'cerrada' } | { tipo: 'abierta'; error: string | null } | { tipo: 'guardando' };

/** Lo que pasa con el formulario en UN mes y UNA moneda. Cambia de mes o de moneda y empieza de cero. */
interface PanelDelPresupuesto {
  pedido: string;
  edicion: EdicionDePresupuesto;
  /** El monto que el servidor confirmó en el último guardado de este mes y moneda. */
  montoGuardado: string | null;
}

const panelCerrado = (pedido: string): PanelDelPresupuesto => ({ pedido, edicion: { tipo: 'cerrada' }, montoGuardado: null });

/** El mensaje que ve la persona cuando guardar falla: el del servidor si es de validación, y si no uno claro. */
function mensajeAlGuardar(error: unknown): string {
  if (error instanceof TypeError) return MENSAJE_SIN_RED;
  if (error instanceof ErrorDeApi) {
    if (error.status === ESTADO_HTTP_SIN_PERMISO) return MENSAJE_SIN_PERMISO_PARA_GUARDAR;
    if (error.status === ESTADO_HTTP_DATOS_INVALIDOS) {
      const mensajeDelCampo = error.campos?.monto?.[0] ?? error.campos?.moneda?.[0] ?? error.campos?.mes?.[0];
      if (mensajeDelCampo !== undefined) return mensajeDelCampo;
    }
  }
  return MENSAJE_ERROR_AL_GUARDAR_PRESUPUESTO;
}

/**
 * S3-CH-27: el presupuesto de UN mes en UNA moneda frente al gasto, y su edición (VI-05).
 *
 * - La comparación la calcula el servidor con todos los cobros y suscripciones de la
 *   organización: aquí no se suma ni se compara nada. Un error de consulta es un error, no un
 *   gasto de 0 ni un mes sin presupuesto.
 * - Al cambiar de mes o de moneda nunca queda a la vista lo del anterior: el resultado se
 *   guarda junto a lo que se pidió, y si no es lo pedido ahora se trata como "cargando".
 * - No se puede editar sin ver antes lo que hay guardado: guardar reemplaza el presupuesto, y
 *   hacerlo a ciegas pisaría uno que no se alcanzó a leer.
 * - Al guardar se vuelve a pedir la comparación al servidor, en vez de armarla aquí.
 * - Una respuesta tardía de lo que ya se dejó (otro mes, otra moneda, otra sesión) se descarta.
 */
export function usePresupuestoMensual(mes: string, moneda: string) {
  const { capturarSesion } = useAuth();
  // La sesión con la que se montó la sección. Si cambia, lo que llegue después es de otra sesión.
  const [sesion] = useState(capturarSesion);
  const pedido = JSON.stringify([mes, moneda]);
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState<{ pedido: string; carga: CargaDePresupuesto } | null>(null);
  const [panel, setPanel] = useState<PanelDelPresupuesto>(() => panelCerrado(pedido));
  const pedidoVigente = useRef(pedido);
  const pedidoGuardandose = useRef<string | null>(null);

  useEffect(() => {
    pedidoVigente.current = pedido;
    // Otro mes u otra moneda: el formulario y el aviso de guardado de los anteriores no se quedan.
    setPanel((anterior) => (anterior.pedido === pedido ? anterior : panelCerrado(pedido)));
  }, [pedido]);

  useEffect(() => {
    let vigente = true;
    const sigueVigente = () => vigente && capturarSesion() === sesion;
    setResultado({ pedido, carga: { tipo: 'cargando' } });
    getComparacionDePresupuesto(mes, moneda)
      .then((comparacion) => {
        if (sigueVigente()) setResultado({ pedido, carga: { tipo: 'listo', comparacion } });
      })
      .catch((error: unknown) => {
        if (!sigueVigente()) return;
        const mensaje = error instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR_AL_CARGAR_PRESUPUESTO;
        setResultado({ pedido, carga: { tipo: 'error', mensaje } });
      });
    return () => {
      vigente = false;
    };
  }, [mes, moneda, pedido, intento, capturarSesion, sesion]);

  const carga: CargaDePresupuesto = resultado?.pedido === pedido ? resultado.carga : { tipo: 'cargando' };
  const panelActual = panel.pedido === pedido ? panel : panelCerrado(pedido);

  const reintentar = useCallback(() => setIntento((anterior) => anterior + 1), []);

  const abrirEdicion = useCallback(() => {
    if (carga.tipo !== 'listo') return;
    setPanel({ pedido, edicion: { tipo: 'abierta', error: null }, montoGuardado: null });
  }, [carga.tipo, pedido]);

  const cancelarEdicion = useCallback(() => {
    setPanel((anterior) =>
      anterior.pedido !== pedido || anterior.edicion.tipo === 'guardando' ? anterior : { ...anterior, edicion: { tipo: 'cerrada' } },
    );
  }, [pedido]);

  /** `monto` ya viene leído y validado (texto decimal con punto). Con el mismo mes y moneda guarda de a uno. */
  const guardar = useCallback(
    async (monto: string) => {
      if (pedidoGuardandose.current === pedido) return;
      pedidoGuardandose.current = pedido;
      const esDeEstaVista = () => capturarSesion() === sesion && pedidoVigente.current === pedido;
      setPanel({ pedido, edicion: { tipo: 'guardando' }, montoGuardado: null });
      try {
        const guardado = await guardarPresupuesto({ mes, moneda, monto });
        if (!esDeEstaVista()) return;
        setPanel({ pedido, edicion: { tipo: 'cerrada' }, montoGuardado: guardado.monto });
        setIntento((anterior) => anterior + 1);
      } catch (error: unknown) {
        if (!esDeEstaVista()) return;
        setPanel({ pedido, edicion: { tipo: 'abierta', error: mensajeAlGuardar(error) }, montoGuardado: null });
      } finally {
        if (pedidoGuardandose.current === pedido) pedidoGuardandose.current = null;
      }
    },
    [mes, moneda, pedido, capturarSesion, sesion],
  );

  return {
    carga,
    reintentar,
    edicion: panelActual.edicion,
    montoGuardado: panelActual.montoGuardado,
    abrirEdicion,
    cancelarEdicion,
    guardar,
  };
}
