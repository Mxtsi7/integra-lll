import {
  cancelarContratacion,
  ErrorDeApi,
  getContratacion,
  getPlanes,
  iniciarContratacion,
  type ContratacionPlan,
} from '@ojoalgasto/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { crearAlmacenIntento } from '../components/Planes/almacenIntentoContratacion';
import {
  crearClaveIdempotencia,
  esUrlCheckoutValida,
  MENSAJE_CHECKOUT_INSEGURO,
  MENSAJE_NO_RECUPERO_PENDIENTE,
  MENSAJE_PENDIENTE_NO_RECUPERABLE,
  mensajeDeErrorDeContratacion,
} from '../components/Planes/reglasContratacion';
import { useAuth } from '../context/AuthContext';

export type OperacionContratacion = 'iniciando' | 'continuando' | 'verificando' | 'cancelando' | null;

export interface OpcionesContratacion {
  /** Manda a la persona al pago. Por defecto, en la misma pestaña: el pago vuelve a /planes/retorno. */
  irAlCheckout?: (url: string) => void;
  /** Se llama cuando el plan puede haber cambiado, para volver a leerlo del servidor. */
  alPlanCambiar?: () => void;
}

const irAlCheckoutPorDefecto = (url: string) => window.location.assign(url);

/**
 * Contratación Premium desde la web (AN-08 en versión web).
 *
 * Reglas que protegen a la persona:
 * - Quien confirma el plan es el servidor. Que la contratación diga "exitosa" o que la persona
 *   haya vuelto del pago no concede nada por sí solo: después de cada acción se vuelve a leer el plan.
 * - Un doble clic no manda dos peticiones.
 * - La clave de idempotencia se guarda antes de pedir la contratación. Si la respuesta se pierde,
 *   el reintento manda la misma clave y no se cobra dos veces.
 * - Una respuesta que llega cuando ya cambió la sesión se descarta.
 */
export function useContratacionPremium({
  irAlCheckout = irAlCheckoutPorDefecto,
  alPlanCambiar,
}: OpcionesContratacion = {}) {
  const { usuario, capturarSesion } = useAuth();
  const alcance = usuario ? `${usuario.id}:${usuario.organizacion_id}` : null;
  const almacen = useMemo(() => (alcance ? crearAlmacenIntento(alcance) : null), [alcance]);

  const [contrato, setContrato] = useState<ContratacionPlan | null>(null);
  /** Hay una contratación pendiente que se conoce por su id, pero aún no se pudo cargar. */
  const [idSinCargar, setIdSinCargar] = useState<string | null>(null);
  const [operacion, setOperacion] = useState<OperacionContratacion>(null);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  /** Si el plan Premium es de demostración. Null mientras se consulta o si no se pudo leer: no se afirma nada. */
  const [precioDemo, setPrecioDemo] = useState<boolean | null>(null);
  const claveActual = useRef<string | null>(null);
  const enCurso = useRef(false);
  const montado = useRef(true);
  /** Termina cuando se recuperó el intento guardado. Las acciones esperan a que termine. */
  const restauracion = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // El plan es el mismo para todas las personas: no depende de la sesión.
  useEffect(() => {
    let vigente = true;
    getPlanes()
      .then((planes) => {
        const premium = Array.isArray(planes) ? planes.find((plan) => plan.codigo === 'premium') : undefined;
        if (vigente && premium) setPrecioDemo(premium.precio_demo);
      })
      .catch(() => {
        /* sin el dato, la pantalla no afirma nada sobre el cobro */
      });
    return () => {
      vigente = false;
    };
  }, []);

  const sigueVigente = useCallback(
    (marca: ReturnType<typeof capturarSesion>) => montado.current && capturarSesion() === marca,
    [capturarSesion],
  );

  /** Aplica lo que el servidor dice. Si la contratación ya terminó, se olvida el intento guardado. */
  const aplicar = useCallback(
    (actual: ContratacionPlan) => {
      if (!montado.current) return;
      setContrato(actual);
      setIdSinCargar(null);
      if (actual.estado !== 'pendiente') {
        claveActual.current = null;
        almacen?.borrar();
      }
    },
    [almacen],
  );

  // Al entrar (o si cambia la persona) se recupera la contratación pendiente que se guardó en este navegador.
  useEffect(() => {
    let vigente = true;
    setContrato(null);
    setIdSinCargar(null);
    const guardado = almacen?.leer() ?? null;
    claveActual.current = guardado?.clave ?? null;
    restauracion.current = (async () => {
      if (!guardado?.contratoId) return; // la respuesta se perdió: se resuelve al volver a contratar con la misma clave
      try {
        const recuperado = await getContratacion(guardado.contratoId);
        if (vigente) aplicar(recuperado);
      } catch (error) {
        if (!vigente || !montado.current) return;
        if (error instanceof ErrorDeApi && error.status === 404) {
          claveActual.current = null; // no existe para esta organización: no hay nada que recuperar
          almacen?.borrar();
        } else {
          // Fallo temporal: se conserva lo guardado y se ofrece verificarla de nuevo.
          setIdSinCargar(guardado.contratoId);
          setMensajeError(MENSAJE_NO_RECUPERO_PENDIENTE);
        }
      }
    })();
    return () => {
      vigente = false;
    };
  }, [almacen, aplicar]);

  /** Corre una operación con candado y manejo de error común. La sesión se captura al empezar. */
  const ejecutar = useCallback(
    async (nombre: Exclude<OperacionContratacion, null>, trabajo: (marca: ReturnType<typeof capturarSesion>) => Promise<void>) => {
      if (enCurso.current) return;
      const marca = capturarSesion();
      enCurso.current = true;
      setOperacion(nombre);
      setMensajeError(null);
      try {
        await restauracion.current;
        await trabajo(marca);
      } catch (error) {
        if (montado.current) setMensajeError(mensajeDeErrorDeContratacion(error));
      } finally {
        enCurso.current = false;
        if (montado.current) setOperacion(null);
      }
    },
    [capturarSesion],
  );

  const idPendiente = contrato?.estado === 'pendiente' ? contrato.id : idSinCargar;

  const contratar = useCallback(
    () =>
      ejecutar('iniciando', async (marca) => {
        claveActual.current ??= crearClaveIdempotencia();
        const clave = claveActual.current;
        // Se guarda ANTES de pedir: si la respuesta se pierde, el reintento manda esta misma clave.
        almacen?.guardar({ clave, contratoId: null });

        let nuevo: ContratacionPlan;
        try {
          nuevo = await iniciarContratacion(clave);
        } catch (error) {
          if (error instanceof ErrorDeApi && error.status === 409 && !idPendiente) {
            setMensajeError(MENSAJE_PENDIENTE_NO_RECUPERABLE);
            return;
          }
          throw error;
        }
        if (!sigueVigente(marca)) return;

        almacen?.guardar({ clave, contratoId: nuevo.id });
        aplicar(nuevo);
        if (nuevo.estado !== 'pendiente') {
          alPlanCambiar?.();
          return;
        }
        if (!esUrlCheckoutValida(nuevo.url_checkout)) {
          setMensajeError(MENSAJE_CHECKOUT_INSEGURO);
          return;
        }
        irAlCheckout(nuevo.url_checkout);
      }),
    [aplicar, almacen, alPlanCambiar, ejecutar, idPendiente, irAlCheckout, sigueVigente],
  );

  /**
   * Vuelve a la pantalla de pago de la contratación pendiente. Se pide la contratación de nuevo porque
   * la dirección del pago caduca: así se usa una vigente, sin crear otra contratación.
   */
  const continuarPago = useCallback(
    () =>
      ejecutar('continuando', async (marca) => {
        if (!idPendiente) return;
        const actual = await getContratacion(idPendiente);
        if (!sigueVigente(marca)) return;
        aplicar(actual);
        if (actual.estado !== 'pendiente') {
          alPlanCambiar?.();
          return;
        }
        if (!esUrlCheckoutValida(actual.url_checkout)) {
          setMensajeError(MENSAJE_CHECKOUT_INSEGURO);
          return;
        }
        irAlCheckout(actual.url_checkout);
      }),
    [aplicar, alPlanCambiar, ejecutar, idPendiente, irAlCheckout, sigueVigente],
  );

  /** Consulta cómo va la contratación pendiente y vuelve a leer el plan. */
  const verificar = useCallback(
    () =>
      ejecutar('verificando', async (marca) => {
        if (idPendiente) {
          const actual = await getContratacion(idPendiente);
          if (!sigueVigente(marca)) return;
          aplicar(actual);
        }
        alPlanCambiar?.();
      }),
    [aplicar, alPlanCambiar, ejecutar, idPendiente, sigueVigente],
  );

  const cancelar = useCallback(
    () =>
      ejecutar('cancelando', async (marca) => {
        if (!idPendiente) return;
        const actual = await cancelarContratacion(idPendiente);
        if (!sigueVigente(marca)) return;
        aplicar(actual);
        alPlanCambiar?.();
      }),
    [aplicar, alPlanCambiar, ejecutar, idPendiente, sigueVigente],
  );

  return { contrato, idSinCargar, operacion, mensajeError, precioDemo, contratar, continuarPago, verificar, cancelar };
}
