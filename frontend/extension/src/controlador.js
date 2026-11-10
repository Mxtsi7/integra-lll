import { observar, registrarError } from './observador.js';
import { normalizarDominio } from './dominio.js';

export function crearControlador(api) {
  let cola = Promise.resolve();
  let revision = 0;
  function validarDominios(dominios) {
    if (!Array.isArray(dominios) || !dominios.length || dominios.length > 20 ||
        dominios.some(dominio => normalizarDominio(dominio) !== dominio)) {
      throw new Error('Configuración inválida');
    }
  }
  async function limpiarPermisosSobrantes() {
    const { configuracion, autorizacion } = await api.storage.session.get(['configuracion', 'autorizacion']);
    // Una concesión tardía no puede quitar permisos de una aceptación nueva o en curso.
    const dominios = [...(configuracion?.consentimiento ? configuracion.dominios : []), ...(autorizacion?.dominios ?? [])];
    const vigentes = new Set(dominios.map(dominio => `https://${dominio}/*`));
    const permisos = await api.permissions.getAll();
    const sobrantes = (permisos.origins ?? []).filter(origen => !vigentes.has(origen));
    if (sobrantes.length) await api.permissions.remove({ origins: sobrantes });
  }
  function encolar(operacion) {
    const pendiente = cola.then(operacion);
    cola = pendiente.catch(() => {}); // El llamador recibe el rechazo; la cola sigue utilizable.
    return pendiente;
  }
  return {
    actualizar: (senal = {}) => {
      const actual = ++revision;
      // Las pausas son hechos recibidos; una reconsulta solo vale si sigue vigente.
      const pausa = senal.estado ? { estado: senal.estado, observadoEn: Date.now() } : null;
      const esVigente = () => pausa !== null || actual === revision;
      return encolar(async () => {
        if (!esVigente()) return;
        try { await observar(api, { ...pausa, esVigente }); }
        catch {
          if (esVigente()) await registrarError(api, pausa?.observadoEn ?? Date.now(), esVigente);
        }
      });
    },
    iniciarAutorizacion: (id, dominios) => encolar(async () => {
      validarDominios(dominios);
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Intento inválido');
      await api.storage.session.set({ autorizacion: { id, dominios } });
    }),
    cancelarAutorizacion: id => encolar(async () => {
      const { autorizacion } = await api.storage.session.get('autorizacion');
      if (autorizacion?.id === id) await api.storage.session.remove('autorizacion');
      await limpiarPermisosSobrantes();
    }),
    limpiarPermisos: () => encolar(limpiarPermisosSobrantes),
    guardar: (configuracion, intentoId) => encolar(async () => {
      const { autorizacion } = await api.storage.session.get('autorizacion');
      if (!intentoId || autorizacion?.id !== intentoId) {
        await limpiarPermisosSobrantes();
        return { ok: false, cancelado: true };
      }
      const dominios = autorizacion.dominios;
      if (!configuracion?.consentimiento) throw new Error('Consentimiento requerido');
      const origins = dominios.map(dominio => `https://${dominio}/*`);
      if (!await api.permissions.contains({ origins })) {
        await api.storage.session.remove('autorizacion');
        await limpiarPermisosSobrantes();
        throw new Error('Permiso requerido');
      }
      const { configuracion: anterior } = await api.storage.session.get('configuracion');
      await api.storage.session.set({ configuracion: {
        id: crypto.randomUUID(), sesionId: anterior?.sesionId ?? anterior?.id ?? crypto.randomUUID(),
        consentimiento: true, dominios, versionTexto: 'sesion-temporal-v1', aceptadoEn: new Date().toISOString(),
      } });
      await api.storage.session.remove('autorizacion');
      await limpiarPermisosSobrantes();
    }),
    retirar: () => encolar(async () => {
      await api.storage.session.clear();
      const permisos = await api.permissions.getAll();
      if (permisos.origins?.length) await api.permissions.remove({ origins: permisos.origins });
    }),
  };
}
