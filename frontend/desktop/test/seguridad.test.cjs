const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { configurarApi, esInterna, resolverArchivo, politicaCSP } = require('../seguridad.cjs');
test('API permite HTTPS y loopback; rechaza credenciales, otras URLs y payloads', () => {
  assert.equal(configurarApi('https://api.example.test/api/'), 'https://api.example.test/api');
  assert.equal(configurarApi('http://127.0.0.1:8000/api'), 'http://127.0.0.1:8000/api');
  for (const url of ['http://remoto.test/api', 'file:///api', 'https://user:clave@api.test/api', 'https://api.test/api?token=x', 'https://api.test/api#x', 'javascript:alert(1)']) assert.throws(() => configurarApi(url));
});
test('navegación permanece en el origen empaquetado', () => {
  assert.ok(esInterna('app://ojoalgasto/home'));
  for (const url of ['https://ojoalgasto/home', 'file:///secreto', 'app://otro/home', 'app://usuario@ojoalgasto/home']) assert.equal(esInterna(url), false);
});
test('las rutas decodificadas no salen del renderer', () => {
  const raiz = path.resolve('renderer');
  assert.equal(resolverArchivo(raiz, 'app://ojoalgasto/assets/app.js'), path.join(raiz, 'assets/app.js'));
  for (const url of ['app://ojoalgasto/%00', 'app://ojoalgasto/%2e%2e%5csecreto', 'app://otro/index.html']) assert.throws(() => resolverArchivo(raiz, url));
});
test('CSP autoriza únicamente el origen configurado para conexiones', () => {
  const csp = politicaCSP('https://api.example.test/api');
  assert.ok(csp.includes('connect-src https://api.example.test;'));
  assert.ok(!csp.includes('unsafe-eval') && !csp.includes('connect-src *'));
});
