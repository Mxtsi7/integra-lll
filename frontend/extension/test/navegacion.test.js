import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navegador, vaciarCola } from './utilidades/navegador.js';

let carga = 0;
async function preparar() {
  const prueba = navegador();
  prueba.almacen.configuracion = { id: 'A', consentimiento: true, dominios: ['example.com'] };
  prueba.permisos.add('https://example.com/*');
  globalThis.chrome = prueba.api;
  await import(`../src/background.js?navegacion=${carga++}`);
  prueba.api.runtime.onStartup.emitir();
  await vaciarCola();
  return prueba;
}

for (const entrada of ['navegacion', 'pestana']) {
  for (const demorada of [false, 'transicion', 'previa']) {
    test(`${entrada} A → B sin permiso → A conserva dos tramos de 4000 ms (${demorada || 'sin demora'})`, async () => {
      const reloj = Date.now;
      let instante = 0;
      Date.now = () => instante;
      let liberar;
      try {
        const { api, almacen, permisos } = await preparar();
        let pestana = { id: 7, windowId: 1, active: true, status: 'complete', url: 'https://example.com/?privado=1' };
        api.tabs.query = async () => [{ ...pestana }];
        const consultar = api.windows.getLastFocused;
        let avisar;
        const esperando = new Promise(resolve => { avisar = resolve; });
        const espera = new Promise(resolve => { liberar = resolve; });
        let primera = true;
        api.windows.getLastFocused = async () => {
          if (demorada && primera) { primera = false; avisar(); await espera; }
          return consultar();
        };
        const observaciones = [];
        api.storage.onChanged.addListener(cambios => {
          if (cambios.observacion) observaciones.push(cambios.observacion.newValue);
        });
        if (demorada === 'previa') {
          instante = 1000;
          api.alarms.onAlarm.emitir({ name: 'observar-uso' });
          await esperando;
        }
        instante = 2000;
        pestana = { id: entrada === 'pestana' ? 8 : 7, windowId: 1, active: true, status: 'loading' };
        if (entrada === 'pestana') api.tabs.onActivated.emitir({ tabId: 8, windowId: 1 });
        else api.tabs.onUpdated.emitir(7, { status: 'loading' }, { ...pestana });
        if (demorada === 'transicion') {
          await esperando;
          assert.equal(almacen.medicion.tramo, null, 'corta antes de esperar una nueva observación válida');
          assert.deepEqual(almacen.medicion.sesiones.map(s => [s.inicio, s.fin]), [[0, 2000]]);
        }
        else await vaciarCola();
        instante = 2100;
        pestana.status = 'complete';
        api.tabs.onUpdated.emitir(pestana.id, { status: 'complete' }, { ...pestana });
        await vaciarCola();
        instante = 7000;
        pestana = { id: 7, windowId: 1, active: true, status: 'complete', url: 'https://example.com/regreso' };
        if (entrada === 'pestana') api.tabs.onActivated.emitir({ tabId: 7, windowId: 1 });
        else api.tabs.onUpdated.emitir(7, { status: 'complete' }, { ...pestana });
        liberar();
        await vaciarCola();
        instante = 9000;
        api.windows.onFocusChanged.emitir(-1);
        await vaciarCola();
        assert.deepEqual(almacen.medicion.sesiones.map(s => [s.dominio, s.inicio, s.fin]),
          [['example.com', 0, 2000], ['example.com', 7000, 9000]]);
        assert.equal(almacen.medicion.sesiones.reduce((ms, s) => ms + s.duracionMs, 0), 4000);
        assert.equal(almacen.medicion.tramo, null);
        assert.ok(observaciones.some(o => o.dominio === null && o.observadoEn === 2000));
        assert.ok(!observaciones.some(o => o.estado === 'activo' && o.observadoEn > 2000 && o.observadoEn < 7000));
        assert.deepEqual([...permisos], ['https://example.com/*']);
        assert.ok(!JSON.stringify(almacen).includes('privado'));
      } finally { liberar?.(); Date.now = reloj; }
    });
  }
}

test('navegar, activar o cerrar pestañas ajenas y refrescar metadatos no fragmenta el tramo enfocado', async () => {
  const reloj = Date.now;
  let instante = 0;
  Date.now = () => instante;
  try {
    const { api, almacen } = await preparar();
    instante = 2000;
    api.tabs.onUpdated.emitir(8, { status: 'loading' }, { id: 8, windowId: 2, active: true });
    api.tabs.onActivated.emitir({ tabId: 8, windowId: 2 });
    api.tabs.onRemoved.emitir(8, { windowId: 2, isWindowClosing: false });
    api.tabs.onUpdated.emitir(9, { status: 'loading' }, { id: 9, windowId: 1, active: false });
    api.tabs.onRemoved.emitir(9, { windowId: 1, isWindowClosing: false });
    api.tabs.onUpdated.emitir(7, { audible: true }, { id: 7, windowId: 1, active: true });
    await vaciarCola();
    instante = 9000;
    api.windows.onFocusChanged.emitir(-1);
    await vaciarCola();
    assert.deepEqual(almacen.medicion.sesiones.map(s => [s.inicio, s.fin]), [[0, 9000]]);
  } finally { Date.now = reloj; }
});

test('reanudar tras navegación fecha A al comprobarlo, sin rellenar el intervalo desconocido', async () => {
  const reloj = Date.now;
  let instante = 0;
  Date.now = () => instante;
  let liberar;
  try {
    const { api, almacen } = await preparar();
    let avisar;
    const esperando = new Promise(resolve => { avisar = resolve; });
    const espera = new Promise(resolve => { liberar = resolve; });
    api.tabs.query = async () => {
      avisar();
      await espera;
      return [{ id: 7, windowId: 1, active: true, status: 'complete', url: 'https://example.com' }];
    };
    instante = 2000;
    api.tabs.onUpdated.emitir(7, { status: 'loading' }, { id: 7, windowId: 1, active: true });
    await esperando;
    assert.equal(almacen.medicion.tramo, null);
    instante = 7000;
    api.tabs.onUpdated.emitir(7, { status: 'complete' }, { id: 7, windowId: 1, active: true });
    instante = 8000;
    liberar();
    await vaciarCola();
    assert.equal(almacen.observacion.observadoEn, 8000);
    assert.equal(almacen.medicion.tramo.inicio, 8000);
    instante = 9000;
    api.windows.onFocusChanged.emitir(-1);
    await vaciarCola();
    assert.deepEqual(almacen.medicion.sesiones.map(s => [s.inicio, s.fin]), [[0, 2000], [8000, 9000]]);
  } finally { liberar?.(); Date.now = reloj; }
});
