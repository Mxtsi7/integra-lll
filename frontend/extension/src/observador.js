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
  const identidad = { ventanaId: ventana.id, pestanaId: pestana?.id };
  if (pestana?.status === 'loading') return { ...identidad, dominio: null, estado: 'navegando' };
  const dominio = !pestana?.incognito ? dominioAutorizado(pestana?.url, dominios) : null;
  if (!dominio) return { ...identidad, dominio: null, estado: 'sin_dominio_autorizado' };
  const tienePermiso = await api.permissions.contains({ origins: [`https://${dominio}/*`] });
  return { ...identidad, ...(tienePermiso ? { dominio, estado: 'activo' } : { dominio: null, estado: 'sin_permiso' }) };
}

export async function cortarTransicion(api, { tipo, pestanaId, ventanaId, observadoEn }) {
  const { observacion } = await api.storage.session.get('observacion');
  if (!observacion) return;
  if (tipo === 'foco') {
    if (Number.isInteger(observacion.ventanaId) && ventanaId !== observacion.ventanaId) {
      const estado = ['bloqueado', 'sin_foco', 'inactivo'].includes(observacion.estado)
        ? observacion.estado : 'navegando';
      await observar(api, { estado, observadoEn });
    }
    return;
  }
  if (!Number.isInteger(pestanaId)) return;
  if (ventanaId !== undefined && ventanaId !== observacion.ventanaId) return;
  const afectaObservada = tipo === 'activacion'
    ? ventanaId === observacion.ventanaId && pestanaId !== observacion.pestanaId
    : pestanaId === observacion.pestanaId;
  if (afectaObservada) await observar(api, { estado: 'navegando', observadoEn });
}

export async function observar(api, { estado: pausa, observadoEn, esVigente = () => true } = {}) {
  const { configuracion } = await api.storage.session.get('configuracion');
  let dominio = null;
  let estado = 'sin_consentimiento';
  let identidad = {};
  if (configuracion?.consentimiento) {
    if (pausa) estado = pausa;
    else {
      const lectura = await leerActividad(api, configuracion.dominios);
      ({ dominio, estado } = lectura);
      identidad = { ventanaId: lectura.ventanaId, pestanaId: lectura.pestanaId };
    }
  }
  const { configuracion: vigente } = await api.storage.session.get('configuracion');
  if (vigente?.id !== configuracion?.id || !vigente?.consentimiento) {
    dominio = null;
    estado = 'sin_consentimiento';
  }
  const { medicion: anterior } = await api.storage.session.get('medicion');
  if (!esVigente()) return;
  const instante = pausa ? observadoEn ?? Date.now() : Date.now();
  const observacion = { ...identidad, dominio, estado, observadoEn: instante, sesionId: vigente?.sesionId ?? vigente?.id,
    suscripcionId: dominio ? vigente?.asociaciones?.[dominio] ?? null : null };
  const medicion = avanzarMedicion(anterior, observacion);
  if (medicion.limiteAlcanzado) observacion.estado = 'limite_de_sesion';
  await api.storage.session.set({ observacion, medicion });
}

export async function registrarError(api, observadoEn = Date.now(), esVigente = () => true) {
  const { medicion: anterior } = await api.storage.session.get('medicion');
  if (!esVigente()) return;
  const observacion = { dominio: null, estado: 'error_de_consulta', observadoEn, sesionId: anterior?.sesionId };
  await api.storage.session.set({ observacion, medicion: avanzarMedicion(anterior, observacion) });
}
