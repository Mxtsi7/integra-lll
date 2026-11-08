import { dominioAutorizado } from './dominio.js';

export async function observar(api) {
  const { configuracion } = await api.storage.session.get('configuracion');
  let dominio = null;
  let estado = 'sin_consentimiento';
  if (configuracion?.consentimiento) {
    const [pestana] = await api.tabs.query({ active: true, currentWindow: true });
    dominio = !pestana?.incognito ? dominioAutorizado(pestana?.url, configuracion.dominios) : null;
    estado = 'sin_dominio_autorizado';
    if (dominio) {
      const tienePermiso = await api.permissions.contains({ origins: [`https://${dominio}/*`] });
      estado = tienePermiso ? 'activo' : 'sin_permiso';
      if (!tienePermiso) dominio = null;
    }
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
