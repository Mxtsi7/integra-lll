import { dominioAutorizado } from './dominio.js';

export const UMBRAL_INACTIVIDAD_SEGUNDOS = 60;

async function leerActividad(api, dominios) {
  const ventana = await api.windows.getLastFocused();
  if (!ventana.focused) return { dominio: null, estado: 'sin_foco' };
  const actividad = await api.idle.queryState(UMBRAL_INACTIVIDAD_SEGUNDOS);
  if (actividad === 'locked') return { dominio: null, estado: 'bloqueado' };
  if (actividad !== 'active') return { dominio: null, estado: 'inactivo' };
  const [pestana] = await api.tabs.query({ active: true, windowId: ventana.id });
  const dominio = !pestana?.incognito ? dominioAutorizado(pestana?.url, dominios) : null;
  if (!dominio) return { dominio: null, estado: 'sin_dominio_autorizado' };
  const tienePermiso = await api.permissions.contains({ origins: [`https://${dominio}/*`] });
  return tienePermiso ? { dominio, estado: 'activo' } : { dominio: null, estado: 'sin_permiso' };
}

export async function observar(api) {
  const { configuracion } = await api.storage.session.get('configuracion');
  let dominio = null;
  let estado = 'sin_consentimiento';
  if (configuracion?.consentimiento) {
    ({ dominio, estado } = await leerActividad(api, configuracion.dominios));
  }
  const { configuracion: vigente } = await api.storage.session.get('configuracion');
  if (vigente?.id !== configuracion?.id || !vigente?.consentimiento) {
    dominio = null;
    estado = 'sin_consentimiento';
  }
  await api.storage.session.set({ observacion: { dominio, estado, observadoEn: Date.now() } });
}

export async function registrarError(api) {
  await api.storage.session.set({ observacion: { dominio: null, estado: 'error_de_consulta', observadoEn: Date.now() } });
}
