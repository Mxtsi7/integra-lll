import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avanzarMedicion, resumirMinutos } from '../src/medicion.js';
import { leerAsociaciones } from '../src/dominio.js';

const activo = observadoEn => ({ dominio: 'example.com', estado: 'activo', observadoEn, sesionId: 'A' });
test('cierra un tramo con tiempo transcurrido y no suma pérdida de foco', () => {
  let medicion = avanzarMedicion(undefined, activo(1000));
  medicion = avanzarMedicion(medicion, activo(31000));
  medicion = avanzarMedicion(medicion, { ...activo(41000), dominio: null, estado: 'sin_foco' });
  medicion = avanzarMedicion(medicion, activo(90000));
  assert.equal(resumirMinutos(medicion)['example.com'], 40000 / 60000);
  assert.equal(medicion.sesiones.length, 1);
});
test('worker suspendido, reloj atrás o sesión diferente no inventan tiempo', () => {
  for (const siguiente of [activo(300000), activo(500), { ...activo(31000), sesionId: 'B' }]) {
    const medicion = avanzarMedicion(avanzarMedicion(undefined, activo(1000)), siguiente);
    assert.deepEqual(resumirMinutos(medicion), {});
  }
});
test('inactividad descuenta el umbral sin producir duraciones negativas', () => {
  let medicion;
  for (const instante of [0, 30000, 60000, 90000]) medicion = avanzarMedicion(medicion, activo(instante));
  medicion = avanzarMedicion(medicion, { ...activo(100000), estado: 'inactivo', dominio: null });
  assert.equal(resumirMinutos(medicion)['example.com'], 40000 / 60000);
});
test('un tramo que cruza medianoche conserva intervalos UTC sin redondear', () => {
  const inicio = Date.parse('2026-11-08T23:59:50Z');
  const medicion = avanzarMedicion(avanzarMedicion(undefined, activo(inicio)), {
    ...activo(inicio + 20000), estado: 'sin_foco', dominio: null,
  });
  assert.equal(resumirMinutos(medicion)['example.com'], 1 / 3);
});

test('un error de consulta corta en la última confirmación y no suma el hueco al recuperar', () => {
  let medicion = avanzarMedicion(undefined, activo(0));
  medicion = avanzarMedicion(medicion, { ...activo(20000), estado: 'error_de_consulta', dominio: null });
  medicion = avanzarMedicion(medicion, activo(30000));
  assert.deepEqual(resumirMinutos(medicion), {});
});
test('bloquear pantalla después de entrada reciente no descuenta un minuto válido', () => {
  let medicion;
  for (const instante of [0, 30000, 60000, 90000, 120000]) medicion = avanzarMedicion(medicion, activo(instante));
  medicion = avanzarMedicion(medicion, { ...activo(120100), estado: 'bloqueado', dominio: null });
  assert.equal(resumirMinutos(medicion)['example.com'], 120100 / 60000);
});
test('asocia dominios exactos a UUID explícitos y rechaza ambigüedad', () => {
  const id = '21e0cc35-c621-42f0-81c2-59d68cfb899e';
  assert.deepEqual(leerAsociaciones(`WWW.Example.com = ${id}`, ['www.example.com']), { 'www.example.com': id });
  for (const entrada of [`example.com=${id}`, 'www.example.com=Netflix', `www.example.com=${id}\nwww.example.com=${id}`]) {
    assert.throws(() => leerAsociaciones(entrada, ['www.example.com']));
  }
});
