export function evento() {
  const oyentes = [];
  return { addListener: oyente => oyentes.push(oyente), emitir: (...argumentos) => oyentes.forEach(oyente => oyente(...argumentos)), oyentes };
}

export function navegador() {
  const almacen = {};
  const permisos = new Set();
  let ventanaActiva = 1;
  const api = {
    storage: { onChanged: evento(), session: {
      get: async () => structuredClone(almacen),
      set: async valores => {
        Object.assign(almacen, valores);
        api.storage.onChanged.emitir(Object.fromEntries(Object.entries(valores).map(([clave, newValue]) => [clave, { newValue }])), 'session');
      },
      remove: async clave => { delete almacen[clave]; },
      clear: async () => {
        for (const clave of Object.keys(almacen)) delete almacen[clave];
        api.storage.onChanged.emitir({ configuracion: {} }, 'session');
      },
    } },
    permissions: {
      onAdded: evento(), onRemoved: evento(),
      contains: async ({ origins }) => origins.every(origen => permisos.has(origen)),
      getAll: async () => ({ origins: [...permisos] }),
      remove: async ({ origins }) => { origins.forEach(origen => permisos.delete(origen)); api.permissions.onRemoved.emitir({ origins }); return true; },
      request: async ({ origins }) => { origins.forEach(origen => permisos.add(origen)); api.permissions.onAdded.emitir({ origins }); return true; },
    },
    tabs: {
      onActivated: evento(), onUpdated: evento(), onRemoved: evento(),
      query: async ({ windowId } = {}) => [{ url: (windowId ?? ventanaActiva) === 1 ? 'https://example.com/?privado=1' : 'https://no-autorizado.com', active: true }],
    },
    windows: { onFocusChanged: evento(), getLastFocused: async () => ({ id: ventanaActiva, focused: true }) },
    runtime: {
      id: 'extension-prueba', onMessage: evento(), onStartup: evento(), onInstalled: evento(),
      sendMessage: mensaje => new Promise((resolve, reject) => {
        const [oyente] = api.runtime.onMessage.oyentes;
        if (!oyente) { reject(new Error('No hay worker')); return; }
        if (oyente(mensaje, { id: 'extension-prueba' }, resolve) !== true) reject(new Error('Mensaje desconocido'));
      }),
    },
  };
  return { api, almacen, permisos, enfocar: id => { ventanaActiva = id; api.windows.onFocusChanged.emitir(id); } };
}

export function documento() {
  const elementos = new Map();
  return { querySelector: selector => {
    if (!elementos.has(selector)) elementos.set(selector, {
      value: '', checked: true, textContent: '',
      addEventListener(tipo, oyente) { this[tipo] = oyente; },
    });
    return elementos.get(selector);
  } };
}

export async function vaciarCola() {
  for (let intento = 0; intento < 5; intento++) await new Promise(resolve => setImmediate(resolve));
}
