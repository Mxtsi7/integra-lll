import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navegador, documento, vaciarCola } from './utilidades/navegador.js';

let carga = 0;
async function cargar() {
  const prueba = navegador();
  globalThis.chrome = prueba.api;
  globalThis.document = documento();
  await import(`../src/background.js?caso=${carga++}`);
  await import(`../src/popup.js?caso=${carga++}`);
  await vaciarCola();
  document.querySelector('#dominios').value = 'example.com';
  return prueba;
}
async function aceptar() {
  document.querySelector('#dominios').input?.();
  await vaciarCola();
  return document.querySelector('#configuracion').submit({ preventDefault() {} });
}
function retirar() { return document.querySelector('#retirar').click(); }
function textoCaptura() {
  return document.querySelector('#observacion')?.textContent || document.querySelector('#estado').textContent;
}
async function abrirPanel() {
  globalThis.document = documento();
  await import(`../src/popup.js?caso=${carga++}`);
  await vaciarCola();
}

test('retirar invalida el permiso pendiente; solo una nueva aceptación puede activar', async () => {
  const { api, almacen, permisos } = await cargar();
  const solicitar = api.permissions.request;
  let conceder;
  api.permissions.request = solicitud => new Promise(resolve => { conceder = async () => resolve(await solicitar(solicitud)); });
  const anterior = aceptar();
  await vaciarCola();
  await retirar();
  await conceder();
  await anterior;
  await vaciarCola();
  assert.ok(!almacen.configuracion?.consentimiento, 'la concesión tardía no debe reactivar');
  assert.deepEqual([...permisos], []);
  api.permissions.request = solicitar;
  document.querySelector('#dominios').value = 'example.com';
  document.querySelector('#consentimiento').checked = true;
  await aceptar();
  await vaciarCola();
  assert.equal(almacen.configuracion.consentimiento, true);
});

test('la limpieza tardía respeta el mismo host de una aceptación posterior', async () => {
  const { api, almacen, permisos } = await cargar();
  const solicitar = api.permissions.request;
  let conceder;
  api.permissions.request = solicitud => new Promise(resolve => { conceder = async () => resolve(await solicitar(solicitud)); });
  const anterior = aceptar();
  await vaciarCola();
  await retirar();
  api.permissions.request = solicitar;
  document.querySelector('#dominios').value = 'example.com';
  document.querySelector('#consentimiento').checked = true;
  await aceptar();
  await vaciarCola();
  const sesionNueva = almacen.configuracion.id;
  await conceder();
  await anterior;
  await vaciarCola();
  assert.equal(almacen.configuracion.id, sesionNueva);
  assert.ok(permisos.has('https://example.com/*'));
});

test('cambiar A → B → A entre ventanas fijas invalida el dominio anterior', async () => {
  const { almacen, enfocar } = await cargar();
  await aceptar();
  await vaciarCola();
  assert.equal(almacen.observacion.dominio, 'example.com');
  enfocar(2);
  await vaciarCola();
  assert.equal(almacen.observacion.dominio, null);
  enfocar(1);
  await vaciarCola();
  assert.equal(almacen.observacion.dominio, 'example.com');
});

test('el panel abierto actualiza A a B cuando termina una consulta de pestaña demorada', async () => {
  const { api, almacen, enfocar } = await cargar();
  await aceptar();
  await vaciarCola();
  const consultar = api.tabs.query;
  let liberar, avisar;
  const espera = new Promise(resolve => { liberar = resolve; });
  const consultando = new Promise(resolve => { avisar = resolve; });
  api.tabs.query = async filtros => {
    const pestañas = await consultar(filtros);
    avisar();
    await espera;
    return pestañas;
  };
  enfocar(2);
  await consultando;
  await abrirPanel();
  assert.match(textoCaptura(), /example\.com/);
  liberar();
  await vaciarCola();
  assert.equal(almacen.observacion.dominio, null);
  assert.doesNotMatch(textoCaptura(), /example\.com/);
  assert.match(textoCaptura(), /sin_dominio_autorizado/);
  document.querySelector('#dominios').value = 'nuevo.com';
  await document.querySelector('#dominios').input();
  enfocar(1);
  await vaciarCola();
  assert.match(textoCaptura(), /example\.com/);
  assert.equal(document.querySelector('#dominios').value, 'nuevo.com');
  await retirar();
  await vaciarCola();
  assert.match(textoCaptura(), /sin_consentimiento/);
  assert.doesNotMatch(textoCaptura(), /example\.com/);
});

test('un snapshot inicial demorado no reemplaza la observación más reciente del panel', async () => {
  const { api, enfocar } = await cargar();
  await aceptar();
  await vaciarCola();
  const consultar = api.storage.session.get;
  let liberar, avisar;
  const espera = new Promise(resolve => { liberar = resolve; });
  const leyendo = new Promise(resolve => { avisar = resolve; });
  api.storage.session.get = async claves => {
    const snapshot = await consultar(claves);
    if (Array.isArray(claves) && claves.includes('observacion')) {
      avisar();
      await espera;
    }
    return snapshot;
  };
  await abrirPanel();
  await leyendo;
  enfocar(2);
  await vaciarCola();
  liberar();
  await vaciarCola();
  assert.doesNotMatch(textoCaptura(), /example\.com/);
  assert.match(textoCaptura(), /sin_dominio_autorizado/);
});

test('la limpieza de A conserva permisos de B mientras su aceptación está pendiente', async () => {
  const { api, almacen, permisos } = await cargar();
  const solicitar = api.permissions.request;
  let concederAnterior;
  api.permissions.request = solicitud => new Promise(resolve => { concederAnterior = async () => resolve(await solicitar(solicitud)); });
  const anterior = aceptar();
  await vaciarCola();
  await retirar();
  let confirmarNueva;
  api.permissions.request = solicitud => new Promise(resolve => {
    solicitud.origins.forEach(origen => permisos.add(origen));
    confirmarNueva = () => resolve(true);
  });
  document.querySelector('#dominios').value = 'nuevo.com';
  document.querySelector('#consentimiento').checked = true;
  const nueva = aceptar();
  await vaciarCola();
  await concederAnterior();
  await anterior;
  await vaciarCola();
  assert.ok(permisos.has('https://nuevo.com/*'));
  assert.ok(!permisos.has('https://example.com/*'));
  confirmarNueva();
  await nueva;
  await vaciarCola();
  assert.deepEqual(almacen.configuracion.dominios, ['nuevo.com']);
});

test('una limpieza antigua en vuelo termina antes de pedir los permisos de B', async () => {
  const { api, almacen, permisos } = await cargar();
  const solicitar = api.permissions.request;
  let concederAnterior;
  api.permissions.request = solicitud => new Promise(resolve => { concederAnterior = async () => resolve(await solicitar(solicitud)); });
  const anterior = aceptar();
  await vaciarCola();
  await retirar();
  const consultar = api.permissions.getAll;
  let liberar, avisar;
  const espera = new Promise(resolve => { liberar = resolve; });
  const limpiando = new Promise(resolve => { avisar = resolve; });
  let primeraConsulta = true;
  api.permissions.getAll = async () => {
    if (primeraConsulta) { primeraConsulta = false; avisar(); await espera; }
    return consultar();
  };
  const concesion = concederAnterior();
  await limpiando;
  api.permissions.request = solicitar;
  document.querySelector('#dominios').value = 'nuevo.com';
  document.querySelector('#consentimiento').checked = true;
  const nueva = aceptar();
  await vaciarCola();
  const concedidoAntesDeRegistrar = permisos.has('https://nuevo.com/*');
  liberar();
  await Promise.all([concesion, anterior, nueva]);
  await vaciarCola();
  assert.equal(concedidoAntesDeRegistrar, false, 'no pedir permisos hasta registrar el intento después de la limpieza');
  await document.querySelector('#configuracion').submit({ preventDefault() {} });
  await vaciarCola();
  assert.deepEqual(almacen.configuracion.dominios, ['nuevo.com']);
  assert.ok(permisos.has('https://nuevo.com/*'));
});

test('una retirada lenta no desmarca ni borra una selección posterior', async () => {
  const { api, almacen } = await cargar();
  await aceptar();
  await vaciarCola();
  const consultar = api.permissions.getAll;
  let liberar, avisar;
  const espera = new Promise(resolve => { liberar = resolve; });
  const limpiando = new Promise(resolve => { avisar = resolve; });
  let primeraConsulta = true;
  api.permissions.getAll = async () => {
    if (primeraConsulta) { primeraConsulta = false; avisar(); await espera; }
    return consultar();
  };
  const retirada = retirar();
  await limpiando;
  document.querySelector('#dominios').value = 'nuevo.com';
  document.querySelector('#consentimiento').checked = true;
  const preparada = document.querySelector('#dominios').input();
  liberar();
  await Promise.all([retirada, preparada]);
  await vaciarCola();
  assert.equal(document.querySelector('#consentimiento').checked, true);
  assert.equal(document.querySelector('#dominios').value, 'nuevo.com');
  await document.querySelector('#configuracion').submit({ preventDefault() {} });
  await vaciarCola();
  assert.deepEqual(almacen.configuracion.dominios, ['nuevo.com']);
});

test('el worker integrado conserva foco, idle y bloqueo sin reactivar una retirada', async () => {
  const { api, almacen } = await cargar();
  await aceptar();
  await vaciarCola();
  assert.equal(almacen.observacion.estado, 'activo');
  const ventana = api.windows.getLastFocused;
  api.windows.getLastFocused = async () => ({ id: 1, focused: false });
  api.windows.onFocusChanged.emitir(-1);
  await vaciarCola();
  assert.equal(almacen.observacion.estado, 'sin_foco');
  assert.equal(almacen.observacion.dominio, null);
  api.windows.getLastFocused = ventana;
  for (const [actividad, esperado] of [['idle', 'inactivo'], ['locked', 'bloqueado'], ['active', 'activo']]) {
    api.idle.queryState = async () => actividad;
    api.idle.onStateChanged.emitir(actividad);
    await vaciarCola();
    assert.equal(almacen.observacion.estado, esperado);
    assert.equal(almacen.observacion.dominio, actividad === 'active' ? 'example.com' : null);
  }
  await retirar();
  api.idle.onStateChanged.emitir('active');
  await vaciarCola();
  assert.equal(almacen.observacion.estado, 'sin_consentimiento');
  assert.equal(almacen.observacion.dominio, null);
});

test('retirar sustituye mensajes de preparación y autorización confirmadas', async () => {
  await cargar();
  await document.querySelector('#dominios').input();
  assert.match(document.querySelector('#estado').textContent, /Revisa/);
  await retirar();
  assert.equal(document.querySelector('#estado').textContent, 'Consentimiento retirado. Sesión borrada.');
  document.querySelector('#dominios').value = 'example.com';
  document.querySelector('#consentimiento').checked = true;
  await aceptar();
  assert.match(document.querySelector('#estado').textContent, /Dominios autorizados/);
  await retirar();
  assert.equal(document.querySelector('#estado').textContent, 'Consentimiento retirado. Sesión borrada.');
});

test('conserva la pausa y su instante aunque la cola espere siete segundos', async () => {
  const { api, almacen } = await cargar();
  await aceptar();
  await vaciarCola();
  const reloj = Date.now;
  const consultar = api.tabs.query;
  let liberar, avisar;
  const esperando = new Promise(resolve => { avisar = resolve; });
  const espera = new Promise(resolve => { liberar = resolve; });
  const estados = [];
  api.storage.onChanged.addListener(cambios => {
    if (cambios.observacion) estados.push(cambios.observacion.newValue);
  });
  let instante = 1000;
  Date.now = () => instante;
  try {
    api.tabs.query = async consulta => { avisar(); await espera; return consultar(consulta); };
    api.tabs.onActivated.emitir({});
    await esperando;
    instante = 2000;
    api.windows.onFocusChanged.emitir(-1);
    instante = 9000;
    api.windows.onFocusChanged.emitir(1);
    liberar();
    await vaciarCola();
    const pausa = estados.find(estado => estado.estado === 'sin_foco');
    assert.ok(pausa, 'la recuperación no debe borrar la pausa encolada');
    assert.equal(pausa.observadoEn, 2000);
    assert.equal(almacen.observacion.estado, 'activo');
    assert.equal(estados.at(-1).observadoEn, 9000);
  } finally { liberar(); Date.now = reloj; }
});

test('el motor integrado excluye siete segundos sin foco y conserva la asociación al editar', async () => {
  const { api, almacen } = await cargar();
  const reloj = Date.now;
  let instante = 0;
  Date.now = () => instante;
  const id = '21e0cc35-c621-42f0-81c2-59d68cfb899e';
  try {
    document.querySelector('#asociaciones').value = `example.com=${id}`;
    await aceptar();
    await vaciarCola();
    const sesionId = almacen.configuracion.sesionId;
    const consultar = api.tabs.query;
    let liberar, avisar;
    const espera = new Promise(resolve => { liberar = resolve; });
    const esperando = new Promise(resolve => { avisar = resolve; });
    instante = 1000;
    api.tabs.query = async consulta => { avisar(); await espera; return consultar(consulta); };
    api.tabs.onActivated.emitir({});
    await esperando;
    instante = 2000;
    api.windows.onFocusChanged.emitir(-1);
    instante = 9000;
    api.windows.onFocusChanged.emitir(1);
    liberar();
    await vaciarCola();
    instante = 12000;
    api.alarms.onAlarm.emitir({ name: 'observar-uso' });
    await vaciarCola();
    const ms = almacen.medicion.sesiones.reduce((total, s) => total + s.duracionMs, 0) +
      almacen.medicion.tramo.confirmadoHasta - almacen.medicion.tramo.inicio;
    assert.equal(ms, 5000, '12 s de recorrido menos 7 s sin foco');
    assert.equal(almacen.configuracion.asociaciones['example.com'], id);
    assert.equal(almacen.medicion.tramo.suscripcionId, id);
    instante = 13000;
    document.querySelector('#asociaciones').value = 'example.com=31e0cc35-c621-42f0-81c2-59d68cfb899e';
    await document.querySelector('#asociaciones').input();
    await document.querySelector('#configuracion').submit({ preventDefault() {} });
    await vaciarCola();
    assert.equal(almacen.configuracion.sesionId, sesionId);
    assert.equal(almacen.medicion.sesiones.at(-1).suscripcionId, id);
    assert.equal(almacen.medicion.tramo.suscripcionId, '31e0cc35-c621-42f0-81c2-59d68cfb899e');
    assert.equal(almacen.medicion.tramo.inicio, 13000);
    assert.deepEqual(JSON.parse(document.querySelector('#minutos').textContent), { 'example.com': 0.1 });
  } finally { Date.now = reloj; }
});

test('conserva idle y bloqueo recibidos durante una consulta pendiente', async () => {
  const { api } = await cargar();
  await aceptar();
  await vaciarCola();
  const reloj = Date.now;
  const consultar = api.tabs.query;
  let liberar, avisar;
  const espera = new Promise(resolve => { liberar = resolve; });
  const esperando = new Promise(resolve => { avisar = resolve; });
  const estados = [];
  api.storage.onChanged.addListener(cambios => {
    if (cambios.observacion) estados.push(cambios.observacion.newValue);
  });
  let instante = 1000;
  Date.now = () => instante;
  try {
    api.tabs.query = async consulta => { avisar(); await espera; return consultar(consulta); };
    api.tabs.onActivated.emitir({});
    await esperando;
    instante = 2000;
    api.idle.onStateChanged.emitir('idle');
    instante = 3000;
    api.idle.onStateChanged.emitir('locked');
    api.windows.onFocusChanged.emitir(-1);
    instante = 9000;
    api.idle.onStateChanged.emitir('active');
    liberar();
    await vaciarCola();
    assert.ok(estados.some(e => e.estado === 'inactivo' && e.observadoEn === 2000));
    assert.equal(estados.filter(e => e.observadoEn === 3000).length, 2);
    assert.ok(estados.filter(e => e.observadoEn === 3000).every(e => e.estado === 'bloqueado'));
    assert.equal(estados.at(-1).estado, 'activo');
  } finally { liberar(); Date.now = reloj; }
});

test('un error real del worker corta el tramo antes de recuperar actividad', async () => {
  const { api, almacen } = await cargar();
  const reloj = Date.now;
  let instante = 0;
  Date.now = () => instante;
  try {
    await aceptar();
    await vaciarCola();
    const consultar = api.tabs.query;
    instante = 20000;
    api.tabs.query = async () => { throw new Error('consulta fallida'); };
    api.alarms.onAlarm.emitir({ name: 'observar-uso' });
    await vaciarCola();
    assert.equal(almacen.observacion.estado, 'error_de_consulta');
    assert.equal(almacen.medicion.tramo, null);
    instante = 30000;
    api.tabs.query = consultar;
    api.alarms.onAlarm.emitir({ name: 'observar-uso' });
    await vaciarCola();
    assert.deepEqual(JSON.parse(document.querySelector('#minutos').textContent), {});
  } finally { Date.now = reloj; }
});

test('navegar sin URL en el evento deja de mostrar A antes de terminar la carga de B', async () => {
  const { api, almacen } = await cargar();
  await aceptar();
  await vaciarCola();
  assert.match(textoCaptura(), /activo example.com/);
  let actual = [{ active: true }]; // Chrome oculta la URL de B porque no tiene permiso.
  api.tabs.query = async () => actual;
  api.tabs.onUpdated.emitir(7, { status: 'loading' }, { id: 7, active: true });
  await vaciarCola();
  assert.equal(almacen.observacion.dominio, null);
  assert.ok(!textoCaptura().includes('example.com'), 'el panel no espera status=complete');
  actual = [{ active: true, url: 'https://example.com/regreso' }];
  api.tabs.onUpdated.emitir(7, { status: 'loading' }, { id: 7, active: true });
  await vaciarCola();
  assert.equal(almacen.observacion.dominio, 'example.com');
  assert.match(textoCaptura(), /activo example.com/);
  assert.deepEqual([...almacen.configuracion.dominios], ['example.com']);
});

test('los tramos no se solapan al pausar, reanudar y alternar entre ventanas', async () => {
  const { api, almacen, enfocar } = await cargar();
  const reloj = Date.now;
  let instante = 0;
  Date.now = () => instante;
  try {
    await aceptar();
    await vaciarCola();
    for (const [t, ventana] of [[2000, -1], [9000, 1], [12000, 2], [16000, 1], [19000, -1]]) {
      instante = t;
      if (ventana === -1) api.windows.onFocusChanged.emitir(-1);
      else enfocar(ventana);
      await vaciarCola();
    }
    const sesiones = almacen.medicion.sesiones;
    assert.deepEqual(sesiones.map(s => [s.inicio, s.fin]), [[0, 2000], [9000, 12000], [16000, 19000]]);
    for (let i = 1; i < sesiones.length; i++) assert.ok(sesiones[i - 1].fin <= sesiones[i].inicio);
    assert.equal(sesiones.reduce((ms, s) => ms + s.duracionMs, 0), 8000);
    assert.equal(almacen.medicion.tramo, null);
  } finally { Date.now = reloj; }
});

test('loading con URL anterior no conserva A y un commit sin URL tampoco lo reactiva', async () => {
  const { api, almacen } = await cargar();
  await aceptar();
  await vaciarCola();
  let actual = { active: true, url: 'https://example.com/anterior', status: 'loading' };
  api.tabs.query = async () => [actual];
  api.tabs.onUpdated.emitir(7, { status: 'loading' }, { id: 7, active: true });
  await vaciarCola();
  assert.equal(almacen.observacion.dominio, null, 'la última URL confirmada no prueba actividad de la navegación pendiente');
  actual = { active: true, status: 'loading' };
  api.tabs.onUpdated.emitir(7, {}, { id: 7, active: true, status: 'loading' });
  await vaciarCola();
  assert.ok(!textoCaptura().includes('example.com'));
  actual = { active: true, url: 'https://example.com/regreso', status: 'complete' };
  api.tabs.onUpdated.emitir(7, { status: 'complete' }, { id: 7, active: true });
  await vaciarCola();
  assert.equal(almacen.observacion.dominio, 'example.com');
});

test('cargar la pestaña activa de otra ventana no pausa la ventana enfocada', async () => {
  const { api, almacen } = await cargar();
  await aceptar();
  await vaciarCola();
  api.tabs.onUpdated.emitir(8, { status: 'loading' }, { id: 8, active: true, windowId: 2 });
  await vaciarCola();
  assert.equal(almacen.observacion.estado, 'activo');
  assert.equal(almacen.observacion.dominio, 'example.com');
});


test('una reconsulta superada no atribuye B a la hora anterior de A al reanudar', async () => {
  const { api, almacen } = await cargar();
  const reloj = Date.now;
  let instante = 0;
  Date.now = () => instante;
  let liberar;
  try {
    document.querySelector('#dominios').value = 'example.com\notro.com';
    await aceptar();
    await vaciarCola();
    let dominio = 'example.com';
    let avisar;
    const esperando = new Promise(resolve => { avisar = resolve; });
    const espera = new Promise(resolve => { liberar = resolve; });
    let primera = true;
    api.tabs.query = async () => {
      if (primera) { primera = false; avisar(); await espera; }
      return [{ active: true, url: `https://${dominio}` }];
    };
    const observaciones = [];
    api.storage.onChanged.addListener(cambios => { if (cambios.observacion) observaciones.push(cambios.observacion.newValue); });
    instante = 1000;
    api.tabs.onActivated.emitir({});
    await esperando;
    instante = 2000;
    api.windows.onFocusChanged.emitir(-1);
    instante = 9000;
    api.windows.onFocusChanged.emitir(1);
    instante = 11000;
    dominio = 'otro.com';
    api.tabs.onActivated.emitir({});
    liberar();
    await vaciarCola();
    assert.ok(!observaciones.some(o => o.dominio === 'otro.com' && o.observadoEn < 11000));
    assert.ok(observaciones.some(o => o.estado === 'sin_foco' && o.observadoEn === 2000));
    assert.equal(almacen.observacion.dominio, 'otro.com');
    assert.equal(almacen.observacion.observadoEn, 11000);
    instante = 13000;
    api.windows.onFocusChanged.emitir(-1);
    await vaciarCola();
    // El consumidor real de #151 no puede convertir la reconsulta de las 9 s en 4 s para B.
    {
      assert.deepEqual(almacen.medicion.sesiones.map(s => [s.dominio, s.inicio, s.fin]),
        [['example.com', 0, 2000], ['otro.com', 11000, 13000]]);
    }
  } finally { liberar?.(); Date.now = reloj; }
});

test('idle recibido durante una lectura pendiente conserva el corte de la pausa real', async () => {
  const { api, almacen } = await cargar();
  const reloj = Date.now;
  let instante = 0;
  Date.now = () => instante;
  let liberar;
  try {
    await aceptar();
    await vaciarCola();
    for (const t of [30000, 60000]) { instante = t; api.tabs.onActivated.emitir({}); await vaciarCola(); }
    let avisar;
    const esperando = new Promise(resolve => { avisar = resolve; });
    const espera = new Promise(resolve => { liberar = resolve; });
    let actividad = 'active';
    api.idle.queryState = async () => { avisar(); await espera; return actividad; };
    const observaciones = [];
    api.storage.onChanged.addListener(cambios => { if (cambios.observacion) observaciones.push(cambios.observacion.newValue); });
    instante = 61000;
    api.tabs.onActivated.emitir({});
    await esperando;
    instante = 62000;
    actividad = 'idle';
    api.idle.onStateChanged.emitir('idle');
    liberar();
    await vaciarCola();
    assert.deepEqual(observaciones.map(o => [o.estado, o.observadoEn]), [['inactivo', 62000]]);
    {
      assert.deepEqual(almacen.medicion.sesiones.map(s => [s.inicio, s.fin]), [[0, 2000]]);
      assert.equal(almacen.medicion.tramo, null);
    }
  } finally { liberar?.(); Date.now = reloj; }
});

test('una lectura no superada fecha su resultado al completarse, sin retroceder al evento', async () => {
  const { api, almacen } = await cargar();
  await aceptar();
  await vaciarCola();
  const reloj = Date.now;
  let instante = 1000;
  Date.now = () => instante;
  let liberar;
  try {
    let avisar;
    const esperando = new Promise(resolve => { avisar = resolve; });
    const espera = new Promise(resolve => { liberar = resolve; });
    api.tabs.query = async () => { avisar(); await espera; return [{ active: true, url: 'https://example.com' }]; };
    api.tabs.onActivated.emitir({});
    await esperando;
    instante = 5000;
    liberar();
    await vaciarCola();
    assert.equal(almacen.observacion.observadoEn, 5000);
  } finally { liberar?.(); Date.now = reloj; }
});

test('un error de lectura superada no se publica después de una pausa recibida', async () => {
  const { api } = await cargar();
  await aceptar();
  await vaciarCola();
  const reloj = Date.now;
  let instante = 1000;
  Date.now = () => instante;
  let liberar;
  try {
    let avisar;
    const esperando = new Promise(resolve => { avisar = resolve; });
    const espera = new Promise(resolve => { liberar = resolve; });
    api.tabs.query = async () => { avisar(); await espera; throw new Error('lectura antigua fallida'); };
    const estados = [];
    api.storage.onChanged.addListener(cambios => { if (cambios.observacion) estados.push(cambios.observacion.newValue); });
    api.tabs.onActivated.emitir({});
    await esperando;
    instante = 2000;
    api.windows.onFocusChanged.emitir(-1);
    liberar();
    await vaciarCola();
    assert.deepEqual(estados.map(o => [o.estado, o.observadoEn]), [['sin_foco', 2000]]);
  } finally { liberar?.(); Date.now = reloj; }
});

test('un error superado mientras lee la medición no borra tiempo previo a la pausa', async () => {
  const { api, almacen } = await cargar();
  const reloj = Date.now;
  let instante = 0;
  Date.now = () => instante;
  let liberar;
  try {
    await aceptar();
    await vaciarCola();
    const consultar = api.storage.session.get;
    let avisar;
    const esperando = new Promise(resolve => { avisar = resolve; });
    const espera = new Promise(resolve => { liberar = resolve; });
    let primera = true;
    api.storage.session.get = async clave => {
      if (clave === 'medicion' && primera) { primera = false; avisar(); await espera; }
      return consultar(clave);
    };
    api.tabs.query = async () => { throw new Error('consulta fallida'); };
    const estados = [];
    api.storage.onChanged.addListener(cambios => { if (cambios.observacion) estados.push(cambios.observacion.newValue); });
    instante = 1000;
    api.tabs.onActivated.emitir({});
    await esperando;
    instante = 2000;
    api.windows.onFocusChanged.emitir(-1);
    liberar();
    await vaciarCola();
    assert.deepEqual(estados.map(o => [o.estado, o.observadoEn]), [['sin_foco', 2000]]);
    assert.deepEqual(almacen.medicion.sesiones.map(s => [s.inicio, s.fin]), [[0, 2000]]);
  } finally { liberar?.(); Date.now = reloj; }
});
