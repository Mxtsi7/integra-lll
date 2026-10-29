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
  adaptadorStorageSincrono,
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

  describe('5. Orden de mutaciones, concurrencia y fallos de borrado (Revisión SE-08)', () => {
    it('escritura tardía después del cierre no sobrevive al reiniciar e hidratar [P1]', async () => {
      let resolverEscritura: () => void;
      const promesaEscritura = new Promise<void>((r) => {
        resolverEscritura = r;
      });

      // Backend donde setItemAsync queda pendiente de resolver
      const backendLento: IBackendStorageSeguro = {
        getItemAsync: vi.fn(async (k) => almacenamientoSimulado.get(k) ?? null),
        setItemAsync: vi.fn(async (k, v) => {
          await promesaEscritura;
          almacenamientoSimulado.set(k, v);
        }),
        deleteItemAsync: vi.fn(async (k) => {
          almacenamientoSimulado.delete(k);
        }),
      };
      configurarBackendStorage(backendLento);

      const tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-escritura-tardia',
      };

      // 1. Iniciar guardado de login (escritura queda pendiente en hardware)
      const pLogin = guardarTokensSeguros(tokens);

      // 2. Ejecutar y completar limpiarSesionSegura()
      await limpiarSesionSegura();

      // 3. Terminar las escrituras anteriores pendientes
      resolverEscritura!();
      // pLogin debe resolver o rechazar sin crash
      await pLogin.catch(() => {});

      // Simular reinicio vaciando la memoria RAM
      __reiniciarEstadoParaPruebas();
      configurarBackendStorage(backendLento);

      // 4. Hidratar: NO debe reaparecer el access token de la sesión cerrada
      const resultado = await hidratarSesionSegura();
      expect(resultado.hayTokens).toBe(false);
      expect(obtenerAccessToken()).toBeNull();
      expect(almacenamientoSimulado.get(CLAVES_SEGURAS.ACCESS_TOKEN)).toBeFalsy();
    });

    it('borrado tardío de sesión anterior no elimina los tokens de un nuevo login posterior [P1]', async () => {
      let resolverBorrado: () => void;
      const promesaBorrado = new Promise<void>((r) => {
        resolverBorrado = r;
      });

      const backendBorradoLento: IBackendStorageSeguro = {
        getItemAsync: vi.fn(async (k) => almacenamientoSimulado.get(k) ?? null),
        setItemAsync: vi.fn(async (k, v) => {
          almacenamientoSimulado.set(k, v);
        }),
        deleteItemAsync: vi.fn(async (k) => {
          await promesaBorrado;
          almacenamientoSimulado.delete(k);
        }),
      };
      configurarBackendStorage(backendBorradoLento);

      const tokensA = {
        access_token: jwtValido(),
        refresh_token: 'refresh-A',
      };
      const tokensB = {
        access_token: jwtValido(),
        refresh_token: 'refresh-B',
      };

      // 1. Sesión A activa
      almacenamientoSimulado.set(CLAVES_SEGURAS.ACCESS_TOKEN, tokensA.access_token);
      almacenamientoSimulado.set(CLAVES_SEGURAS.REFRESH_TOKEN, tokensA.refresh_token);

      // 2. Se dispara limpiarSesionSegura() (borrado pendiente en hardware)
      const pLogout = limpiarSesionSegura();

      // 3. Usuario inicia sesión con B
      const pLoginB = guardarTokensSeguros(tokensB);

      // 4. Se completa el borrado viejo
      resolverBorrado!();
      await pLogout.catch(() => {});
      await pLoginB;

      // 5. Reinicio simulado
      __reiniciarEstadoParaPruebas();
      configurarBackendStorage(backendBorradoLento);

      // Al rehidratar, los tokens nuevos de B deben estar presentes e intactos
      const resultado = await hidratarSesionSegura();
      expect(resultado.hayTokens).toBe(true);
      expect(obtenerAccessToken()).toBe(tokensB.access_token);
      expect(almacenamientoSimulado.get(CLAVES_SEGURAS.ACCESS_TOKEN)).toBe(tokensB.access_token);
    });

    it('401 seguido de nuevo login preserva la sesión nueva tras reinicio [P1]', async () => {
      const tokensViejos = {
        access_token: jwtValido(),
        refresh_token: 'refresh-401',
      };
      await guardarTokensSeguros(tokensViejos);

      // 401 disparado por cliente shared: invoca adaptadorStorageSincrono.removeItem
      // a través de logout()
      adaptadorStorageSincrono.removeItem(CLAVES_SEGURAS.ACCESS_TOKEN);
      adaptadorStorageSincrono.removeItem(CLAVES_SEGURAS.REFRESH_TOKEN);

      // Nuevo login inmediato
      const tokensNuevos = {
        access_token: jwtValido(),
        refresh_token: 'refresh-nuevo-login',
      };
      await guardarTokensSeguros(tokensNuevos);

      // Reinicio
      __reiniciarEstadoParaPruebas();
      inicializarStorageSeguro(backendMock);

      const res = await hidratarSesionSegura();
      expect(res.hayTokens).toBe(true);
      expect(obtenerAccessToken()).toBe(tokensNuevos.access_token);
      expect(almacenamientoSimulado.get(CLAVES_SEGURAS.ACCESS_TOKEN)).toBe(tokensNuevos.access_token);
    });

    it('fallo total de borrado en limpiarSesionSegura rechaza y política durable evita rehidratar [P1]', async () => {
      const backendFalloBorrado: IBackendStorageSeguro = {
        getItemAsync: vi.fn(async (k) => almacenamientoSimulado.get(k) ?? null),
        setItemAsync: vi.fn(async (k, v) => {
          almacenamientoSimulado.set(k, v);
        }),
        deleteItemAsync: vi.fn().mockRejectedValue(new Error('Hardware delete failed')),
      };
      configurarBackendStorage(backendFalloBorrado);

      try {
        const tokens = {
          access_token: jwtValido(),
          refresh_token: 'refresh-no-borrable',
        };
        almacenamientoSimulado.set(CLAVES_SEGURAS.ACCESS_TOKEN, tokens.access_token);
        almacenamientoSimulado.set(CLAVES_SEGURAS.REFRESH_TOKEN, tokens.refresh_token);

        // limpiarSesionSegura NO debe reportar éxito si el borrado falló
        await expect(limpiarSesionSegura()).rejects.toThrow(
          'Fallo al limpiar sesión en almacenamiento seguro'
        );

        // Memoria síncrona debe estar limpia
        expect(obtenerAccessToken()).toBeNull();
        expect(haySesionValida()).toBe(false);

        // Reinicio simulado
        __reiniciarEstadoParaPruebas();
        configurarBackendStorage(backendFalloBorrado);

        // Al rehidratar, la política durable impide recuperar la sesión pendiente de cierre
        const res = await hidratarSesionSegura();
        expect(res.hayTokens).toBe(false);
        expect(obtenerAccessToken()).toBeNull();
        expect(haySesionValida()).toBe(false);
      } finally {
        configurarBackendStorage(backendMock);
      }
    });

    it('fallo de escritura en cualquiera de las claves (access, refresh o desfase) ejecuta rollback completo [P2]', async () => {
      const backendFalloDesfase: IBackendStorageSeguro = {
        getItemAsync: vi.fn(async (k) => almacenamientoSimulado.get(k) ?? null),
        setItemAsync: vi.fn(async (k, v) => {
          if (k === CLAVES_SEGURAS.DESFASE_RELOJ) {
            throw new Error('Disk full on clock offset write');
          }
          almacenamientoSimulado.set(k, v);
        }),
        deleteItemAsync: vi.fn(async (k) => {
          almacenamientoSimulado.delete(k);
        }),
      };
      configurarBackendStorage(backendFalloDesfase);

      try {
        const tokens = {
          access_token: jwtValido(),
          refresh_token: 'refresh-fallo-desfase',
        };

        await expect(guardarTokensSeguros(tokens)).rejects.toThrow(
          'Fallo al persistir tokens en almacenamiento seguro'
        );

        // Rollback en memoria
        expect(obtenerAccessToken()).toBeNull();
        expect(obtenerRefreshToken()).toBeNull();
        expect(haySesionValida()).toBe(false);
      } finally {
        configurarBackendStorage(backendMock);
      }
    });
  });
});
