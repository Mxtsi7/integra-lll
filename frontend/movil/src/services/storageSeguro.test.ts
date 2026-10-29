import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  haySesionValida,
  obtenerAccessToken,
  obtenerRefreshToken,
} from '@ojoalgasto/shared';
import {
  CLAVES_SEGURAS,
  IBackendStorageSeguro,
  configurarBackendStorage,
  hidratarSesionSegura,
  guardarTokensSeguros,
  inicializarStorageSeguro,
  limpiarSesionSegura,
  obtenerTokensSeguros,
  __reiniciarEstadoParaPruebas,
} from './storageSeguro';

function jwtValido(expSegundos: number = Math.floor(Date.now() / 1000) + 3600): string {
  const base64url = (texto: string) =>
    btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [
    base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64url(JSON.stringify({ exp: expSegundos, user_id: 'usr-123', iat: Math.floor(Date.now() / 1000) })),
    'firma-segura',
  ].join('.');
}

describe('Almacenamiento seguro y sesión móvil (SE-08)', () => {
  let backendMock: IBackendStorageSeguro;
  let almacenamientoSimulado: Map<string, string>;

  beforeEach(() => {
    almacenamientoSimulado = new Map<string, string>();
    backendMock = {
      getItemAsync: vi.fn(async (k: string) => almacenamientoSimulado.get(k) ?? null),
      setItemAsync: vi.fn(async (k: string, v: string) => {
        almacenamientoSimulado.set(k, v);
      }),
      deleteItemAsync: vi.fn(async (k: string) => {
        almacenamientoSimulado.delete(k);
      }),
      isAvailableAsync: vi.fn(async () => true),
    };

    __reiniciarEstadoParaPruebas();
    inicializarStorageSeguro(backendMock);
  });

  afterEach(async () => {
    await limpiarSesionSegura();
    __reiniciarEstadoParaPruebas();
    vi.restoreAllMocks();
  });

  describe('1. Adaptador síncrono / asíncrono para @ojoalgasto/shared', () => {
    it('guardarTokensSeguros persiste atómicamente en memoria y SecureStore', async () => {
      const tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-token-movil-123',
      };

      await guardarTokensSeguros(tokens);

      // Lectura síncrona en memoria a través de shared
      expect(obtenerAccessToken()).toBe(tokens.access_token);
      expect(obtenerRefreshToken()).toBe(tokens.refresh_token);
      expect(haySesionValida()).toBe(true);

      // Verificación de escritura asíncrona en el hardware seguro
      expect(backendMock.setItemAsync).toHaveBeenCalledWith(
        CLAVES_SEGURAS.ACCESS_TOKEN,
        tokens.access_token
      );
      expect(backendMock.setItemAsync).toHaveBeenCalledWith(
        CLAVES_SEGURAS.REFRESH_TOKEN,
        tokens.refresh_token
      );
      expect(almacenamientoSimulado.get(CLAVES_SEGURAS.ACCESS_TOKEN)).toBe(tokens.access_token);
      expect(almacenamientoSimulado.get(CLAVES_SEGURAS.REFRESH_TOKEN)).toBe(tokens.refresh_token);
    });

    it('lecturas síncronas de tokens son inmediatas sin latencia asíncrona', async () => {
      const tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-rapido',
      };

      await guardarTokensSeguros(tokens);

      const tokensObtenidos = obtenerTokensSeguros();
      expect(tokensObtenidos.access_token).toBe(tokens.access_token);
      expect(tokensObtenidos.refresh_token).toBe(tokens.refresh_token);
    });
  });

  describe('2. Criterio de Aceptación: Reinicio recupera sesión sin leer localStorage web', () => {
    it('al reiniciar la app, hidratarSesionSegura recupera la sesión desde SecureStore', async () => {
      const tokensGuardados = {
        access_token: jwtValido(),
        refresh_token: 'refresh-persistente-999',
      };

      // 1. Guardar tokens en el hardware seguro
      await guardarTokensSeguros(tokensGuardados);
      expect(haySesionValida()).toBe(true);

      // 2. Simular reinicio completo de la aplicación (borrado de caché síncrono en memoria)
      __reiniciarEstadoParaPruebas();
      inicializarStorageSeguro(backendMock);

      // Inmediatamente después del reinicio y antes de hidratar, la memoria está vacía
      expect(obtenerAccessToken()).toBeNull();
      expect(haySesionValida()).toBe(false);

      // 3. Ejecutar ciclo de hidratación al arrancar
      const resultado = await hidratarSesionSegura();
      expect(resultado.hidratado).toBe(true);
      expect(resultado.hayTokens).toBe(true);

      // 4. La sesión quedó restaurada en memoria y es válida
      expect(obtenerAccessToken()).toBe(tokensGuardados.access_token);
      expect(obtenerRefreshToken()).toBe(tokensGuardados.refresh_token);
      expect(haySesionValida()).toBe(true);
    });

    it('la app móvil NO lee ni consulta localStorage en ninguna fase del ciclo', async () => {
      // Espiar o interceptar localStorage en el entorno global si existe
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

      const tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-sin-localstorage',
      };

      await guardarTokensSeguros(tokens);
      expect(obtenerAccessToken()).toBe(tokens.access_token);

      // Reinicio simulado e hidratación
      __reiniciarEstadoParaPruebas();
      inicializarStorageSeguro(backendMock);
      await hidratarSesionSegura();

      expect(obtenerAccessToken()).toBe(tokens.access_token);

      // Confirmar que localStorage nunca fue utilizado
      expect(getItemSpy).not.toHaveBeenCalled();
      expect(setItemSpy).not.toHaveBeenCalled();
    });
  });

  describe('3. Criterio de Aceptación: Logout limpia tokens persistentes y caché de datos privados', () => {
    it('limpiarSesionSegura purga la memoria síncrona y elimina todas las claves en SecureStore', async () => {
      const tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-para-borrar',
      };

      await guardarTokensSeguros(tokens);
      expect(obtenerAccessToken()).toBe(tokens.access_token);
      expect(almacenamientoSimulado.size).toBeGreaterThanOrEqual(2);

      // Ejecutar limpieza de logout
      await limpiarSesionSegura();

      // 1. Memoria síncrona vacía
      expect(obtenerAccessToken()).toBeNull();
      expect(obtenerRefreshToken()).toBeNull();
      expect(haySesionValida()).toBe(false);

      // 2. Hardware seguro SecureStore vacío
      expect(backendMock.deleteItemAsync).toHaveBeenCalledWith(CLAVES_SEGURAS.ACCESS_TOKEN);
      expect(backendMock.deleteItemAsync).toHaveBeenCalledWith(CLAVES_SEGURAS.REFRESH_TOKEN);
      expect(almacenamientoSimulado.get(CLAVES_SEGURAS.ACCESS_TOKEN)).toBeUndefined();
      expect(almacenamientoSimulado.get(CLAVES_SEGURAS.REFRESH_TOKEN)).toBeUndefined();
    });
  });

  describe('4. Resiliencia y casos de borde', () => {
    it('tokens expirados en SecureStore no crean sesión válida tras hidratación', async () => {
      // Token expirado hace 1 hora
      const tokenVencido = jwtValido(Math.floor(Date.now() / 1000) - 3600);
      almacenamientoSimulado.set(CLAVES_SEGURAS.ACCESS_TOKEN, tokenVencido);
      almacenamientoSimulado.set(CLAVES_SEGURAS.REFRESH_TOKEN, 'refresh-vencido');

      const resultado = await hidratarSesionSegura();
      expect(resultado.hidratado).toBe(true);
      expect(resultado.hayTokens).toBe(true);

      // El token fue cargado en memoria pero haySesionValida detecta la expiración
      expect(obtenerAccessToken()).toBe(tokenVencido);
      expect(haySesionValida()).toBe(false);
    });

    it('fallo de lectura en SecureStore no arroja excepción no controlada', async () => {
      const backendConFallo: IBackendStorageSeguro = {
        getItemAsync: vi.fn().mockRejectedValue(new Error('Hardware Keystore error')),
        setItemAsync: vi.fn().mockResolvedValue(undefined),
        deleteItemAsync: vi.fn().mockResolvedValue(undefined),
      };

      configurarBackendStorage(backendConFallo);

      const resultado = await hidratarSesionSegura();
      expect(resultado.hidratado).toBe(false);
      expect(resultado.hayTokens).toBe(false);
      expect(haySesionValida()).toBe(false);
    });
  });
});
