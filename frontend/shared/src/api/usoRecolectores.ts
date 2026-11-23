import { obtenerAccessToken, sesionDelToken } from '../auth';
import type { AcuseUso, PendienteUso } from '../contracts/uso-recolectores.dto';
import { pedir } from './cliente';

const TIMEOUT_ENVIO_MS = 10000;

export class ErrorSincronizacionUso extends Error {
  constructor(readonly codigo: 'sesion_no_identificable' | 'sesion_cambiada' | 'acuse_invalido') {
    super(codigo);
  }
}

export interface UltimoEnvioConfirmado {
  readonly sesionId: string;
  readonly suscripcionId: string;
  readonly recolectorId: string;
  readonly eventId: string;
  /** Hora de recepción del servidor, no el reloj local. */
  readonly recibidoEn: string;
}

export type GuardarUltimoEnvio = (acuse: UltimoEnvioConfirmado) => Promise<void>;

function fechaUtcValida(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(valor);
  if (!partes) return false;
  const [, anio, mes, dia, hora, minuto, segundo] = partes;
  const fecha = new Date(valor);
  return !Number.isNaN(fecha.getTime()) &&
    fecha.getUTCFullYear() === Number(anio) &&
    fecha.getUTCMonth() + 1 === Number(mes) &&
    fecha.getUTCDate() === Number(dia) &&
    fecha.getUTCHours() === Number(hora) &&
    fecha.getUTCMinutes() === Number(minuto) &&
    fecha.getUTCSeconds() === Number(segundo);
}

function esAcuseValido(valor: unknown, pendiente: PendienteUso): valor is AcuseUso {
  if (valor === null || typeof valor !== 'object') return false;
  const acuse = valor as Partial<AcuseUso>;
  return typeof acuse.event_id === 'string' && acuse.event_id.toLowerCase() === pendiente.evento.event_id.toLowerCase() &&
    typeof acuse.suscripcion_id === 'string' && acuse.suscripcion_id.toLowerCase() === pendiente.suscripcion_id.toLowerCase() &&
    (acuse.estado === 'aceptado' || acuse.estado === 'duplicado') &&
    fechaUtcValida(acuse.recibido_en);
}

/** Envía un hecho por el cliente HTTP autenticado y guarda sincronización tras un acuse válido. */
export async function enviarUsoPendiente(
  pendiente: PendienteUso,
  guardarUltimoEnvio: GuardarUltimoEnvio,
  opciones: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AcuseUso> {
  const tokenInicial = obtenerAccessToken();
  const sesionId = tokenInicial ? sesionDelToken(tokenInicial) : null;
  if (!sesionId) throw new ErrorSincronizacionUso('sesion_no_identificable');

  const tiempoEsperaMs = opciones.timeoutMs ?? TIMEOUT_ENVIO_MS;
  if (!Number.isSafeInteger(tiempoEsperaMs) || tiempoEsperaMs <= 0 || tiempoEsperaMs > TIMEOUT_ENVIO_MS) {
    throw new RangeError('El timeout debe estar entre 1 y 10000 ms.');
  }

  const controlador = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const cancelar = () => controlador.abort(opciones.signal?.reason);
  if (opciones.signal?.aborted) cancelar();
  else opciones.signal?.addEventListener('abort', cancelar, { once: true });
  temporizador = setTimeout(() => {
    const errorTiempoEspera = new Error('Tiempo de espera agotado');
    errorTiempoEspera.name = 'TimeoutError';
    controlador.abort(errorTiempoEspera);
  }, tiempoEsperaMs);

  try {
    const solicitud = pedir<AcuseUso>(
      `/suscripciones/${encodeURIComponent(pendiente.suscripcion_id)}/uso/recolector/`,
      { method: 'POST', body: pendiente.evento, signal: controlador.signal },
    );
    let alAbortar: () => void;
    const cancelacion = new Promise<never>((_resolver, rechazar) => {
      alAbortar = () => rechazar(controlador.signal.reason ?? new Error('Solicitud cancelada.'));
      controlador.signal.addEventListener('abort', alAbortar, { once: true });
      if (controlador.signal.aborted) alAbortar();
    });
    let respuesta: AcuseUso;
    try {
      respuesta = await Promise.race([solicitud, cancelacion]);
    } finally {
      controlador.signal.removeEventListener('abort', alAbortar!);
    }
    const tokenActual = obtenerAccessToken();
    if (!tokenActual || sesionDelToken(tokenActual) !== sesionId) {
      throw new ErrorSincronizacionUso('sesion_cambiada');
    }
    if (!esAcuseValido(respuesta, pendiente)) {
      throw new ErrorSincronizacionUso('acuse_invalido');
    }

    // El callback debe guardar por sesionId+recolectorId+suscripcionId para
    // que una respuesta tardía de A jamás reemplace el estado de B.
    await guardarUltimoEnvio({
      sesionId,
      suscripcionId: pendiente.suscripcion_id,
      recolectorId: pendiente.evento.recolector_id.toLowerCase(),
      eventId: respuesta.event_id,
      recibidoEn: respuesta.recibido_en,
    });
    const tokenDespuesDeGuardar = obtenerAccessToken();
    if (!tokenDespuesDeGuardar || sesionDelToken(tokenDespuesDeGuardar) !== sesionId) {
      throw new ErrorSincronizacionUso('sesion_cambiada');
    }
    return respuesta;
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
    opciones.signal?.removeEventListener('abort', cancelar);
  }
}
