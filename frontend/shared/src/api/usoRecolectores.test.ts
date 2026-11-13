import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurarTokenStorage, configureAuthApi, guardarTokens } from '../auth';
import type { PendienteUso } from '../contracts/uso-recolectores.dto';
import { configurarApi, ErrorDeApi } from './cliente';
import { enviarUsoPendiente, ErrorSincronizacionUso } from './usoRecolectores';

const storage: Record<string, string> = {};
const fetchMock = vi.fn();

function jwt(sid: string): string {
  const codificar = (valor: unknown) => btoa(JSON.stringify(valor)).replace(/=/g, '');
  return `${codificar({ alg: 'HS256' })}.${codificar({ user_id: 42, organizacion_id: 'org-A', sid })}.firma`;
}

function respuesta(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function pendiente(): PendienteUso {
  return {
    suscripcion_id: '11111111-1111-4111-8111-111111111111',
    evento: {
      version: 1,
      event_id: '22222222-2222-4222-8222-222222222222',
      recolector_id: '33333333-3333-4333-8333-333333333333',
      origen: 'android',
      inicio: '2026-11-09T12:00:00.000Z',
      fin: '2026-11-09T12:02:00.000Z',
      duracion_ms: 30000,
      tramos_actividad: [{ inicio: '2026-11-09T12:00:00.000Z', fin: '2026-11-09T12:00:30.000Z' }],
      zona_horaria: 'America/Santiago',
      cobertura: 'completa',
      estado: 'activo',
    },
  };
}

function acuse(evento: PendienteUso) {
  return {
    event_id: evento.evento.event_id,
    suscripcion_id: evento.suscripcion_id,
    estado: 'aceptado',
    recibido_en: '2026-11-09T12:02:01.000Z',
  };
}

describe('envío autenticado de uso y avance de última sincronización', () => {
  beforeEach(() => {
    for (const clave of Object.keys(storage)) delete storage[clave];
    configurarTokenStorage({
      getItem: (clave) => storage[clave] ?? null,
      setItem: (clave, valor) => { storage[clave] = valor; },
      removeItem: (clave) => { delete storage[clave]; },
    });
    guardarTokens({ access_token: jwt('sesion-A'), refresh_token: jwt('sesion-A') });
    configurarApi({ urlBase: 'https://gateway.test/api' });
    configureAuthApi({ baseUrl: 'https://gateway.test/api' });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('envía el contrato y persiste solo la hora confirmada por el servidor', async () => {
    const evento = pendiente();
    const guardar = vi.fn(async () => {});
    fetchMock.mockResolvedValue(respuesta(201, acuse(evento)));
    await enviarUsoPendiente(evento, guardar);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://gateway.test/api/suscripciones/${evento.suscripcion_id}/uso/recolector/`);
    expect(init.headers.Authorization).toBe(`Bearer ${jwt('sesion-A')}`);
    expect(JSON.parse(init.body)).toEqual(evento.evento);
    expect(guardar).toHaveBeenCalledWith({
      sesionId: '["42","org-A","sesion-A"]', suscripcionId: evento.suscripcion_id,
      recolectorId: evento.evento.recolector_id, eventId: evento.evento.event_id,
      recibidoEn: '2026-11-09T12:02:01.000Z',
    });
  });

  it('no avanza si el acuse corresponde a otro evento o no cumple fecha UTC', async () => {
    const evento = pendiente();
    const guardar = vi.fn(async () => {});
    fetchMock.mockResolvedValue(respuesta(200, { ...acuse(evento), event_id: 'evento-ajeno' }));
    await expect(enviarUsoPendiente(evento, guardar)).rejects.toBeInstanceOf(ErrorSincronizacionUso);
    expect(guardar).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(respuesta(200, { ...acuse(evento), recibido_en: '2026-02-31T12:00:00Z' }));
    await expect(enviarUsoPendiente(evento, guardar)).rejects.toBeInstanceOf(ErrorSincronizacionUso);
    expect(guardar).not.toHaveBeenCalled();
  });

  it('no avanza ante fallo del servidor ni agotamiento del timeout', async () => {
    const guardar = vi.fn(async () => {});
    fetchMock.mockResolvedValue(respuesta(503, { codigo: 'recepcion_no_disponible' }));
    await expect(enviarUsoPendiente(pendiente(), guardar)).rejects.toBeInstanceOf(ErrorDeApi);
    fetchMock.mockImplementation((_url, opciones) => new Promise((_resolver, rechazar) => {
      opciones.signal.addEventListener('abort', () => rechazar(opciones.signal.reason), { once: true });
    }));
    await expect(enviarUsoPendiente(pendiente(), guardar, { timeoutMs: 5 })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(guardar).not.toHaveBeenCalled();
  });

  it('el timeout también cubre una renovación de sesión pendiente', async () => {
    const guardar = vi.fn(async () => {});
    fetchMock.mockResolvedValueOnce(respuesta(401, { detail: 'access vencido' }));
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    await expect(enviarUsoPendiente(pendiente(), guardar, { timeoutMs: 5 }))
      .rejects.toMatchObject({ name: 'TimeoutError' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(guardar).not.toHaveBeenCalled();
  });

  it('una respuesta tardía de A no actualiza el último envío de B', async () => {
    const evento = pendiente();
    const guardar = vi.fn(async () => {});
    fetchMock.mockImplementation(async () => {
      guardarTokens({ access_token: jwt('sesion-B'), refresh_token: jwt('sesion-B') });
      return respuesta(201, acuse(evento));
    });
    await expect(enviarUsoPendiente(evento, guardar)).rejects.toMatchObject({ codigo: 'sesion_cambiada' });
    expect(guardar).not.toHaveBeenCalled();
  });
});
