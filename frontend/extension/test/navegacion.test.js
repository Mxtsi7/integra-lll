import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navegador, vaciarCola } from './utilidades/navegador.js';

let carga = 0;
async function preparar(configuracion = { id: 'A', consentimiento: true, dominios: ['example.com'] }) {
  const prueba = navegador();
  prueba.almacen.configuracion = configuracion;
  prueba.permisos.add('https://example.com/*');
  globalThis.chrome = prueba.api;
  await import(`../src/background.js?navegacion=${carga++}`);
  prueba.api.runtime.onStartup.emitir();
  await vaciarCola();
  return prueba;
}

for (const cambio of ['asociacion', 'dominio', 'sin_cambios']) {
  for (const demora of ['limpieza', 'lectura']) {
    test(`editar ${cambio} corta solo el tramo afectado antes de esperar ${demora}`, async () => {
      const relojOriginal = Date.now;
      let instante = 0;
      Date.now = () => instante;
      let liberarOperacion;
      try {
        const suscripcionAnterior = '21e0cc35-c621-42f0-81c2-59d68cfb899e';
        const suscripcionNueva = '31e0cc35-c621-42f0-81c2-59d68cfb899e';
        const { api, almacen, permisos } = await preparar({ id: 'A', consentimiento: true,
          dominios: ['example.com'], asociaciones: { 'example.com': suscripcionAnterior } });
        const dominios = cambio === 'dominio' ? ['nuevo.com'] : ['example.com'];
        const asociaciones = cambio === 'dominio' ? {} : {
          'example.com': cambio === 'asociacion' ? suscripcionNueva : suscripcionAnterior,
        };
        permisos.add('https://nuevo.com/*');
        const intentoId = crypto.randomUUID();
        await api.runtime.sendMessage({ tipo: 'iniciar_autorizacion', intentoId, dominios, asociaciones });
        let avisarOperacion;
        const operacionIniciada = new Promise(resolve => { avisarOperacion = resolve; });
        const operacionPendiente = new Promise(resolve => { liberarOperacion = resolve; });
        const dependencia = demora === 'limpieza' ? api.permissions : api.tabs;
        const metodo = demora === 'limpieza' ? 'getAll' : 'query';
        const consultar = dependencia[metodo];
        dependencia[metodo] = async (...argumentos) => {
          avisarOperacion();
          await operacionPendiente;
          return consultar(...argumentos);
        };
        instante = 2000;
        const guardado = api.runtime.sendMessage({ tipo: 'guardar', intentoId, configuracion: { consentimiento: true } });
        await operacionIniciada;
        instante = 7000;
        liberarOperacion();
        assert.equal((await guardado).ok, true);
        await vaciarCola();
        instante = 9000;
        api.windows.onFocusChanged.emitir(-1);
        await vaciarCola();
        const sesiones = almacen.medicion.sesiones.map(sesion => [sesion.suscripcionId, sesion.inicio, sesion.fin]);
        const esperadas = cambio === 'sin_cambios' ? [[suscripcionAnterior, 0, 9000]]
          : cambio === 'dominio' ? [[suscripcionAnterior, 0, 2000]]
            : [[suscripcionAnterior, 0, 2000], [suscripcionNueva, 7000, 9000]];
        assert.deepEqual(sesiones, esperadas);
      } finally { liberarOperacion?.(); Date.now = relojOriginal; }
    });
  }
}

for (const demora of [false, 'retiro', 'previa']) {
  test(`retirar y recuperar permiso conserva el intervalo sin autorización (${demora || 'sin demora'})`, async () => {
    const relojOriginal = Date.now;
    let instante = 0;
    Date.now = () => instante;
    let liberarConsulta;
    try {
      const { api, almacen } = await preparar();
      const consultarVentana = api.windows.getLastFocused;
      let avisarConsulta;
      const consultaIniciada = new Promise(resolve => { avisarConsulta = resolve; });
      const consultaPendiente = new Promise(resolve => { liberarConsulta = resolve; });
      let primeraConsulta = true;
      api.windows.getLastFocused = async () => {
        if (demora && primeraConsulta) {
          primeraConsulta = false;
          avisarConsulta();
          await consultaPendiente;
        }
        return consultarVentana();
      };
      if (demora === 'previa') {
        instante = 1000;
        api.alarms.onAlarm.emitir({ name: 'observar-uso' });
        await consultaIniciada;
      }
      instante = 2000;
      await api.permissions.remove({ origins: ['https://example.com/*'] });
      if (demora === 'retiro') await consultaIniciada;
      else await vaciarCola();
      instante = 7000;
      await api.permissions.request({ origins: ['https://example.com/*'] });
      api.alarms.onAlarm.emitir({ name: 'observar-uso' });
      if (demora) instante = 8000;
      liberarConsulta();
      await vaciarCola();
      instante = 9000;
      api.windows.onFocusChanged.emitir(-1);
      await vaciarCola();
      assert.deepEqual(almacen.medicion.sesiones.map(sesion => [sesion.inicio, sesion.fin]),
        [[0, 2000], [demora ? 8000 : 7000, 9000]]);
      assert.equal(almacen.medicion.tramo, null);
    } finally { liberarConsulta?.(); Date.now = relojOriginal; }
  });
}

test('retirar permiso de otro host no fragmenta el tramo enfocado', async () => {
  const relojOriginal = Date.now;
  let instante = 0;
  Date.now = () => instante;
  try {
    const { api, almacen, permisos } = await preparar();
    permisos.add('https://otro.com/*');
    instante = 2000;
    await api.permissions.remove({ origins: ['https://otro.com/*'] });
    await vaciarCola();
    instante = 9000;
    api.windows.onFocusChanged.emitir(-1);
    await vaciarCola();
    assert.deepEqual(almacen.medicion.sesiones.map(sesion => [sesion.inicio, sesion.fin]), [[0, 9000]]);
  } finally { Date.now = relojOriginal; }
});

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
    api.windows.onFocusChanged.emitir(1);
    api.windows.onFocusChanged.emitir(1);
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

for (const entrada of ['ventana']) {
  for (const demorada of [false, 'transicion', 'previa']) {
    test(`${entrada} A → B sin permiso → A conserva dos tramos de 4000 ms (${demorada || 'sin demora'})`, async () => {
      const reloj = Date.now;
      let instante = 0;
      Date.now = () => instante;
      let liberar;
      try {
        const { api, almacen, permisos } = await preparar();
        let ventana = 1;
        api.windows.getLastFocused = async () => ({ id: ventana, focused: true });
        let pestana = { id: 7, windowId: 1, active: true, status: 'complete', url: 'https://example.com/?privado=1' };
        api.tabs.query = async ({ windowId }) => [windowId === 1
          ? { id: 7, windowId: 1, active: true, status: 'complete', url: 'https://example.com' }
          : { id: 8, windowId: 2, active: true, status: 'complete' }];
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
        ventana = 2;
        api.windows.onFocusChanged.emitir(2);
        if (demorada === 'transicion') {
          await esperando;
          assert.equal(almacen.medicion.tramo, null, 'corta antes de esperar una nueva observación válida');
          assert.deepEqual(almacen.medicion.sesiones.map(s => [s.inicio, s.fin]), [[0, 2000]]);
        }
        else await vaciarCola();
        instante = 2100;
        pestana.status = 'complete';
        // Las pestañas permanecen fijas: no hay eventos de tabs.
        await vaciarCola();
        instante = 7000;
        pestana = { id: 7, windowId: 1, active: true, status: 'complete', url: 'https://example.com/regreso' };
        ventana = 1;
        api.windows.onFocusChanged.emitir(1);
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

test('reanudar tras cambio de ventana fecha A al comprobarlo, sin rellenar el intervalo desconocido', async () => {
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
    let ventana = 2;
    api.windows.getLastFocused = async () => ({ id: ventana, focused: true });
    instante = 2000;
    api.windows.onFocusChanged.emitir(2);
    await esperando;
    assert.equal(almacen.medicion.tramo, null);
    instante = 7000;
    ventana = 1;
    api.windows.onFocusChanged.emitir(1);
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
