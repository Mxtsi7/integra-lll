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
