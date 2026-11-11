import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observar } from '../src/observador.js';

function navegador(configuracion = { id: 'A', consentimiento: true, dominios: ['netflix.com'] }) {
  const almacen = { configuracion };
  const api = {
    storage: { session: { get: async () => ({ ...almacen }), set: async valores => Object.assign(almacen, valores) } },
    tabs: { query: async () => [{ url: 'https://netflix.com/perfil?privado=1', incognito: false }] },
    permissions: { contains: async () => true },
    windows: { getLastFocused: async () => ({ id: 1, focused: true }) },
    idle: { queryState: async () => 'active' },
  };
  return { api, almacen };
}
test('publica solo hostname autorizado; no persiste contenido ni URL', async () => {
  const { api, almacen } = navegador();
  await observar(api);
  assert.equal(almacen.observacion.dominio, 'netflix.com');
  assert.equal(almacen.observacion.estado, 'activo');
  assert.ok(!JSON.stringify(almacen).includes('privado'));
});
test('no consulta pestañas sin consentimiento y excluye incógnito', async () => {
  const { api, almacen } = navegador();
  almacen.configuracion.consentimiento = false;
  api.tabs.query = async () => { throw new Error('no debe consultar'); };
  await observar(api);
  assert.equal(almacen.observacion.estado, 'sin_consentimiento');
  almacen.configuracion.consentimiento = true;
  api.tabs.query = async () => [{ url: 'https://netflix.com', incognito: true }];
  await observar(api);
  assert.equal(almacen.observacion.dominio, null);
});
test('una respuesta tardía no reactiva consentimiento retirado', async () => {
  const { api, almacen } = navegador();
  api.tabs.query = async () => {
    almacen.configuracion = { id: 'B', consentimiento: false, dominios: [] };
    return [{ url: 'https://netflix.com' }];
  };
  await observar(api);
  assert.equal(almacen.observacion.dominio, null);
});
test('denegación de permiso no se interpreta como uso cero', async () => {
  const { api, almacen } = navegador();
  api.permissions.contains = async () => false;
  await observar(api);
  assert.equal(almacen.observacion.estado, 'sin_permiso');
  assert.equal(almacen.observacion.dominio, null);
});

test('sin foco no observa; vuelve a comprobar la pestaña al recuperar foco', async () => {
  const { api, almacen } = navegador();
  api.windows.getLastFocused = async () => ({ id: 1, focused: false });
  await observar(api);
  assert.equal(almacen.observacion.estado, 'sin_foco');
  assert.equal(almacen.observacion.dominio, null);
  api.windows.getLastFocused = async () => ({ id: 1, focused: true });
  await observar(api);
  assert.equal(almacen.observacion.dominio, 'netflix.com');
});
test('inactividad o bloqueo son estados distintos y no se interpretan como cero observado', async () => {
  const { api, almacen } = navegador();
  for (const inactividad of ['idle', 'locked']) {
    api.idle.queryState = async segundos => {
      assert.equal(segundos, 60);
      return inactividad;
    };
    await observar(api);
    assert.equal(almacen.observacion.estado, inactividad === 'locked' ? 'bloqueado' : 'inactivo');
    assert.equal(almacen.observacion.dominio, null);
  }
  api.idle.queryState = async () => 'active';
  await observar(api);
  assert.equal(almacen.observacion.estado, 'activo');
});

test('bloqueo prevalece cuando tampoco hay foco', async () => {
  const { api, almacen } = navegador();
  api.windows.getLastFocused = async () => ({ id: 1, focused: false });
  api.idle.queryState = async () => 'locked';
  await observar(api);
  assert.equal(almacen.observacion.estado, 'bloqueado');
});

test('pausas conservadas no consultan pestañas ni reconstruyen el estado final', async () => {
  const { api, almacen } = navegador();
  api.tabs.query = async () => { throw new Error('una pausa no debe consultar pestañas'); };
  api.windows.getLastFocused = async () => { throw new Error('una pausa ya trae su señal'); };
  for (const estado of ['sin_foco', 'inactivo', 'bloqueado']) {
    await observar(api, { estado, observadoEn: 1234 });
    assert.deepEqual(almacen.observacion, { dominio: null, estado, observadoEn: 1234 });
  }
});
