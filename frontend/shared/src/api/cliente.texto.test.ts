import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurarApi, ErrorDeApi, pedir } from './cliente';
import { configurarTokenStorage, configureAuthApi } from '../auth';

// Aquí NO se simula pedir: solo la red (fetch). Comprueba la lectura como texto, que usa la
// exportación CSV (S3-CH-25), contra respuestas reales de fetch.
const almacen: Record<string, string> = {};

describe('pedir() con la respuesta como texto (S3-CH-25)', () => {
  const fetchSimulado = vi.fn();

  beforeEach(() => {
    for (const clave of Object.keys(almacen)) delete almacen[clave];
    configurarTokenStorage({
      getItem: (clave: string) => almacen[clave] ?? null,
      setItem: (clave: string, valor: string) => {
        almacen[clave] = valor;
      },
      removeItem: (clave: string) => {
        delete almacen[clave];
      },
    });
    fetchSimulado.mockReset();
    vi.stubGlobal('fetch', fetchSimulado);
    configurarApi({ urlBase: 'http://api.test/api' });
    configureAuthApi({ baseUrl: 'http://api.test/api' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('devuelve el cuerpo tal cual, sin intentar leerlo como JSON', async () => {
    const csv = 'servicio,monto\r\nSpotify,5900.00\r\n';
    fetchSimulado.mockResolvedValue(new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } }));

    await expect(pedir<string>('/suscripciones/exportar-csv/', { respuesta: 'texto' })).resolves.toBe(csv);
  });

  it('conserva las tildes del archivo', async () => {
    fetchSimulado.mockResolvedValue(new Response('Música,CLP\r\n', { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } }));

    await expect(pedir<string>('/x/', { respuesta: 'texto' })).resolves.toBe('Música,CLP\r\n');
  });

  it('un error sigue leyéndose como JSON: el servidor responde un 400 con su cuerpo de siempre', async () => {
    fetchSimulado.mockResolvedValue(
      new Response(JSON.stringify({ hasta: ['Debe ser igual o posterior a la fecha desde.'] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const error = await pedir<string>('/x/', { respuesta: 'texto' }).catch((fallo: unknown) => fallo);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect((error as ErrorDeApi).status).toBe(400);
    expect((error as ErrorDeApi).message).toBe('Debe ser igual o posterior a la fecha desde.');
    expect((error as ErrorDeApi).campos).toEqual({ hasta: ['Debe ser igual o posterior a la fecha desde.'] });
  });

  it('sin la opción sigue leyendo JSON, como antes', async () => {
    fetchSimulado.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(pedir<{ ok: boolean }>('/x/')).resolves.toEqual({ ok: true });
  });
});
