import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelarContratacion,
  getContratacion,
  getPermisosPlan,
  getPlanes,
  iniciarContratacion,
  type ContratacionPlan,
  type EstadoCarga,
  type PermisosPlan,
  type PlanDisponible,
} from '@ojoalgasto/shared';
import {
  crearClaveIdempotencia,
  esUrlCheckoutValida,
  leerPermisos,
  mensajeDeErrorDeContratacion,
  MENSAJE_CHECKOUT_INSEGURO,
  MENSAJE_NO_SE_PUDO_ABRIR,
} from './reglasPlanes';

/** Las llamadas al backend y la forma de abrir el pago. Se reemplazan en las pruebas. */
export interface ApiPlanes {
  getPlanes: typeof getPlanes;
  getPermisosPlan: typeof getPermisosPlan;
  iniciarContratacion: typeof iniciarContratacion;
  getContratacion: typeof getContratacion;
  cancelarContratacion: typeof cancelarContratacion;
}

const API_REAL: ApiPlanes = { getPlanes, getPermisosPlan, iniciarContratacion, getContratacion, cancelarContratacion };

export interface DatosPlanes {
  planes: PlanDisponible[];
  permisos: PermisosPlan;
}

type Operacion = 'iniciando' | 'verificando' | 'cancelando' | null;

/**
 * Planes y contratación Premium (AN-08).
 *
 * Reglas que protegen a la persona:
 * - Premium se muestra solo cuando `/usuarios/me/permisos/` lo dice. El estado de la contratación
 *   ("exitosa") o el hecho de haber vuelto del pago no conceden nada por sí solos.
 * - Tras contratar, verificar o cancelar se vuelven a leer los permisos al servidor.
 * - Un reintento de contratación usa la misma clave, así no se duplica; cuando la contratación
 *   termina, la clave se descarta y el siguiente intento es uno nuevo.
 * - Un doble toque no manda dos peticiones (`operacionEnCurso`).
 * - Las respuestas que llegan después de salir de la pantalla se ignoran.
 */
export function usePlanes(abrirUrl: (url: string) => Promise<unknown>, api: ApiPlanes = API_REAL) {
  const [estado, setEstado] = useState<EstadoCarga<DatosPlanes>>({ tipo: 'cargando' });
  const [contrato, setContrato] = useState<ContratacionPlan | null>(null);
  const [operacion, setOperacion] = useState<Operacion>(null);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const numeroDeCarga = useRef(0);
  const sigueMontado = useRef(true);
  const operacionEnCurso = useRef(false);
  const claveActual = useRef<string | null>(null);

  const cargar = useCallback(async () => {
    numeroDeCarga.current += 1;
    const miCarga = numeroDeCarga.current;
    setEstado({ tipo: 'cargando' });
    try {
      const [planes, respuestaPermisos] = await Promise.all([api.getPlanes(), api.getPermisosPlan()]);
      if (miCarga !== numeroDeCarga.current) return;
      const permisos = leerPermisos(respuestaPermisos);
      setEstado(Array.isArray(planes) && permisos ? { tipo: 'listo', datos: { planes, permisos } } : { tipo: 'error' });
    } catch {
      if (miCarga !== numeroDeCarga.current) return;
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

  /** Vuelve a leer solo los permisos y los deja en pantalla. Si falla, no toca lo que ya se ve. */
  const releerPermisos = useCallback(async () => {
    const permisos = leerPermisos(await api.getPermisosPlan());
    if (!permisos || !sigueMontado.current) return;
    setEstado((actual) => (actual.tipo === 'listo' ? { tipo: 'listo', datos: { ...actual.datos, permisos } } : actual));
  }, [api]);

  /** Corre una operación con candado y manejo de error común. */
  const ejecutar = useCallback(async (nombre: Exclude<Operacion, null>, trabajo: () => Promise<void>) => {
    if (operacionEnCurso.current) return;
    operacionEnCurso.current = true;
    setOperacion(nombre);
    setMensajeError(null);
    try {
      await trabajo();
    } catch (error) {
      if (sigueMontado.current) setMensajeError(mensajeDeErrorDeContratacion(error));
    } finally {
      operacionEnCurso.current = false;
      if (sigueMontado.current) setOperacion(null);
    }
  }, []);

  const contratar = useCallback(
    () =>
      ejecutar('iniciando', async () => {
        claveActual.current ??= crearClaveIdempotencia();
        const nuevo = await api.iniciarContratacion(claveActual.current);
        claveActual.current = null; // ya hay contratación: el próximo intento es uno nuevo
        if (!sigueMontado.current) return;
        setContrato(nuevo);

        if (nuevo.estado === 'pendiente') {
          if (!esUrlCheckoutValida(nuevo.url_checkout)) {
            setMensajeError(MENSAJE_CHECKOUT_INSEGURO);
            return;
          }
          try {
            await abrirUrl(nuevo.url_checkout);
          } catch {
            if (sigueMontado.current) setMensajeError(MENSAJE_NO_SE_PUDO_ABRIR);
          }
        } else {
          await releerPermisos(); // una contratación ya terminada: lo que vale es el servidor
        }
      }),
    [api, abrirUrl, ejecutar, releerPermisos],
  );

  /** Consulta cómo va la contratación y vuelve a leer el plan. Sin contratación, solo relee el plan. */
  const verificar = useCallback(
    () =>
      ejecutar('verificando', async () => {
        if (contrato) {
          const actualizado = await api.getContratacion(contrato.id);
          if (sigueMontado.current) setContrato(actualizado);
        }
        await releerPermisos();
      }),
    [api, contrato, ejecutar, releerPermisos],
  );

  const cancelar = useCallback(
    () =>
      ejecutar('cancelando', async () => {
        if (!contrato) return;
        const actualizado = await api.cancelarContratacion(contrato.id);
        if (sigueMontado.current) setContrato(actualizado);
        await releerPermisos();
      }),
    [api, contrato, ejecutar, releerPermisos],
  );

  return { estado, contrato, operacion, mensajeError, cargar, contratar, verificar, cancelar };
}
