import { dominioAutorizado } from './dominio.js';
import { avanzarMedicion } from './medicion.js';

export const UMBRAL_INACTIVIDAD_SEGUNDOS = 60;

async function leerActividad(api, dominios) {
  const ventana = await api.windows.getLastFocused();
  const actividad = await api.idle.queryState(UMBRAL_INACTIVIDAD_SEGUNDOS);
  if (actividad === 'locked') return { dominio: null, estado: 'bloqueado' };
  if (!ventana.focused) return { dominio: null, estado: 'sin_foco' };
  if (actividad !== 'active') return { dominio: null, estado: 'inactivo' };
  const [pestana] = await api.tabs.query({ active: true, windowId: ventana.id });
  const dominio = !pestana?.incognito ? dominioAutorizado(pestana?.url, dominios) : null;
  if (!dominio) return { dominio: null, estado: 'sin_dominio_autorizado' };
  const tienePermiso = await api.permissions.contains({ origins: [`https://${dominio}/*`] });
  return tienePermiso ? { dominio, estado: 'activo' } : { dominio: null, estado: 'sin_permiso' };
}

export async function observar(api, { estado: pausa, observadoEn = Date.now() } = {}) {
  const { configuracion } = await api.storage.session.get('configuracion');
  let dominio = null;
  let estado = 'sin_consentimiento';
  if (configuracion?.consentimiento) {
    if (pausa) estado = pausa;
    else ({ dominio, estado } = await leerActividad(api, configuracion.dominios));
  }
  const { configuracion: vigente } = await api.storage.session.get('configuracion');
  if (vigente?.id !== configuracion?.id || !vigente?.consentimiento) {
    dominio = null;
    estado = 'sin_consentimiento';
  }
  const observacion = { dominio, estado, observadoEn, sesionId: vigente?.sesionId ?? vigente?.id,
    suscripcionId: dominio ? vigente?.asociaciones?.[dominio] ?? null : null };
  const { medicion: anterior } = await api.storage.session.get('medicion');
  const medicion = avanzarMedicion(anterior, observacion);
  if (medicion.limiteAlcanzado) observacion.estado = 'limite_de_sesion';
  await api.storage.session.set({ observacion, medicion });
}

export async function registrarError(api, observadoEn = Date.now()) {
  const { medicion: anterior } = await api.storage.session.get('medicion');
  const observacion = { dominio: null, estado: 'error_de_consulta', observadoEn, sesionId: anterior?.sesionId };
  await api.storage.session.set({ observacion, medicion: avanzarMedicion(anterior, observacion) });
}
