import { afterEach, expect, it, vi } from 'vitest';
// @ts-ignore El observador de Chrome es JavaScript sin declaraciones de tipos.
import { avanzarMedicion } from '../../../extension/src/medicion.js';
import { crearSincronizacionNavegador, validarBackend } from '../../../extension/src/sincronizacion';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function almacenamiento() {
  const datos: Record<string, unknown> = {};
  return { datos, get: async (_claves?: unknown) => structuredClone(datos),
    set: async (valores: Record<string, unknown>) => { Object.assign(datos, valores); },
    setAccessLevel: async () => {},
    remove: async (claves: string[]) => { for (const clave of claves) delete datos[clave]; } };
}

it('rechaza servidores inseguros y direcciones con credenciales o rutas arbitrarias', () => {
  for (const url of ['http://gateway.test/api', 'https://a:b@gateway.test/api', 'https://gateway.test/api?x=1', 'https://gateway.test/otra']) {
    expect(() => validarBackend(url)).toThrow();
  }
  expect(validarBackend('https://gateway.test/api/')).toBe('https://gateway.test/api');
});

it('conecta login, consentimiento, ventana corregible y reintento durable tras reiniciar el worker', async () => {
  let ahora = Date.parse('2026-11-25T12:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => ahora);
  const sesion = almacenamiento(); const local = almacenamiento();
  const api = { storage: { session: sesion, local }, permissions: { contains: async () => true } };
  const id = '11111111-1111-4111-8111-111111111111';
  const token = `a.${btoa(JSON.stringify({ user_id: 42, organizacion_id: 'org-A', sid: 'sesion-A' }))}.b`;
  const hechos: unknown[] = [];
  let sinRed = true;
  let esperarRed: (() => Promise<void>) | undefined;
  const fetcher = vi.fn(async (url: string, opciones?: RequestInit) => {
    let respuesta: unknown;
    const cuerpo = opciones?.body ? JSON.parse(opciones.body as string) : null;
    if (url.endsWith('/auth/login/')) respuesta = { access_token: token, refresh_token: token };
    else if (url.endsWith('/uso/consentimiento/')) respuesta = { recolector_id: cuerpo.recolector_id, origen: 'navegador',
      estado: cuerpo.accion === 'revocar' ? 'revocado' : cuerpo.accion === 'pausar' ? 'pausado' : 'activo', version_texto: 'uso-v1',
      desde: '2026-11-25T12:00:00.000Z', servidor_ahora: new Date(ahora).toISOString(), actualizado_en: new Date(ahora).toISOString(), zona_horaria: 'America/Santiago' };
    else if (url.endsWith('/uso/recolector/')) {
      hechos.push(cuerpo);
      if (sinRed) throw new TypeError('sin red');
      if (esperarRed) await esperarRed();
      respuesta = { event_id: cuerpo.event_id, suscripcion_id: id, estado: 'duplicado', recibido_en: new Date(ahora).toISOString() };
    } else if (url.endsWith(`/suscripciones/${id}/`)) respuesta = { id, nombre: 'Servicio', monto: '1000' };
    else throw new Error('Ruta inesperada: ' + url);
    return new Response(JSON.stringify(respuesta), { status: 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  const controlador = {
    guardar: async () => { sesion.datos.configuracion = { id: 'config', sesionId: 'medicion-A', consentimiento: true,
      dominios: ['example.com'], asociaciones: { 'example.com': id } }; }, actualizar: async () => {},
    retirar: async () => { delete sesion.datos.configuracion; delete sesion.datos.autorizacion; },
  };
  const primero = crearSincronizacionNavegador(api);
  await primero.mensaje({ tipo: 'preparar_conexion', urlBase: 'https://gateway.test/api' }, controlador);
  await primero.mensaje({ tipo: 'login', urlBase: 'https://gateway.test/api', correo: 'cuenta@example.com', password: 'clave-simulada' }, controlador);
  sesion.datos.autorizacion = { id: 'intento', asociaciones: { 'example.com': id } };
  const antigua = primero.mensaje({ tipo: 'guardar', intentoId: 'intento', configuracion: { consentimiento: true } }, controlador);
  const retirada = primero.mensaje({ tipo: 'retirar' }, controlador);
  expect(await antigua).toEqual({ ok: false, cancelado: true });
  await retirada;
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/uso/consentimiento/'))).toBe(false);
  sesion.datos.autorizacion = { id: 'intento', asociaciones: { 'example.com': id } };
  await primero.mensaje({ tipo: 'guardar', intentoId: 'intento', configuracion: { consentimiento: true } }, controlador);
  sesion.datos.medicion = { sesionId: 'medicion-A', sesiones: [{ dominio: 'example.com', suscripcionId: id, inicio: ahora, fin: ahora + 8000 }], tramo: null };
  ahora += 120_000;
  await primero.ciclo();
  expect(hechos).toHaveLength(1);
  expect(hechos[0]).toMatchObject({ duracion_ms: 8000, fin: '2026-11-25T12:01:00.000Z' });
  expect(JSON.stringify(hechos[0])).not.toContain('example.com');
  expect(JSON.stringify(sesion.datos.sincronizacion)).toContain('"pendientes":1');
  expect(JSON.stringify(sesion.datos.sincronizacion)).toContain('"ultimoEnvio":null');
  // Sin nuevo tiempo de observación: se reenvía lo persistido, no otro UUID.
  ahora += 10_000; sinRed = false;
  const reiniciado = crearSincronizacionNavegador(api);
  await reiniciado.ciclo();
  expect(hechos[1]).toEqual(hechos[0]);
  expect(JSON.stringify(sesion.datos.sincronizacion)).toContain('"pendientes":0');
  // Crear otro pendiente y dejarlo en vuelo mientras el observador corrige idle.
  sinRed = true;
  const inicio = Date.parse('2026-11-25T12:01:10Z');
  sesion.datos.medicion = { sesionId: 'medicion-A', sesiones: [], tramo: {
    dominio: 'example.com', suscripcionId: id, inicio, confirmadoHasta: ahora } };
  ahora += 20_000;
  await reiniciado.ciclo();
  expect(sesion.datos.sincronizacion).toEqual([expect.objectContaining({ pendientes: 1 })]);
  sinRed = false;
  let liberar!: () => void;
  let iniciado!: () => void;
  const enVuelo = new Promise<void>(resolve => { iniciado = resolve; });
  const acuse = new Promise<void>(resolve => { liberar = resolve; });
  esperarRed = async () => { esperarRed = undefined; iniciado(); await acuse; };
  ahora += 1000;
  const ciclo = reiniciado.ciclo();
  await enVuelo;
  sesion.datos.medicion = avanzarMedicion(sesion.datos.medicion, {
    sesionId: 'medicion-A', dominio: null, estado: 'inactivo', observadoEn: ahora });
  ahora += 9000;
  liberar();
  await ciclo;
  expect(hechos.at(-1)).toMatchObject({ cobertura: 'parcial', duracion_ms: 1000,
    inicio: '2026-11-25T12:01:30.000Z', fin: '2026-11-25T12:01:40.000Z' });

  // Una pausa debe publicar su fase aunque la captura ya no esté autorizada.
  sinRed = true;
  ahora += 30000;
  await reiniciado.ciclo();
  expect(sesion.datos.sincronizacion).toEqual([expect.objectContaining({ fase: 'activo', pendientes: 1, error: expect.any(String) })]);
  await reiniciado.mensaje({ tipo: 'pausar' }, controlador);
  expect(sesion.datos.sincronizacion).toEqual([expect.objectContaining({ fase: 'pausado', pendientes: 1 })]);
  ahora += 10000;
  sinRed = false;
  await reiniciado.mensaje({ tipo: 'sincronizar' }, controlador);
  expect(sesion.datos.sincronizacion).toEqual([expect.objectContaining({ fase: 'pausado', pendientes: 0,
    error: null, ultimoEnvio: new Date(ahora).toISOString() })]);
  expect(Object.values(local.datos).every(v => !String(v).includes('access_token'))).toBe(true);
});
