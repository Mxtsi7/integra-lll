import { observar, registrarError, cortarTransicion } from './observador.js';
import { normalizarDominio, leerAsociaciones } from './dominio.js';

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
    const { configuracion, autorizacion, conexion } = await api.storage.session.get(['configuracion', 'autorizacion', 'conexion']);
    // Una concesión tardía no puede quitar permisos de una aceptación nueva o en curso.
    const dominios = [...(configuracion?.consentimiento ? configuracion.dominios : []), ...(autorizacion?.dominios ?? [])];
    const vigentes = new Set(dominios.map(dominio => `https://${dominio}/*`));
    if (conexion?.urlBase) vigentes.add(`${new URL(conexion.urlBase).origin}/*`);
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
    coordinarMedicion: encolar,
    actualizar: (senal = {}, antesDeObservar = () => {}, autorizado = () => true) => {
      const actual = ++revision;
      // Las pausas son hechos recibidos; una reconsulta solo vale si sigue vigente.
      const pausa = senal.estado ? { estado: senal.estado, observadoEn: Date.now() } : null;
      const transicion = senal.transicion ? { ...senal.transicion, observadoEn: Date.now() } : null;
      const esVigente = () => autorizado() && (pausa !== null || actual === revision);
      return encolar(async () => {
        try {
          await antesDeObservar();
          // El corte es un hecho; solo la lectura del destino puede quedar superada.
          if (transicion) await cortarTransicion(api, transicion);
          if (esVigente()) await observar(api, { ...pausa, esVigente });
        }
        catch {
          if (esVigente()) await registrarError(api, pausa?.observadoEn ?? Date.now(), esVigente);
        }
      });
    },
    iniciarAutorizacion: (id, dominios, asociaciones = {}) => encolar(async () => {
      validarDominios(dominios);
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Intento inválido');
      const validadas = leerAsociaciones(Object.entries(asociaciones).map(([dominio, suscripcion]) => `${dominio}=${suscripcion}`).join('\n'), dominios);
      await api.storage.session.set({ autorizacion: { id, dominios, asociaciones: validadas } });
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
      // Cerrar con la configuración anterior antes de esperar su sustitución y limpieza.
      await cortarTransicion(api, { tipo: 'configuracion', dominios,
        asociaciones: autorizacion.asociaciones, observadoEn: Date.now() });
      await api.storage.session.set({ configuracion: {
        id: crypto.randomUUID(), sesionId: anterior?.sesionId ?? anterior?.id ?? crypto.randomUUID(),
        consentimiento: true, dominios, asociaciones: autorizacion.asociaciones, versionTexto: 'sesion-temporal-v1', aceptadoEn: new Date().toISOString(),
      } });
      await api.storage.session.remove('autorizacion');
      await limpiarPermisosSobrantes();
    }),
    retirar: () => encolar(async () => {
      const { conexion, credenciales } = await api.storage.session.get(['conexion', 'credenciales']);
      await api.storage.session.clear();
      if (conexion) await api.storage.session.set({ conexion, ...(credenciales ? { credenciales } : {}) });
      const permisos = await api.permissions.getAll();
      const conservar = conexion?.urlBase ? `${new URL(conexion.urlBase).origin}/*` : null;
      const retirar = permisos.origins?.filter(origen => origen !== conservar);
      if (retirar?.length) await api.permissions.remove({ origins: retirar });
    }),
  };
}
