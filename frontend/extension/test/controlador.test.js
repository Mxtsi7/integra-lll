import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearControlador } from '../src/controlador.js';

test('retirar espera la observación pendiente y borra antes de confirmar', async () => {
  const almacen = { configuracion: { id: 'A', consentimiento: true, dominios: ['example.com'] } };
  let iniciarEscritura;
  const escribiendo = new Promise(resolve => { iniciarEscritura = resolve; });
  let liberarEscritura;
  const permisoEscritura = new Promise(resolve => { liberarEscritura = resolve; });
  const api = {
    storage: { session: {
      get: async () => structuredClone(almacen),
      set: async valores => { iniciarEscritura(); await permisoEscritura; Object.assign(almacen, valores); },
      clear: async () => { for (const clave of Object.keys(almacen)) delete almacen[clave]; },
    } },
    windows: { getLastFocused: async () => ({ id: 1, focused: true }) },
    idle: { queryState: async () => 'active' },
    tabs: { query: async () => [{ url: 'https://example.com' }] },
    permissions: { contains: async () => true, getAll: async () => ({ origins: [] }) },
  };
  const controlador = crearControlador(api);
  const observando = controlador.actualizar();
  await escribiendo;
  const retirada = controlador.retirar();
  liberarEscritura();
  await Promise.all([observando, retirada]);
  assert.deepEqual(almacen, {});
});

test('editar selección conserva la sesión de medición y retira permisos sobrantes', async () => {
  const almacen = { configuracion: { id: 'A', sesionId: 'sesion-original' } };
  let retirados;
  const api = {
    storage: { session: {
      get: async () => structuredClone(almacen), set: async valores => Object.assign(almacen, valores),
    } },
    permissions: {
      contains: async () => true,
      getAll: async () => ({ origins: ['https://anterior.com/*', 'https://nuevo.com/*'] }),
      remove: async permisos => { retirados = permisos.origins; },
    },
  };
  await crearControlador(api).guardar({ dominios: ['nuevo.com'], consentimiento: true });
  assert.deepEqual(retirados, ['https://anterior.com/*']);
  assert.equal(almacen.configuracion.sesionId, 'sesion-original');
  assert.notEqual(almacen.configuracion.id, 'A');
});
