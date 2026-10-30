import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurarApi, ErrorDeApi } from './cliente';
import { actualizarNombre, cambiarContrasena, getUsuarioActual } from './usuarios';

const URL_BASE = 'http://api.test/api';

/** Lo que devuelve UsuarioActualSerializer (GET y PATCH /api/usuarios/me/). */
const USUARIO_API = {
  id: 7,
  nombre: 'Ana Pérez',
  correo: 'ana@ejemplo.com',
  rol: 'titular',
  organizacion_id: 'bdd59df8-04fc-4e29-9f12-dc4eb5d4e30d',
};

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => cuerpo };
}

let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  configurarApi({ urlBase: URL_BASE });
  fetchFalso = vi.fn();
  vi.stubGlobal('fetch', fetchFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function peticion(indice = 0) {
  const [url, init] = fetchFalso.mock.calls[indice] as [string, { method: string; body: string }];
  return { url, metodo: init.method, cuerpo: JSON.parse(init.body) as unknown };
}

describe('actualizarNombre (CH-08 → MX-06)', () => {
  it('manda PATCH /usuarios/me/ solo con el nombre recortado y devuelve el usuario guardado', async () => {
    fetchFalso.mockResolvedValue(respuesta(200, USUARIO_API));

    const usuario = await actualizarNombre('  Ana Pérez  ');

    expect(peticion()).toEqual({
      url: `${URL_BASE}/usuarios/me/`,
      metodo: 'PATCH',
      // CambioPerfilSerializer rechaza cualquier clave que no sea "nombre".
      cuerpo: { nombre: 'Ana Pérez' },
    });
    expect(usuario).toEqual({ ...USUARIO_API, id: '7' });
  });

  it('un 400 trae el error del campo nombre', async () => {
    fetchFalso.mockResolvedValue(respuesta(400, { nombre: ['Este campo no puede estar en blanco.'] }));

    const error = await actualizarNombre(' ').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect((error as ErrorDeApi).status).toBe(400);
    expect((error as ErrorDeApi).campos).toEqual({ nombre: ['Este campo no puede estar en blanco.'] });
  });
});

it('adapta el id numérico y el tenant/rol nulos del contrato Auth para la presentación', async () => {
  fetchFalso.mockResolvedValue(respuesta(200, { ...USUARIO_API, rol: null, organizacion_id: null, plan: 'free' }));
  await expect(getUsuarioActual()).resolves.toEqual({ ...USUARIO_API, id: '7', rol: '', organizacion_id: '', plan: 'free' });
});

describe('cambiarContrasena (CH-29 → MX-05)', () => {
  const DATOS = { password_actual: ' vieja 1 ', password: 'nueva1234', password_confirmacion: 'nueva1234' };

  it('manda POST /auth/change-password/ con los nombres del serializer, sin recortar nada', async () => {
    fetchFalso.mockResolvedValue(respuesta(200, { detail: 'Contraseña actualizada. Inicia sesión nuevamente.' }));

    await cambiarContrasena(DATOS);

    expect(peticion()).toEqual({ url: `${URL_BASE}/auth/change-password/`, metodo: 'POST', cuerpo: DATOS });
  });

  it('una contraseña actual incorrecta llega como error del campo password_actual', async () => {
    fetchFalso.mockResolvedValue(respuesta(400, { password_actual: ['La contraseña actual no es válida.'] }));

    const error = await cambiarContrasena(DATOS).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect((error as ErrorDeApi).campos).toEqual({ password_actual: ['La contraseña actual no es válida.'] });
  });

  it('un 503 llega con su mensaje y sin errores por campo', async () => {
    fetchFalso.mockResolvedValue(respuesta(503, { detail: 'No se pudo cambiar la contraseña. Inténtalo nuevamente.' }));

    const error = await cambiarContrasena(DATOS).catch((e: unknown) => e);

    expect((error as ErrorDeApi).status).toBe(503);
    expect((error as ErrorDeApi).message).toBe('No se pudo cambiar la contraseña. Inténtalo nuevamente.');
    expect((error as ErrorDeApi).campos).toBeUndefined();
  });
});
