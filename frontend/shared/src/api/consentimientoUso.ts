import { obtenerAccessToken, sesionDelToken } from '../auth';
import type { OrigenRecolector } from '../contracts/uso-recolectores.dto';
import { pedir } from './cliente';

export type AccionConsentimientoUso = 'aceptar' | 'pausar' | 'reanudar' | 'revocar';
export interface ConsentimientoUso {
  recolector_id: string;
  origen: OrigenRecolector;
  estado: 'activo' | 'pausado' | 'revocado';
  version_texto: 'uso-v1';
  desde: string | null;
  actualizado_en: string;
  servidor_ahora: string;
  zona_horaria: string;
}

function sesion() {
  const token = obtenerAccessToken();
  return token ? sesionDelToken(token) : null;
}

export async function cambiarConsentimientoUso(opciones: {
  suscripcionId: string; recolectorId: string; origen: OrigenRecolector;
  accion: AccionConsentimientoUso; signal?: AbortSignal;
}): Promise<ConsentimientoUso> {
  const inicial = sesion();
  if (!inicial) throw new Error('Falta una sesión identificable.');
  const respuesta = await pedir<ConsentimientoUso>(
    `/suscripciones/${encodeURIComponent(opciones.suscripcionId)}/uso/consentimiento/`, {
      method: 'POST', signal: opciones.signal,
      body: { recolector_id: opciones.recolectorId, origen: opciones.origen,
        accion: opciones.accion, version_texto: 'uso-v1' },
    });
  if (sesion() !== inicial) throw new Error('La sesión cambió durante el consentimiento.');
  const estado = { aceptar: 'activo', pausar: 'pausado', reanudar: 'activo', revocar: 'revocado' }[opciones.accion];
  if (respuesta?.recolector_id?.toLowerCase() !== opciones.recolectorId.toLowerCase() ||
      respuesta.origen !== opciones.origen || respuesta.estado !== estado || respuesta.version_texto !== 'uso-v1' ||
      !Number.isFinite(Date.parse(respuesta.servidor_ahora)) ||
      (estado !== 'revocado' && !Number.isFinite(Date.parse(respuesta.desde ?? '')))) {
    throw new Error('Respuesta de consentimiento inválida');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: respuesta.zona_horaria }); }
  catch { throw new Error('Zona de informe inválida'); }
  return respuesta;
}
