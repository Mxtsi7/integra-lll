import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dominioAutorizado, normalizarDominio } from '../src/dominio.js';

test('normaliza hostname y descarta rutas, credenciales y esquemas no admitidos', () => {
  assert.equal(normalizarDominio(' NETFLIX.COM. '), 'netflix.com');
  for (const entrada of ['https://netflix.com', 'netflix.com/perfil', '*.netflix.com', '', 'localhost', 'netflix.com?x=1']) {
    assert.equal(normalizarDominio(entrada), null);
  }
});

test('observa exclusivamente el host HTTPS autorizado sin conservar URL sensible', () => {
  const permitidos = ['netflix.com'];
  assert.equal(dominioAutorizado('https://netflix.com/watch/123?token=secreto#perfil', permitidos), 'netflix.com');
  for (const url of [undefined, 'chrome://extensions', 'http://netflix.com', 'https://netflix.com.evil.org', 'https://www.netflix.com', 'https://user:pass@netflix.com']) {
    assert.equal(dominioAutorizado(url, permitidos), null);
  }
});
