import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  AuthError,
  ErrorDeApi,
  login,
  pedir,
} from '@ojoalgasto/shared';
import {
  adaptarErrorRed,
  configurarClienteHttp,
  esErrorDeRed,
  normalizarUrlApi,
  obtenerApiUrlConfigurada,
  obtenerDefaultApiUrl,
  obtenerUrlBaseConfigurada,
  procesarErrorHttp,
  validarUrlApi,
  MENSAJE_ERROR_RED,
} from './clienteHttp';

describe('Cliente HTTP móvil por entorno (SE-07)', () => {
  const fetchMock = vi.fn();
  const envOriginal = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (envOriginal !== undefined) {
      process.env.EXPO_PUBLIC_API_URL = envOriginal;
    } else {
      delete process.env.EXPO_PUBLIC_API_URL;
    }
  });

  describe('1. Resolución y normalización de URLs', () => {
    it('normaliza URLs eliminando espacios y barras finales', () => {
      expect(normalizarUrlApi('  http://localhost:8000/api/  ')).toBe('http://localhost:8000/api');
      expect(normalizarUrlApi('https://api.staging.ojoalgasto.cl/api///')).toBe(
        'https://api.staging.ojoalgasto.cl/api'
      );
    });

    it('devuelve fallback 10.0.2.2 en Android y localhost en otras plataformas', () => {
      expect(obtenerDefaultApiUrl('android')).toBe('http://10.0.2.2:8000/api');
      expect(obtenerDefaultApiUrl('ios')).toBe('http://localhost:8000/api');
      expect(obtenerDefaultApiUrl('web')).toBe('http://localhost:8000/api');
    });

    it('prioriza EXPO_PUBLIC_API_URL cuando está definida', () => {
      process.env.EXPO_PUBLIC_API_URL = 'https://mi-gateway.cl/api';
      expect(obtenerApiUrlConfigurada()).toBe('https://mi-gateway.cl/api');
    });

    it('usa fallback si EXPO_PUBLIC_API_URL está vacía o solo con espacios', () => {
      process.env.EXPO_PUBLIC_API_URL = '   ';
      const resolved = obtenerApiUrlConfigurada();
      expect(resolved.endsWith('/api')).toBe(true);
      expect(resolved.startsWith('http')).toBe(true);
    });
  });

  describe('2. Validación de URL en dispositivo', () => {
    it('detecta URL vacía como inválida', () => {
      const res = validarUrlApi('   ');
      expect(res.valida).toBe(false);
      expect(res.error).toContain('no puede estar vacía');
    });

    it('rechaza protocolos no soportados o URLs malformadas', () => {
      const res1 = validarUrlApi('ftp://servidor.cl/api');
      expect(res1.valida).toBe(false);
      expect(res1.error).toContain("Protocolo no soportado 'ftp:'");

      const res2 = validarUrlApi('esto-no-es-una-url');
      expect(res2.valida).toBe(false);
      expect(res2.error).toContain('Formato de URL inválido');
    });

    it('emite advertencia si se usa localhost en Android (emulador o físico)', () => {
      const res = validarUrlApi('http://localhost:8000/api', { plataforma: 'android' });
      expect(res.valida).toBe(true);
      expect(res.advertencia).toBeDefined();
      expect(res.advertencia).toContain('10.0.2.2');
    });

    it('emite advertencia si la URL no incluye el prefijo base /api', () => {
      const res = validarUrlApi('https://api.staging.ojoalgasto.cl');
      expect(res.valida).toBe(true);
      expect(res.advertencia).toContain('/api');
    });

    it('acepta URLs válidas completas sin error', () => {
      const res = validarUrlApi('https://api.staging.ojoalgasto.cl/api');
      expect(res.valida).toBe(true);
      expect(res.error).toBeUndefined();
      expect(res.urlNormalizada).toBe('https://api.staging.ojoalgasto.cl/api');
    });
  });

  describe('3. Criterio de Aceptación: Login y API usan el mismo Gateway configurado', () => {
    it('configurarClienteHttp sincroniza configurarApi y configureAuthApi con la misma URL base', async () => {
      const GATEWAY_URL = 'https://api.integracion.ojoalgasto.cl/api';
      const config = configurarClienteHttp(GATEWAY_URL);

      expect(config.urlBase).toBe(GATEWAY_URL);
      expect(obtenerUrlBaseConfigurada()).toBe(GATEWAY_URL);

      // 1. Petición de Login (configureAuthApi)
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'fake-access',
            refresh_token: 'fake-refresh',
            usuario: { id: 1, nombre: 'Test', correo: 'test@ojoalgasto.cl' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await login({ correo: 'test@ojoalgasto.cl', password: 'password123' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [urlAuth] = fetchMock.mock.calls[0];
      expect(urlAuth).toBe(`${GATEWAY_URL}/auth/login/`);

      // 2. Petición de Recurso de API (configurarApi / pedir)
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'sub-1', nombre: 'Spotify' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await pedir('/suscripciones/');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [urlApi] = fetchMock.mock.calls[1];
      expect(urlApi).toBe(`${GATEWAY_URL}/suscripciones/`);

      // Confirmar que ambos consumen el MISMO origen y base
      const origenAuth = new URL(urlAuth).origin;
      const origenApi = new URL(urlApi).origin;
      expect(origenAuth).toBe(origenApi);
    });

    it('rechaza configuración si la URL es inválida lanzando Error claro', () => {
      expect(() => {
        configurarClienteHttp('sin-protocolo:8000');
      }).toThrow('[Cliente HTTP Móvil] Error al configurar API');
    });
  });

  describe('4. Criterio de Aceptación: Adaptar errores de red sin duplicar lógica de dominio', () => {
    it('esErrorDeRed detecta errores nativos de conexión y timeouts', () => {
      expect(esErrorDeRed(new TypeError('Network request failed'))).toBe(true);
      expect(esErrorDeRed(new TypeError('Failed to fetch'))).toBe(true);
      expect(esErrorDeRed(new Error('Network error: ECONNREFUSED'))).toBe(true);

      const abortError = new Error('The user aborted a request.');
      abortError.name = 'AbortError';
      expect(esErrorDeRed(abortError)).toBe(true);
    });

    it('esErrorDeRed NO confunde errores de dominio (AuthError, ErrorDeApi) con errores de red', () => {
      const authErr = new AuthError('Credenciales incorrectas', 401, {
        codigo: 'credenciales_invalidas',
        campos: { password: ['Clave errónea'] },
      });
      const apiErr = new ErrorDeApi('Monto inválido', 400, {
        monto: ['Debe ser mayor a 0'],
      });

      expect(esErrorDeRed(authErr)).toBe(false);
      expect(esErrorDeRed(apiErr)).toBe(false);
    });

    it('adaptarErrorRed retorna mensaje amigable si es de red, y null si es de dominio', () => {
      const errRed = new TypeError('Network request failed');
      const errDominio = new AuthError('Usuario no encontrado', 404);

      expect(adaptarErrorRed(errRed)).toBe(MENSAJE_ERROR_RED);
      expect(adaptarErrorRed(errDominio)).toBeNull();
    });

    it('procesarErrorHttp preserva la estructura de dominio de AuthError y ErrorDeApi', () => {
      // 1. AuthError: mantiene status, codigo, campos y mensaje de shared
      const authErr = new AuthError('Token expirado', 410, {
        codigo: 'token_expirado',
        campos: { token: ['El enlace ya no es válido'] },
      });
      const resAuth = procesarErrorHttp(authErr);
      expect(resAuth.esRed).toBe(false);
      expect(resAuth.esDominio).toBe(true);
      expect(resAuth.status).toBe(410);
      expect(resAuth.codigo).toBe('token_expirado');
      expect(resAuth.campos).toEqual({ token: ['El enlace ya no es válido'] });
      expect(resAuth.mensaje).toBe('Token expirado');

      // 2. ErrorDeApi: mantiene status y campos de validación DRF
      const apiErr = new ErrorDeApi('Error de validación', 422, {
        nombre: ['Este campo es obligatorio.'],
      });
      const resApi = procesarErrorHttp(apiErr);
      expect(resApi.esRed).toBe(false);
      expect(resApi.esDominio).toBe(true);
      expect(resApi.status).toBe(422);
      expect(resApi.campos).toEqual({ nombre: ['Este campo es obligatorio.'] });

      // 3. Error de red: marcado como esRed y mensaje estandarizado
      const netErr = new TypeError('Network request failed');
      const resNet = procesarErrorHttp(netErr);
      expect(resNet.esRed).toBe(true);
      expect(resNet.esDominio).toBe(false);
      expect(resNet.mensaje).toBe(MENSAJE_ERROR_RED);
    });
  });

  describe('5. Criterio de Aceptación: El build no contiene secretos en variables públicas', () => {
    it('frontend/movil/.env.example NO contiene variables de secretos o credenciales', () => {
      const envExamplePath = path.resolve(__dirname, '../../.env.example');
      const contenido = fs.readFileSync(envExamplePath, 'utf8');

      // Verificar que NO contiene secretos backend
      const patronesSecretos = [
        /SECRET_KEY/i,
        /POSTGRES_PASSWORD/i,
        /JWT_SECRET/i,
        /SPOTIFY_CLIENT_SECRET/i,
        /GOOGLE_CLIENT_SECRET/i,
        /ANTHROPIC_API_KEY/i,
        /EMAIL_HOST_PASSWORD/i,
        /SESSION_REDIS_URL/i,
      ];

      for (const patron of patronesSecretos) {
        expect(contenido).not.toMatch(patron);
      }

      // Debe documentar EXPO_PUBLIC_API_URL
      expect(contenido).toMatch(/EXPO_PUBLIC_API_URL=/);
    });

    it('todas las variables en frontend/movil/.env.example son públicas con prefijo EXPO_PUBLIC_', () => {
      const envExamplePath = path.resolve(__dirname, '../../.env.example');
      const lineas = fs
        .readFileSync(envExamplePath, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      for (const linea of lineas) {
        const [clave] = linea.split('=');
        expect(clave.startsWith('EXPO_PUBLIC_')).toBe(true);
      }
    });

    it('ninguna variable de entorno en proceso con prefijo EXPO_PUBLIC_ contiene secretos', () => {
      const palabrasProhibidas = ['secret', 'password', 'private_key', 'fernet'];

      for (const [clave, valor] of Object.entries(process.env)) {
        if (clave.startsWith('EXPO_PUBLIC_')) {
          for (const palabra of palabrasProhibidas) {
            expect(clave.toLowerCase()).not.toContain(palabra);
            if (typeof valor === 'string') {
              expect(valor.toLowerCase()).not.toContain(palabra);
            }
          }
        }
      }
    });
  });
});
