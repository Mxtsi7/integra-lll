import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelarContratacion,
  ErrorDeApi,
  getContratacion,
  getPermisosPlan,
  getPlanes,
  iniciarContratacion,
  type ContratacionPlan,
  type EstadoCarga,
  type PermisosPlan,
  type PlanDisponible,
} from '@ojoalgasto/shared';
import type { AlmacenIntento } from './almacenIntento';
import {
  AvisoDeContratacion,
  crearClaveIdempotencia,
  esUrlCheckoutValida,
  leerPermisos,
  mensajeDeErrorDeContratacion,
  MENSAJE_CHECKOUT_INSEGURO,
  MENSAJE_NO_RECUPERO_PENDIENTE,
  MENSAJE_NO_SE_PUDO_ABRIR,
  MENSAJE_PENDIENTE_NO_RECUPERABLE,
} from './reglasPlanes';

/** Las llamadas al backend. Se reemplazan en las pruebas. */
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
 * - Un doble toque no manda dos peticiones (`operacionEnCurso`).
 * - Las respuestas que llegan después de salir de la pantalla se ignoran.
 *
 * El intento sobrevive a la pantalla (`almacen`):
 * - La clave se guarda ANTES de pedir la contratación. Si la respuesta se pierde, al volver a
 *   contratar se manda la misma clave y el servidor devuelve la contratación ya creada.
 * - Cuando se conoce el id, también se guarda. Al reabrir Planes se vuelve a consultar y se
 *   restauran «Verificar estado» y «Cancelar».
 * - Todo se borra cuando la contratación termina (exitosa, cancelada o fallida): el siguiente
 *   intento usa una clave nueva. Lo guardado es propio de cada persona y organización.
 */
export function usePlanes(
  abrirUrl: (url: string) => Promise<unknown>,
  api: ApiPlanes = API_REAL,
  almacen: AlmacenIntento | null = null,
) {
  const [estado, setEstado] = useState<EstadoCarga<DatosPlanes>>({ tipo: 'cargando' });
  const [contrato, setContrato] = useState<ContratacionPlan | null>(null);
  /** Hay una contratación pendiente conocida por su id, pero todavía no se pudo cargar. */
  const [idSinCargar, setIdSinCargar] = useState<string | null>(null);
  const [operacion, setOperacion] = useState<Operacion>(null);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const numeroDeCarga = useRef(0);
  const sigueMontado = useRef(true);
  const operacionEnCurso = useRef(false);
  const claveActual = useRef<string | null>(null);
  /** Termina cuando se restauró el intento guardado. Las acciones esperan a que termine. */
  const restauracion = useRef<Promise<void>>(Promise.resolve());

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

  /** La contratación terminó: se olvida el intento para que el próximo sea uno nuevo. */
  const cerrarIntento = useCallback(async () => {
    claveActual.current = null;
    if (sigueMontado.current) setIdSinCargar(null);
    await almacen?.borrar();
  }, [almacen]);

  /** Aplica lo que el servidor dice de la contratación. Si ya terminó, cierra el intento. */
  const aplicarContrato = useCallback(
    async (actual: ContratacionPlan) => {
      if (sigueMontado.current) {
        setContrato(actual);
        setIdSinCargar(null);
      }
      if (actual.estado !== 'pendiente') await cerrarIntento();
    },
    [cerrarIntento],
  );

  // Carga inicial y restauración del intento guardado (también si cambia la persona: otro `almacen`).
  useEffect(() => {
    sigueMontado.current = true;
    claveActual.current = null;
    setContrato(null);
    setIdSinCargar(null);
    void cargar();

    let vigente = true;
    restauracion.current = (async () => {
      const guardado = await almacen?.leer();
      if (!guardado || !vigente) return;
      claveActual.current = guardado.clave;
      if (!guardado.contratoId) return; // respuesta perdida: se resuelve al volver a contratar con la misma clave
      try {
        const recuperado = await api.getContratacion(guardado.contratoId);
        if (vigente) await aplicarContrato(recuperado);
      } catch (error) {
        if (!vigente) return;
        if (error instanceof ErrorDeApi && error.status === 404) {
          await cerrarIntento(); // no existe para esta organización: no hay nada que recuperar
        } else {
          // Sin red u otro fallo: se conserva lo guardado y se ofrece volver a intentarlo.
          setIdSinCargar(guardado.contratoId);
          setMensajeError(MENSAJE_NO_RECUPERO_PENDIENTE);
        }
      }
    })();

    return () => {
      vigente = false;
      sigueMontado.current = false;
      numeroDeCarga.current += 1;
    };
  }, [cargar, almacen, api, aplicarContrato, cerrarIntento]);

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
      await restauracion.current; // primero se termina de recuperar el intento guardado
      await trabajo();
    } catch (error) {
      if (sigueMontado.current) setMensajeError(mensajeDeErrorDeContratacion(error));
    } finally {
      operacionEnCurso.current = false;
      if (sigueMontado.current) setOperacion(null);
    }
  }, []);

  const idPendiente = contrato?.estado === 'pendiente' ? contrato.id : idSinCargar;

  const contratar = useCallback(
    () =>
      ejecutar('iniciando', async () => {
        claveActual.current ??= crearClaveIdempotencia();
        const clave = claveActual.current;
        // Se guarda ANTES de pedir: si la respuesta se pierde, el reintento usa esta misma clave.
        await almacen?.guardar({ clave, contratoId: null });

        let nuevo: ContratacionPlan;
        try {
          nuevo = await api.iniciarContratacion(clave);
        } catch (error) {
          if (error instanceof ErrorDeApi && error.status === 409 && !idPendiente) {
            throw new AvisoDeContratacion(MENSAJE_PENDIENTE_NO_RECUPERABLE);
          }
          throw error;
        }
        await almacen?.guardar({ clave, contratoId: nuevo.id });
        await aplicarContrato(nuevo);
        if (!sigueMontado.current) return;

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
    [api, abrirUrl, almacen, aplicarContrato, ejecutar, idPendiente, releerPermisos],
  );

  /** Consulta cómo va la contratación y vuelve a leer el plan. Sin contratación, solo relee el plan. */
  const verificar = useCallback(
    () =>
      ejecutar('verificando', async () => {
        if (idPendiente) await aplicarContrato(await api.getContratacion(idPendiente));
        await releerPermisos();
      }),
    [api, aplicarContrato, ejecutar, idPendiente, releerPermisos],
  );

  const cancelar = useCallback(
    () =>
      ejecutar('cancelando', async () => {
        if (!idPendiente) return;
        await aplicarContrato(await api.cancelarContratacion(idPendiente));
        await releerPermisos();
      }),
    [api, aplicarContrato, ejecutar, idPendiente, releerPermisos],
  );

  return { estado, contrato, idSinCargar, operacion, mensajeError, cargar, contratar, verificar, cancelar, releerPermisos };
}
