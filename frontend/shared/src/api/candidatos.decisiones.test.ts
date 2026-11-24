import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurarApi, ErrorDeApi } from './cliente';
import {
  codigoDeConfirmacionRechazada,
  codigoDeRechazoNoPermitido,
  confirmarCandidato,
  rechazarCandidato,
} from './candidatos';
import { configurarTokenStorage, configureAuthApi } from '../auth';

// Aquí NO se simula pedir: solo la red (fetch). Comprueba de punta a punta que el código de un 409
// real, con el cuerpo que manda connectors (`{ codigo, detail }`), llega hasta el código reconocible.
const almacen: Record<string, string> = {};

function respuesta(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('confirmar y rechazar contra el cuerpo real del servidor (S3-CH-08 y S3-CH-09)', () => {
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

  it('un 409 de confirmar con { codigo, detail } deja el texto como mensaje y el código reconocible', async () => {
    fetchSimulado.mockResolvedValue(
      respuesta(409, { codigo: 'servicio_sin_resolver', detail: 'No se reconoció el proveedor de este cobro.' }),
    );

    const error = await confirmarCandidato('c-1').catch((fallo: unknown) => fallo);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect((error as ErrorDeApi).message).toBe('No se reconoció el proveedor de este cobro.');
    expect(codigoDeConfirmacionRechazada(error)).toBe('servicio_sin_resolver');
  });

  it('un 409 de rechazar con { codigo, detail } deja el texto como mensaje y el código reconocible', async () => {
    fetchSimulado.mockResolvedValue(
      respuesta(409, { codigo: 'candidato_ya_confirmado', detail: 'El cobro ya se confirmó: no se rechaza.' }),
    );

    const error = await rechazarCandidato('c-1').catch((fallo: unknown) => fallo);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect((error as ErrorDeApi).message).toBe('El cobro ya se confirmó: no se rechaza.');
    expect(codigoDeRechazoNoPermitido(error)).toBe('candidato_ya_confirmado');
    expect(codigoDeConfirmacionRechazada(error)).toBeNull();
  });

  it('manda un POST a la ruta de confirmar, sin cuerpo', async () => {
    fetchSimulado.mockResolvedValue(respuesta(200, { id: 'c-1', estado: 'confirmado' }));

    await confirmarCandidato('c-1');

    const [url, opciones] = fetchSimulado.mock.calls[0];
    expect(url).toBe('http://api.test/api/candidatos/c-1/confirmar/');
    expect(opciones.method).toBe('POST');
    expect(opciones.body).toBeUndefined();
  });

  it('manda un POST a la ruta de rechazar, sin cuerpo', async () => {
    fetchSimulado.mockResolvedValue(respuesta(200, { id: 'c-1', estado: 'rechazado' }));

    await rechazarCandidato('c-1');

    const [url, opciones] = fetchSimulado.mock.calls[0];
    expect(url).toBe('http://api.test/api/candidatos/c-1/rechazar/');
    expect(opciones.method).toBe('POST');
    expect(opciones.body).toBeUndefined();
  });
});
