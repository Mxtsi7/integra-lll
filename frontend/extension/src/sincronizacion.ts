import { configurarTokenStorage, configureAuthApi, guardarTokens, login, logout,
  obtenerAccessToken, revocarSesion, sesionDelToken } from '../../shared/src/auth';
import { configurarApi } from '../../shared/src/api/cliente';
import { getSuscripcion, getSuscripciones } from '../../shared/src/api/suscripciones';
import { crearRecolectorUso, type EstadoColaUso } from '../../shared/src/recolectores/colaUso';

type Control = ReturnType<typeof crearRecolectorUso>;
// Chrome es el único adaptador sin tipos compartidos; el núcleo mantiene sus DTO tipados.
type ApiChrome = any;

export function validarBackend(valor: string): string {
  const url = new URL(valor);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, '') !== '/api') {
    throw new Error('Indica la dirección HTTPS de tu servidor terminada en /api.');
  }
  return url.origin + '/api';
}

type CoordinarMedicion = <T>(accion: () => Promise<T>) => Promise<T>;

export function crearSincronizacionNavegador(api: ApiChrome, coordinarMedicion: CoordinarMedicion = accion => accion()) {
  let urlBase = '';
  let tokens: Record<string, string> = {};
  let escrituras = Promise.resolve();
  let cola = Promise.resolve();
  let generacion = 0;
  let retirando = false;
  const controles = new Map<string, Control>();
  function sesion() { const token = obtenerAccessToken(); return token ? sesionDelToken(token) : null; }
  function propietario() {
    const actual = sesion();
    if (!actual) throw new Error('Inicia sesión antes de autorizar.');
    const [usuario, organizacion] = JSON.parse(actual);
    return JSON.stringify([urlBase, usuario, organizacion]);
  }
  function configurar(url: string) { urlBase = validarBackend(url); configurarApi({ urlBase }); configureAuthApi({ baseUrl: urlBase }); }
  const listo = (async () => {
    await api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const guardado = await api.storage.session.get(['conexion', 'credenciales']);
    if (guardado.conexion?.urlBase) configurar(guardado.conexion.urlBase);
    tokens = guardado.credenciales ?? {};
    configurarTokenStorage({
      getItem: clave => tokens[clave] ?? null,
      setItem: (clave, valor) => { tokens[clave] = valor; const copia = { ...tokens };
        escrituras = escrituras.then(() => api.storage.session.set({ credenciales: copia })); },
      removeItem: clave => { delete tokens[clave]; const copia = { ...tokens };
        escrituras = escrituras.then(() => api.storage.session.set({ credenciales: copia })); },
    });
  })();
  function serial<T>(accion: () => Promise<T>): Promise<T> {
    const siguiente = cola.then(async () => { await listo; return accion(); });
    cola = siguiente.then(() => {}, () => {});
    return siguiente.finally(() => escrituras);
  }
  function control(id: string): Control {
    let actual = controles.get(id);
    if (!actual) {
      const dueño = propietario();
      const clave = `uso:${dueño}:${id}`;
      actual = crearRecolectorUso({ obtenerSesion: sesion, suscripcionId: id, origen: 'navegador', uuid: () => crypto.randomUUID(),
        almacen: {
          leer: async () => (await api.storage.local.get(clave))[clave] ?? null,
          guardar: async valor => {
            if (propietario() !== dueño) throw new Error('La cuenta cambió.');
            await api.storage.local.set({ [clave]: valor });
          },
        } });
      controles.set(id, actual);
    }
    return actual;
  }
  async function propios() {
    const prefijo = `uso:${propietario()}:`;
    const todo = await api.storage.local.get(null);
    for (const clave of Object.keys(todo)) if (clave.startsWith(prefijo)) control(clave.slice(prefijo.length));
    return [...controles.values()];
  }
  async function suspender() {
    const { configuracion } = await api.storage.session.get('configuracion');
    if (configuracion) await api.storage.session.set({ configuracion: { ...configuracion, id: crypto.randomUUID(), pausado: true } });
  }
  async function publicarEstado(actual = generacion) {
    const estados: EstadoColaUso[] = [];
    for (const recolector of controles.values()) {
      const estado = await recolector.estado();
      if (estado) estados.push(estado);
    }
    if (actual !== generacion || !sesion()) return;
    await api.storage.session.set({ sincronizacion: estados.map(e => ({ suscripcionId: e.suscripcionId, fase: e.fase,
      pendientes: e.pendientes.length, ultimoEnvio: e.ultimoEnvio ?? null, error: e.error ?? null, accionPendiente: e.accionPendiente ?? null })) });
  }
  async function cicloInterno() {
    if (!sesion() || retirando) return;
    const actual = generacion;
    try {
      const todos = await propios();
      for (const recolector of todos) {
        if (actual !== generacion) return;
        await recolector.sincronizar();
      }
      // Leer después de los reintentos y serializar con el observador. No mantener
      // bloqueada la observación durante ninguna espera de red.
      const capturados = await coordinarMedicion(async () => {
        const limite = Date.now() - 60_000;
        const { configuracion, medicion } = await api.storage.session.get(['configuracion', 'medicion']);
        const resultado: Control[] = [];
        if (!configuracion?.consentimiento || configuracion.pausado || actual !== generacion || retirando) return resultado;
        const ids = [...new Set<string>(Object.values(configuracion.asociaciones ?? {}) as string[])];
        let corteSeguro = limite;
        const observados = [...(medicion?.sesiones ?? []), ...(medicion?.tramo ? [{ ...medicion.tramo, fin: medicion.tramo.confirmadoHasta }] : [])];
        for (const id of ids) {
          if (actual !== generacion) return resultado;
          const recolector = control(id);
          const estado = await recolector.estado();
          if (!estado || estado.fase !== 'activo' || estado.sesionId !== sesion()) continue;
          const fin = Math.min(limite, estado.cursor + 86_400_000);
          if (fin <= estado.cursor) { corteSeguro = Math.min(corteSeguro, estado.cursor); continue; }
          const tramos = observados.filter(t => t.suscripcionId === id && t.fin > t.inicio)
            .map(t => ({ inicio: t.inicio, fin: t.fin }));
          if (actual !== generacion) return resultado;
          await recolector.capturar(fin, tramos);
          corteSeguro = Math.min(corteSeguro, fin);
          resultado.push(recolector);
        }
        // El cursor y sus eventos ya son durables. El observador usa la misma
        // cola para que la poda no sobrescriba una transición de idle.
        if (medicion && actual === generacion) {
          const { medicion: vigente } = await api.storage.session.get('medicion');
          if (vigente?.sesionId === medicion.sesionId && vigente) await api.storage.session.set({ medicion: { ...vigente,
            sesiones: vigente.sesiones.filter((t: { fin: number }) => t.fin > corteSeguro), limiteAlcanzado: false } });
        }
        return resultado;
      });
      for (const recolector of capturados) {
        if (actual !== generacion) return;
        await recolector.sincronizar();
      }
    } finally {
      if (!retirando && actual === generacion) await publicarEstado(actual);
    }
  }
  return {
    sesionVigente: () => !!sesion() && !retirando,
    comprobarSesion: async () => {
      await listo;
      if (!sesion() || retirando) await suspender();
    },
    ciclo: () => serial(cicloInterno),
    mensaje(mensaje: any, controlador: any): Promise<unknown> | undefined {
      if (mensaje.tipo === 'retirar' || mensaje.tipo === 'salir' || mensaje.tipo === 'pausar') {
        ++generacion; retirando = true;
        for (const recolector of controles.values()) recolector.detener();
        const cierreCaptura = controlador.actualizar({ estado: 'pausado' });
        const suspension = listo.then(suspender); // Bloqueo visible antes de esperar la cola o la red.
        return serial(async () => {
          await cierreCaptura;
          await suspension;
          const todos = sesion() ? await propios() : [];
          const resultados = await Promise.allSettled(todos.map(c => mensaje.tipo === 'pausar' ? c.pausar() : c.revocar()));
          const fallo = resultados.find(r => r.status === 'rejected');
          if (mensaje.tipo === 'salir') {
            await revocarSesion();
            logout(); await escrituras; controles.clear();
            await controlador.retirar();
            await api.storage.session.remove(['conexion', 'credenciales', 'sincronizacion']);
            const permisos = await api.permissions.getAll();
            if (permisos.origins?.length) await api.permissions.remove({ origins: permisos.origins });
            urlBase = '';
          } else if (!fallo && mensaje.tipo === 'retirar') await controlador.retirar();
          retirando = false;
          if (mensaje.tipo === 'pausar' || (mensaje.tipo === 'retirar' && fallo)) await publicarEstado();
          if (fallo) throw new Error('Captura detenida. Falta confirmar el retiro o pausa con el servidor; vuelve a intentarlo.');
          return { ok: true };
        });
      }
      if (!['preparar_conexion', 'login', 'estado_cuenta', 'guardar', 'reanudar', 'sincronizar'].includes(mensaje.tipo)) return undefined;
      const solicitud = generacion;
      return serial(async () => {
        if (mensaje.tipo === 'preparar_conexion') {
          if (sesion()) throw new Error('Cierra la sesión antes de cambiar el servidor.');
          const nuevaUrl = validarBackend(mensaje.urlBase);
          await api.storage.session.set({ conexion: { urlBase: nuevaUrl } });
          return { ok: true };
        }
        if (mensaje.tipo === 'login') {
          if (sesion()) throw new Error('Cierra la sesión actual antes de cambiar de cuenta.');
          const nuevaUrl = validarBackend(mensaje.urlBase);
          if (!await api.permissions.contains({ origins: [`${new URL(nuevaUrl).origin}/*`] })) throw new Error('Concede acceso al servidor.');
          configurar(nuevaUrl);
          await api.storage.session.set({ conexion: { urlBase } });
          const credenciales = await login({ correo: mensaje.correo, password: mensaje.password });
          if (solicitud !== generacion || retirando) throw new Error('Inicio de sesión cancelado.');
          guardarTokens(credenciales);
          await escrituras;
          controles.clear(); retirando = false;
          // Retomar revocaciones pendientes de esta misma cuenta antes de cualquier nueva captura.
          await cicloInterno();
          return { ok: true };
        }
        if (mensaje.tipo === 'estado_cuenta') return { ok: true, conectado: !!sesion(), urlBase,
          suscripciones: sesion() ? (await getSuscripciones()).map(s => ({ id: s.id, nombre: s.nombre })) : [] };
        if (!sesion()) throw new Error('Inicia sesión para continuar.');
        if (mensaje.tipo === 'sincronizar') { await cicloInterno(); return { ok: true }; }
        if (solicitud !== generacion || retirando) return { ok: false, cancelado: true };
        const actual = generacion;
        const { autorizacion, configuracion } = await api.storage.session.get(['autorizacion', 'configuracion']);
        const asociaciones = mensaje.tipo === 'guardar' ? autorizacion?.asociaciones : configuracion?.asociaciones;
        if (mensaje.tipo === 'guardar' && autorizacion?.id !== mensaje.intentoId) return { ok: false, cancelado: true };
        const ids = [...new Set<string>(Object.values(asociaciones ?? {}) as string[])];
        if (!ids.length) throw new Error('Asocia al menos un dominio con una de tus suscripciones.');
        await controlador.actualizar({ estado: 'pausado' });
        await suspender();
        for (const id of ids) {
          await getSuscripcion(id); // No confiar en UUID escritos en el panel.
          if (actual !== generacion || retirando) return { ok: false, cancelado: true };
          await control(id).aceptar();
          if (actual !== generacion) { await control(id).revocar(); return { ok: false, cancelado: true }; }
        }
        // Las asociaciones retiradas no conservan una autorización de captura activa.
        for (const [id, recolector] of controles) if (!ids.includes(id)) await recolector.revocar();
        if (mensaje.tipo === 'guardar') {
          const resultado = await controlador.guardar(mensaje.configuracion, mensaje.intentoId);
          if (resultado?.ok === false) return resultado;
        }
        if (actual !== generacion) return { ok: false, cancelado: true };
        const { configuracion: vigente } = await api.storage.session.get('configuracion');
        await api.storage.session.set({ configuracion: { ...vigente, id: crypto.randomUUID(), pausado: false, versionTexto: 'uso-v1' } });
        retirando = false;
        await controlador.actualizar();
        await publicarEstado(actual);
        return { ok: true };
      });
    },
  };
}
