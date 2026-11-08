import { observar, registrarError } from './observador.js';
import { normalizarDominio, leerAsociaciones } from './dominio.js';

export function crearControlador(api) {
  let cola = Promise.resolve();
  function encolar(operacion) {
    const pendiente = cola.then(operacion);
    cola = pendiente.catch(() => {}); // El llamador recibe el rechazo; la cola sigue utilizable.
    return pendiente;
  }
  return {
    actualizar: () => encolar(async () => {
      try { await observar(api); }
      catch { await registrarError(api); }
    }),
    guardar: configuracion => encolar(async () => {
      const dominios = configuracion.dominios;
      if (!Array.isArray(dominios) || !dominios.length || dominios.length > 20 ||
          dominios.some(dominio => normalizarDominio(dominio) !== dominio) || !configuracion.consentimiento) {
        throw new Error('Configuración inválida');
      }
      const asociaciones = leerAsociaciones(Object.entries(configuracion.asociaciones ?? {}).map(([dominio, id]) => `${dominio}=${id}`).join('\n'), dominios);
      const origins = dominios.map(dominio => `https://${dominio}/*`);
      if (!await api.permissions.contains({ origins })) throw new Error('Permiso requerido');
      const { configuracion: anterior } = await api.storage.session.get('configuracion');
      await api.storage.session.set({ configuracion: {
        id: crypto.randomUUID(), sesionId: anterior?.sesionId ?? anterior?.id ?? crypto.randomUUID(),
        consentimiento: true, dominios, asociaciones, versionTexto: 'sesion-temporal-v1', aceptadoEn: new Date().toISOString(),
      } });
      const permisos = await api.permissions.getAll();
      const sobrantes = (permisos.origins ?? []).filter(origen => !origins.includes(origen));
      if (sobrantes.length) await api.permissions.remove({ origins: sobrantes });
    }),
    retirar: () => encolar(async () => {
      await api.storage.session.clear();
      const permisos = await api.permissions.getAll();
      if (permisos.origins?.length) await api.permissions.remove({ origins: permisos.origins });
    }),
  };
}
