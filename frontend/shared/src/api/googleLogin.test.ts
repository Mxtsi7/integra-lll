import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, configureAuthApi, loginConGoogle, pedirNonceGoogle } from '../auth';

const fetchMock = vi.fn();

function respuesta(estado: number, cuerpo: unknown) {
  return { ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo };
}

describe('inicio con Google (S3-AN-07, MX-11)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    configureAuthApi({ baseUrl: 'http://api.test/api' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pide el nonce por GET y con credenciales, para que viaje la cookie que lo liga al navegador', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { nonce: 'n1', client_id: 'cid', vence_en_segundos: 300 }));
    const nonce = await pedirNonceGoogle();
    expect(nonce).toEqual({ nonce: 'n1', client_id: 'cid', vence_en_segundos: 300 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/auth/google/nonce/');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(init.body).toBeUndefined();
  });

  it('manda id_token y nonce; sin contraseña no manda el campo', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { access_token: 'a', refresh_token: 'r' }));
    await loginConGoogle({ idToken: 'tok', nonce: 'n1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/auth/google/');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ id_token: 'tok', nonce: 'n1' });
  });

  it('al vincular una cuenta existente manda la contraseña', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { access_token: 'a', refresh_token: 'r' }));
    await loginConGoogle({ idToken: 'tok', nonce: 'n1', password: 'Clave123' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ id_token: 'tok', nonce: 'n1', password: 'Clave123' });
  });

  it.each([
    [401, 'vincular_google'],
    [409, 'completar_registro'],
    [401, 'google_invalido'],
    [400, 'google_cancelado'],
    [503, 'google_no_disponible'],
    [503, 'google_no_configurado'],
  ])('el %i con código %s llega como AuthError con ese código', async (estado, code) => {
    fetchMock.mockResolvedValue(respuesta(estado, { code, detail: 'mensaje' }));
    const error = (await loginConGoogle({ idToken: 't', nonce: 'n' }).catch((e: unknown) => e)) as AuthError;
    expect(error).toBeInstanceOf(AuthError);
    expect(error.status).toBe(estado);
    expect(error.codigo).toBe(code);
  });

  it('el login de siempre (correo y contraseña) no manda credenciales de cookie', async () => {
    const { login } = await import('../auth');
    fetchMock.mockResolvedValue(respuesta(200, { access_token: 'a', refresh_token: 'r' }));
    await login({ correo: 'a@b.cl', password: 'x' });
    expect(fetchMock.mock.calls[0][1].credentials).toBeUndefined();
  });
});
