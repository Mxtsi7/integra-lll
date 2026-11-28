import { afterEach, expect, it, vi } from 'vitest';
import { configurarApi, configureAuthApi } from '@ojoalgasto/shared';
import { inicializarStorageSeguro, guardarTokensSeguros, limpiarSesionSegura, __reiniciarEstadoParaPruebas } from './storageSeguro';
import { controlAsociacionPaquetes } from './usoAndroidAsociacion';
import { aceptarUsoAndroid, cicloUsoAndroid, detenerUsoAndroid, estadoUsoAndroid, pausarUsoAndroid, revocarUsoAndroid } from './usoAndroidSincronizacion';

const nativo = vi.hoisted(() => ({ tienePermiso: vi.fn(async () => true), leerTramos: vi.fn(), abrirAjustes: vi.fn(), leerEstadisticas: vi.fn() }));
vi.mock('./usoAndroidNativo', () => ({ usoAndroidNativo: nativo }));

afterEach(async () => {
  detenerUsoAndroid(); await limpiarSesionSegura(); __reiniciarEstadoParaPruebas();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('usa asociación propia, persiste antes del envío, retoma cursor y excluye el período pausado', async () => {
  let ahora = Date.parse('2026-11-25T12:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => ahora);
  const disco = new Map<string, string>();
  inicializarStorageSeguro({ getItemAsync: async k => disco.get(k) ?? null,
    setItemAsync: async (k, v) => { disco.set(k, v); }, deleteItemAsync: async k => { disco.delete(k); } });
  const token = `a.${btoa(JSON.stringify({ user_id: 42, organizacion_id: 'org', sid: 'sesion', exp: Math.floor(ahora / 1000) + 3600 }))}.b`;
  await guardarTokensSeguros({ access_token: token, refresh_token: token });
  configurarApi({ urlBase: 'https://gateway.test/api' }); configureAuthApi({ baseUrl: 'https://gateway.test/api' });
  const id = '11111111-1111-4111-8111-111111111111';
  const enviados: Record<string, unknown>[] = [];
  let sinRed = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, opciones?: RequestInit) => {
    const cuerpo = opciones?.body ? JSON.parse(opciones.body as string) : null;
    let respuesta: unknown;
    if (url.endsWith('/uso/consentimiento/')) respuesta = { recolector_id: cuerpo.recolector_id, origen: 'android',
      estado: cuerpo.accion === 'revocar' ? 'revocado' : cuerpo.accion === 'pausar' ? 'pausado' : 'activo',
      version_texto: 'uso-v1', desde: new Date(ahora).toISOString(), servidor_ahora: new Date(ahora).toISOString(),
      actualizado_en: new Date(ahora).toISOString(), zona_horaria: 'America/Santiago' };
    else if (url.endsWith('/uso/recolector/')) {
      expect([...disco.keys()].some(k => k.startsWith('cola_uso_recolector_'))).toBe(true);
      enviados.push(cuerpo);
      if (sinRed) throw new TypeError('sin red');
      respuesta = { event_id: cuerpo.event_id, suscripcion_id: id, estado: 'aceptado', recibido_en: new Date(ahora).toISOString() };
    } else respuesta = { id, nombre: 'Servicio', monto: '1000' };
    return new Response(JSON.stringify(respuesta), { status: 200 });
  }));
  await expect(aceptarUsoAndroid('com.ejemplo.app')).rejects.toThrow('Primero asocia');
  await controlAsociacionPaquetes.asociar(id, 'com.ejemplo.app');
  let resolverPermiso!: (valor: boolean) => void;
  let comprobando = false;
  nativo.tienePermiso.mockImplementationOnce(() => { comprobando = true; return new Promise<boolean>(resolve => { resolverPermiso = resolve; }); });
  const anterior = expect(aceptarUsoAndroid('com.ejemplo.app')).rejects.toThrow('cancelada');
  await vi.waitFor(() => expect(comprobando).toBe(true));
  await revocarUsoAndroid();
  resolverPermiso(true); await anterior;
  await aceptarUsoAndroid('com.ejemplo.app');
  const desde = ahora;
  ahora += 30_000;
  nativo.leerTramos.mockResolvedValue([{ paquete: 'com.ejemplo.app', inicioMs: desde, finMs: ahora }]);
  await cicloUsoAndroid();
  expect((await estadoUsoAndroid()).estado?.pendientes).toHaveLength(1);
  expect((await estadoUsoAndroid()).estado?.ultimoEnvio).toBeUndefined();
  detenerUsoAndroid(); // Simular nueva instancia sin borrar SecureStore.
  sinRed = false; ahora += 2000; nativo.leerTramos.mockResolvedValue([]);
  await cicloUsoAndroid();
  expect(enviados[1]).toEqual(enviados[0]);
  expect(nativo.leerTramos).toHaveBeenLastCalledWith(desde + 30_000, ahora, ['com.ejemplo.app'], true);
  await pausarUsoAndroid();
  const lecturas = nativo.leerTramos.mock.calls.length;
  ahora += 60_000; await cicloUsoAndroid();
  expect(nativo.leerTramos).toHaveBeenCalledTimes(lecturas);
  await aceptarUsoAndroid('com.ejemplo.app');
  const reanudado = ahora; ahora += 5000;
  await cicloUsoAndroid();
  expect(nativo.leerTramos).toHaveBeenLastCalledWith(reanudado, ahora, ['com.ejemplo.app'], true);
  await revocarUsoAndroid();
  expect((await estadoUsoAndroid()).estado?.fase).toBe('revocado');
  await limpiarSesionSegura();
  expect([...disco.keys()].filter(k => k.startsWith('cola_uso_recolector'))).toEqual([]);
});
