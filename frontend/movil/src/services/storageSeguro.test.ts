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
  esTokenValido,
  validarFormatoToken,
  decodificarPayloadJwt,
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

  describe('4. Regresiones de concurrencia, rollback y políticas durables (Segunda Revisión)', () => {
    it('rollback de guardado A obsoleto no invalida ni borra guardado B posterior [P1 Hallazgo 2]', async () => {
      let resolverEscrituraA: () => void = () => {};
      let rechazarEscrituraA: (err: any) => void = () => {};
      const promesaBloqueoA = new Promise<void>((resolve, reject) => {
        resolverEscrituraA = resolve;
        rechazarEscrituraA = reject;
      });

      const tokensA = {
        access_token: jwtValido(Math.floor(Date.now() / 1000) + 1800),
        refresh_token: 'refresh-sesion-A',
      };
      const tokensB = {
        access_token: jwtValido(Math.floor(Date.now() / 1000) + 3600),
        refresh_token: 'refresh-sesion-B',
      };

      // Backend que bloquea la escritura de access_token de A
      const backendIntercalado: IBackendStorageSeguro = {
        getItemAsync: vi.fn(async (k) => almacenamientoSimulado.get(k) ?? null),
        setItemAsync: vi.fn(async (k, v) => {
          if (v === tokensA.access_token) {
            await promesaBloqueoA;
          }
          almacenamientoSimulado.set(k, v);
        }),
        deleteItemAsync: vi.fn(async (k) => {
          almacenamientoSimulado.delete(k);
        }),
      };
      configurarBackendStorage(backendIntercalado);

      try {
        // 1. Empezar guardado A (quedará bloqueado en hardware)
        const promesaA = guardarTokensSeguros(tokensA);

        // Esperar brevemente para asegurar que A inició su encolado
        await new Promise((r) => setTimeout(r, 10));

        // 2. Empezar guardado B (inicia con nueva generación y actualiza RAM de inmediato)
        const promesaB = guardarTokensSeguros(tokensB);

        // 3. Rechazar la escritura de A
        rechazarEscrituraA(new Error('Fallo simulado en disco al escribir token A'));

        // A debe rechazar con su error
        await expect(promesaA).rejects.toThrow('Fallo al persistir tokens en almacenamiento seguro');

        // B debe completarse con éxito
        await promesaB;

        // 4. Verificación de invariantes: B debe permanecer intacta en RAM y hardware
        expect(obtenerAccessToken()).toBe(tokensB.access_token);
        expect(obtenerRefreshToken()).toBe(tokensB.refresh_token);
        expect(haySesionValida()).toBe(true);

        expect(almacenamientoSimulado.get(CLAVES_SEGURAS.ACCESS_TOKEN)).toBe(tokensB.access_token);
        expect(almacenamientoSimulado.get(CLAVES_SEGURAS.REFRESH_TOKEN)).toBe(tokensB.refresh_token);

        // 5. Reinicio simulado: B sobrevive y se rehidrata perfectamente
        __reiniciarEstadoParaPruebas();
        configurarBackendStorage(backendIntercalado);
        const resHidratacion = await hidratarSesionSegura();
        expect(resHidratacion.hayTokens).toBe(true);
        expect(obtenerAccessToken()).toBe(tokensB.access_token);
      } finally {
        configurarBackendStorage(backendMock);
      }
    });

    it('fallo durante el rollback de borrado se captura y maneja sin promesas no atendidas [P1 Hallazgo 2]', async () => {
      const backendFalloRollback: IBackendStorageSeguro = {
        getItemAsync: vi.fn(async (k) => almacenamientoSimulado.get(k) ?? null),
        setItemAsync: vi.fn(async (k) => {
          if (k === CLAVES_SEGURAS.REFRESH_TOKEN) {
            throw new Error('Hardware error on set');
          }
        }),
        deleteItemAsync: vi.fn(async () => {
          throw new Error('Hardware error on delete during rollback');
        }),
      };
      configurarBackendStorage(backendFalloRollback);

      try {
        const tokens = {
          access_token: jwtValido(),
          refresh_token: 'refresh-fallo-rollback',
        };

        // Debe lanzar el error de guardado y manejar internamente el fallo del rollback sin crash
        await expect(guardarTokensSeguros(tokens)).rejects.toThrow(
          'Fallo al persistir tokens en almacenamiento seguro'
        );

        expect(obtenerAccessToken()).toBeNull();
      } finally {
        configurarBackendStorage(backendMock);
      }
    });

    it('hidratación preserva limpieza_pendiente si el borrado de credenciales falla [P1 Hallazgo 3]', async () => {
      // 1. Sembrar dos tokens válidos y marca durable limpieza_pendiente = 1
      const tokens = {
        access_token: jwtValido(),
        refresh_token: 'refresh-sesion-cerrada',
      };
      almacenamientoSimulado.set(CLAVES_SEGURAS.ACCESS_TOKEN, tokens.access_token);
      almacenamientoSimulado.set(CLAVES_SEGURAS.REFRESH_TOKEN, tokens.refresh_token);
      almacenamientoSimulado.set(CLAVES_SEGURAS.LIMPIEZA_PENDIENTE, '1');

      // Backend que falla al borrar credenciales pero permitiría borrar la marca
      let intentoBorradoMarca = false;
      const backendFalloBorradoTokens: IBackendStorageSeguro = {
        getItemAsync: vi.fn(async (k) => almacenamientoSimulado.get(k) ?? null),
        setItemAsync: vi.fn(async (k, v) => {
          almacenamientoSimulado.set(k, v);
        }),
        deleteItemAsync: vi.fn(async (k) => {
          if (k === CLAVES_SEGURAS.ACCESS_TOKEN || k === CLAVES_SEGURAS.REFRESH_TOKEN) {
            throw new Error('Hardware delete tokens error');
          }
          if (k === CLAVES_SEGURAS.LIMPIEZA_PENDIENTE) {
            intentoBorradoMarca = true;
            almacenamientoSimulado.delete(k);
          }
        }),
      };
      configurarBackendStorage(backendFalloBorradoTokens);

      try {
        // 2. Hidratar: no debe recuperar la sesión
        const res1 = await hidratarSesionSegura();
        expect(res1.hayTokens).toBe(false);
        expect(obtenerAccessToken()).toBeNull();

        // La marca LIMPIEZA_PENDIENTE NO debe haberse borrado porque el borrado de tokens falló
        expect(intentoBorradoMarca).toBe(false);
        expect(almacenamientoSimulado.get(CLAVES_SEGURAS.LIMPIEZA_PENDIENTE)).toBe('1');

        // 3. Reiniciar RAM y volver a hidratar sin nuevo login
        __reiniciarEstadoParaPruebas();
        configurarBackendStorage(backendFalloBorradoTokens);

        const res2 = await hidratarSesionSegura();
        expect(res2.hayTokens).toBe(false);
        expect(obtenerAccessToken()).toBeNull();
        expect(haySesionValida()).toBe(false);
        // La marca sigue intacta protegiendo la sesión
        expect(almacenamientoSimulado.get(CLAVES_SEGURAS.LIMPIEZA_PENDIENTE)).toBe('1');
      } finally {
        configurarBackendStorage(backendMock);
      }
    });

    it('fallo al leer marca LIMPIEZA_PENDIENTE produce resultado seguro sin recuperar tokens [P1 Hallazgo 3]', async () => {
      almacenamientoSimulado.set(CLAVES_SEGURAS.ACCESS_TOKEN, jwtValido());
      almacenamientoSimulado.set(CLAVES_SEGURAS.REFRESH_TOKEN, 'refresh-test');

      const backendFalloLecturaMarca: IBackendStorageSeguro = {
        getItemAsync: vi.fn(async (k) => {
          if (k === CLAVES_SEGURAS.LIMPIEZA_PENDIENTE) {
            throw new Error('Hardware read error');
          }
          return almacenamientoSimulado.get(k) ?? null;
        }),
        setItemAsync: vi.fn(async (k, v) => {
          almacenamientoSimulado.set(k, v);
        }),
        deleteItemAsync: vi.fn(async (k) => {
          almacenamientoSimulado.delete(k);
        }),
      };
      configurarBackendStorage(backendFalloLecturaMarca);

      try {
        const res = await hidratarSesionSegura();
        expect(res.hidratado).toBe(false);
        expect(res.hayTokens).toBe(false);
        expect(obtenerAccessToken()).toBeNull();
      } finally {
        configurarBackendStorage(backendMock);
      }
    });

    it('esTokenValido y validarFormatoToken evalúan vigencia real y formato JWT sin derivar desfase de iat [P2 Hallazgo 4]', () => {
      const ahoraServidor = Math.floor(Date.now() / 1000);

      // Token recién emitido por el servidor (duración 30 min)
      const tokenRecienEmitido = [
        btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, ''),
        btoa(
          JSON.stringify({
            iat: ahoraServidor,
            exp: ahoraServidor + 30 * 60,
            user_id: 'usr-1',
          })
        ).replace(/=+$/, ''),
        'sig',
      ].join('.');

      expect(validarFormatoToken(tokenRecienEmitido)).toBe(true);
      // Reloj normal (desfase 0)
      expect(esTokenValido(tokenRecienEmitido, 0, ahoraServidor * 1000)).toBe(true);

      // Reloj del teléfono adelantado 40 minutos (desfase servidor - teléfono = -40 min)
      const relojAdelantado = (ahoraServidor + 40 * 60) * 1000;
      const desfaseAdelantado = -40 * 60 * 1000;
      expect(esTokenValido(tokenRecienEmitido, desfaseAdelantado, relojAdelantado)).toBe(true);
      // Sin desfase, el reloj adelantado 40 min ve el token de 30 min como vencido
      expect(esTokenValido(tokenRecienEmitido, 0, relojAdelantado)).toBe(false);

      // Reloj del teléfono atrasado 40 minutos (desfase servidor - teléfono = +40 min)
      const relojAtrasado = (ahoraServidor - 40 * 60) * 1000;
      const desfaseAtrasado = 40 * 60 * 1000;
      expect(esTokenValido(tokenRecienEmitido, desfaseAtrasado, relojAtrasado)).toBe(true);

      // Token con iat hace 1 h y exp hace 30 min: emitido hace 1h, duración 30min
      const tokenViejo = [
        btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, ''),
        btoa(
          JSON.stringify({
            iat: ahoraServidor - 3600,
            exp: ahoraServidor - 1800,
            user_id: 'usr-1',
          })
        ).replace(/=+$/, ''),
        'sig',
      ].join('.');
      // Formato válido estructuralmente
      expect(validarFormatoToken(tokenViejo)).toBe(true);
      // Rechazado donde se evalúe vigencia con hora actual
      expect(esTokenValido(tokenViejo, 0, ahoraServidor * 1000)).toBe(false);

      // Token con exp <= iat (incoherente)
      const tokenIncoherente = [
        btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, ''),
        btoa(
          JSON.stringify({
            iat: ahoraServidor,
            exp: ahoraServidor - 60,
            user_id: 'usr-1',
          })
        ).replace(/=+$/, ''),
        'sig',
      ].join('.');
      expect(validarFormatoToken(tokenIncoherente)).toBe(false);
      expect(esTokenValido(tokenIncoherente, 0, ahoraServidor * 1000)).toBe(false);

      // Token malformado o vacío
      expect(validarFormatoToken('token.malformado')).toBe(false);
      expect(validarFormatoToken('')).toBe(false);
      expect(esTokenValido('token.malformado')).toBe(false);
      expect(esTokenValido('')).toBe(false);
    });
  });
});
