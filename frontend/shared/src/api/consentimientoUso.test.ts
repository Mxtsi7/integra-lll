import { afterEach, expect, it, vi } from 'vitest';
import { configurarTokenStorage, guardarTokens } from '../auth';
import { configurarApi } from './cliente';
import { cambiarConsentimientoUso } from './consentimientoUso';

afterEach(() => vi.unstubAllGlobals());

it('envía consentimiento con identidad del cliente HTTP y detecta una respuesta ajena', async () => {
  const memoria: Record<string, string> = {};
  configurarTokenStorage({ getItem: k => memoria[k] ?? null, setItem: (k, v) => { memoria[k] = v; }, removeItem: k => { delete memoria[k]; } });
  const token = `a.${btoa(JSON.stringify({ user_id: 42, organizacion_id: 'org', sid: 'sesion' }))}.b`;
  guardarTokens({ access_token: token, refresh_token: token });
  configurarApi({ urlBase: 'https://gateway.test/api' });
  const body = { recolector_id: '33333333-3333-4333-8333-333333333333', origen: 'android',
    estado: 'activo', version_texto: 'uso-v1', desde: '2026-11-25T12:00:00.000Z',
    actualizado_en: '2026-11-25T12:00:00.000Z', servidor_ahora: '2026-11-25T12:00:00.000Z', zona_horaria: 'America/Santiago' };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const solicitud = { suscripcionId: 'destino', recolectorId: body.recolector_id, origen: 'android' as const, accion: 'aceptar' as const };
  expect(await cambiarConsentimientoUso(solicitud)).toEqual(body);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://gateway.test/api/suscripciones/destino/uso/consentimiento/');
  expect(JSON.parse(init.body as string)).toEqual({ recolector_id: body.recolector_id, origen: 'android', accion: 'aceptar', version_texto: 'uso-v1' });
  body.recolector_id = 'ajeno';
  await expect(cambiarConsentimientoUso(solicitud)).rejects.toThrow('Respuesta de consentimiento inválida');
});
