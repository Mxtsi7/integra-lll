import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthError,
  configurarTokenStorage,
  configureAuthApi,
  register,
  restablecerContrasena,
  solicitarRecuperacion,
  guardarTokens,
  haySesionValida,
  logout,
  obtenerAccessToken,
  obtenerRefreshToken,
  renovarSesion,
  revocarSesion,
  sesionDelToken,
  tokenExpirado,
} from "./auth";

const almacen: Record<string, string> = {};

/** Arma un JWT con el payload dado. La firma da igual: el front no la verifica. */
function jwt(payload: Record<string, unknown>): string {
  const base64url = (texto: string) =>
    btoa(texto).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return [
    base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64url(JSON.stringify(payload)),
    "firma",
  ].join(".");
}

const AHORA = Date.UTC(2026, 9, 9, 12, 0, 0);
const enSegundos = (ms: number) => Math.floor(ms / 1000);

beforeEach(() => {
  for (const k of Object.keys(almacen)) delete almacen[k];
  configurarTokenStorage({
    getItem: (k: string) => almacen[k] ?? null,
    setItem: (k: string, v: string) => {
      almacen[k] = v;
    },
    removeItem: (k: string) => {
      delete almacen[k];
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tokenExpirado", () => {
  it("un token con exp en el futuro está vigente", () => {
    const token = jwt({ exp: enSegundos(AHORA + 30 * 60_000), rol: "titular" });
    expect(tokenExpirado(token, AHORA)).toBe(false);
  });

  it("un token con exp en el pasado está vencido", () => {
    const token = jwt({ exp: enSegundos(AHORA - 1_000) });
    expect(tokenExpirado(token, AHORA)).toBe(true);
  });

  it("un token que vence dentro del margen de 10 s ya se da por vencido", () => {
    const token = jwt({ exp: enSegundos(AHORA + 5_000) });
    expect(tokenExpirado(token, AHORA)).toBe(true);
  });

  it("algo que no es un JWT cuenta como vencido", () => {
    expect(tokenExpirado("undefined", AHORA)).toBe(true);
    expect(tokenExpirado("a.%%%.c", AHORA)).toBe(true);
    expect(tokenExpirado("", AHORA)).toBe(true);
  });

  it("un JWT sin exp se da por vigente (decide el backend)", () => {
    expect(tokenExpirado(jwt({ rol: "titular" }), AHORA)).toBe(false);
  });
});

// Revisión de #128: un refresh no es un cambio de cuenta.
describe("sesionDelToken", () => {
  const SESION_A = { user_id: 7, organizacion_id: "org-a", sid: "sesion-a" };

  it("el refresh de un token es de la misma sesión aunque cambien jti y exp", () => {
    const original = jwt({ ...SESION_A, jti: "a-1", exp: enSegundos(AHORA + 60_000) });
    const renovado = jwt({ ...SESION_A, jti: "a-2", exp: enSegundos(AHORA + 30 * 60_000) });
    expect(sesionDelToken(original)).not.toBeNull();
    expect(sesionDelToken(renovado)).toBe(sesionDelToken(original));
  });

  it("otro usuario, otra organización u otro login son otra sesión", () => {
    const a = sesionDelToken(jwt(SESION_A));
    expect(sesionDelToken(jwt({ ...SESION_A, user_id: 8 }))).not.toBe(a);
    expect(sesionDelToken(jwt({ ...SESION_A, organizacion_id: "org-b" }))).not.toBe(a);
    expect(sesionDelToken(jwt({ ...SESION_A, sid: "sesion-a-2" }))).not.toBe(a);
  });

  it("acepta el usuario en `sub` cuando no viene `user_id`", () => {
    expect(sesionDelToken(jwt({ sub: "7" }))).toBe(sesionDelToken(jwt({ sub: "7", jti: "otro" })));
    expect(sesionDelToken(jwt({ sub: "7" }))).not.toBe(sesionDelToken(jwt({ sub: "8" })));
  });

  it("sin usuario o sin JWT legible no se sabe de quién es", () => {
    expect(sesionDelToken(jwt({ exp: enSegundos(AHORA + 60_000) }))).toBeNull();
    expect(sesionDelToken(jwt({ user_id: { id: 7 } }))).toBeNull();
    expect(sesionDelToken("a.%%%.c")).toBeNull();
    expect(sesionDelToken("")).toBeNull();
  });
});

describe("haySesionValida", () => {
  it("sin token no hay sesión", () => {
    expect(haySesionValida(AHORA)).toBe(false);
  });

  it("con un access token vigente hay sesión", () => {
    guardarTokens({
      access_token: jwt({ exp: enSegundos(AHORA + 60_000) }),
      refresh_token: "r",
    });
    expect(haySesionValida(AHORA)).toBe(true);
  });

  it("con un access token vencido no hay sesión, pero no borra nada", () => {
    guardarTokens({
      access_token: jwt({ exp: enSegundos(AHORA - 60_000) }),
      refresh_token: "r",
    });
    expect(haySesionValida(AHORA)).toBe(false);
    // Limpiar es decisión de quien llama (AuthContext en web).
    expect(almacen.access_token).toBeDefined();
  });

  describe("con el reloj del equipo desfasado", () => {
    const HORA_SERVIDOR = AHORA;
    const tokenRecien = () =>
      jwt({ iat: enSegundos(HORA_SERVIDOR), exp: enSegundos(HORA_SERVIDOR + 30 * 60_000) });

    it("un PC 40 min adelantado igual acepta un token recién emitido", () => {
      const relojPc = HORA_SERVIDOR + 40 * 60_000;
      vi.setSystemTime(relojPc); // guardarTokens mide el desfase con la hora local
      guardarTokens({ access_token: tokenRecien(), refresh_token: "r" });

      expect(haySesionValida(relojPc)).toBe(true);
      // y vence cuando corresponde: 31 min después, en hora del PC
      expect(haySesionValida(relojPc + 31 * 60_000)).toBe(false);
    });

    it("un PC 40 min atrasado no da por buena una sesión ya vencida", () => {
      const relojPc = HORA_SERVIDOR - 40 * 60_000;
      vi.setSystemTime(relojPc);
      guardarTokens({ access_token: tokenRecien(), refresh_token: "r" });

      expect(haySesionValida(relojPc + 29 * 60_000)).toBe(true);
      expect(haySesionValida(relojPc + 31 * 60_000)).toBe(false);
    });

    it("logout() borra también el desfase guardado", () => {
      vi.setSystemTime(HORA_SERVIDOR + 40 * 60_000);
      guardarTokens({ access_token: tokenRecien(), refresh_token: "r" });
      logout();
      expect(Object.keys(almacen)).toEqual([]);
    });
  });

  it("después de logout() ya no hay sesión", () => {
    guardarTokens({
      access_token: jwt({ exp: enSegundos(AHORA + 60_000) }),
      refresh_token: "r",
    });
    logout();
    expect(haySesionValida(AHORA)).toBe(false);
  });
});

describe("revocarSesion (logout en el backend, MX-29)", () => {
  const fetchMock = vi.fn();
  let acceso: string;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    configureAuthApi({ baseUrl: "http://api.test/api" });
    acceso = jwt({ exp: enSegundos(Date.now() + 30 * 60_000) });
    guardarTokens({ access_token: acceso, refresh_token: "refresco" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respuesta = (status: number) => new Response(null, { status });

  it("manda el refresh token a POST /auth/logout/ con el access token en Authorization", async () => {
    fetchMock.mockResolvedValue(respuesta(205));

    expect(await revocarSesion()).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/auth/logout/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ refresh_token: "refresco" });
    expect(init.headers.Authorization).toBe(`Bearer ${acceso}`);
  });

  it("con el access token vencido no lo manda en Authorization (solo el refresh en el body)", async () => {
    guardarTokens({
      access_token: jwt({ exp: enSegundos(Date.now() - 60_000) }),
      refresh_token: "refresco",
    });
    fetchMock.mockResolvedValue(respuesta(205));

    expect(await revocarSesion()).toBe(true);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(init.body)).toEqual({ refresh_token: "refresco" });
  });

  it("no borra los tokens locales (eso lo hace logout() después)", async () => {
    fetchMock.mockResolvedValue(respuesta(200));
    await revocarSesion();
    expect(obtenerAccessToken()).toBe(acceso);
  });

  // Un 401 no garantiza que el refresh token se haya revocado (revisión de
  // la PR #57): cuenta como no confirmada, igual que cualquier no-2xx.
  it.each([401, 403, 500, 503, 404])("con %i la revocación queda no confirmada (false, no lanza)", async (status) => {
    fetchMock.mockResolvedValue(respuesta(status));
    expect(await revocarSesion()).toBe(false);
  });

  it("sin red devuelve false, no lanza", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await revocarSesion()).toBe(false);
  });

  it("si el servidor no responde, corta a los 5 s y devuelve false", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () =>
            rej(new DOMException("Abortado", "AbortError")),
          );
        }),
    );

    const resultado = revocarSesion();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await resultado).toBe(false);
  });

  it("sin sesión guardada no llama al backend", async () => {
    logout();
    expect(await revocarSesion()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("renovarSesion (refresh con rotación, VI-16)", () => {
  const fetchMock = vi.fn();
  const json = (status: number, cuerpo: unknown) =>
    new Response(JSON.stringify(cuerpo), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    configureAuthApi({ baseUrl: "http://api.test/api", endpoints: { refresh: "/auth/refresh/" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("manda el refresh sin Authorization y guarda LOS DOS tokens nuevos", async () => {
    guardarTokens({ access_token: "viejo", refresh_token: "refresco-viejo" });
    fetchMock.mockResolvedValue(
      json(200, { access_token: "nuevo", refresh_token: "refresco-nuevo" }),
    );

    expect(await renovarSesion()).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/auth/refresh/");
    expect(init.method).toBe("POST");
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(init.body)).toEqual({ refresh_token: "refresco-viejo" });
    expect(obtenerAccessToken()).toBe("nuevo");
    expect(obtenerRefreshToken()).toBe("refresco-nuevo");
  });

  it("peticiones concurrentes comparten una sola renovación", async () => {
    guardarTokens({ access_token: "viejo", refresh_token: "refresco" });
    let liberar: ((r: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolver) => { liberar = resolver; }),
    );

    const primera = renovarSesion();
    const segunda = renovarSesion();
    expect(segunda).toBe(primera);

    liberar?.(json(200, { access_token: "nuevo", refresh_token: "otro" }));
    expect(await primera).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  const sesionA = { user_id: 7, organizacion_id: "org-a" };
  const sesionB = { user_id: 7, organizacion_id: "org-a" };
  const refreshA = jwt({ ...sesionA, sid: "a-1", jti: "a-1" });
  const accessA = jwt({ ...sesionA, sid: "a-1", jti: "a-0" });
  const refreshB = jwt({ ...sesionB, sid: "b-1", jti: "b-1" });
  const accessB = jwt({ ...sesionB, sid: "b-1", jti: "b-0" });

  it("un 200 tardío de la sesión A no se instala sobre la sesión B", async () => {
    guardarTokens({ access_token: accessA, refresh_token: refreshA });
    let liberar: ((r: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolver) => { liberar = resolver; }),
    );

    const operacionA = renovarSesion();
    // Mientras el refresh de A viaja, alguien vuelve a entrar (otro `sid`).
    guardarTokens({ access_token: accessB, refresh_token: refreshB });
    liberar?.(
      json(200, {
        access_token: jwt({ ...sesionA, sid: "a-1", jti: "a-2" }),
        refresh_token: jwt({ ...sesionA, sid: "a-1", jti: "a-3" }),
      }),
    );

    expect(await operacionA).toBe(false);
    expect(obtenerAccessToken()).toBe(accessB);
    expect(obtenerRefreshToken()).toBe(refreshB);
  });

  it("un 401 tardío de la sesión A no cierra la sesión B", async () => {
    guardarTokens({ access_token: accessA, refresh_token: refreshA });
    let liberar: ((r: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolver) => { liberar = resolver; }),
    );

    const operacionA = renovarSesion();
    guardarTokens({ access_token: accessB, refresh_token: refreshB });
    liberar?.(json(401, { detail: "Refresh inválido" }));

    expect(await operacionA).toBe(false);
    expect(obtenerAccessToken()).toBe(accessB);
    expect(obtenerRefreshToken()).toBe(refreshB);
  });

  it("una sesión nueva no hereda la renovación en vuelo de la anterior", async () => {
    guardarTokens({ access_token: accessA, refresh_token: refreshA });
    const pendientes = new Map<string, (r: Response) => void>();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolver) => {
          const { refresh_token } = JSON.parse(String(init.body)) as {
            refresh_token: string;
          };
          pendientes.set(refresh_token, resolver);
        }),
    );

    const operacionA = renovarSesion();
    guardarTokens({ access_token: accessB, refresh_token: refreshB });
    const operacionB = renovarSesion();

    expect(operacionB).not.toBe(operacionA);

    // B espera el turno de renovación (bloqueo entre pestañas); cuando A
    // termina, su respuesta ya no corresponde a la sesión activa.
    pendientes.get(refreshA)?.(
      json(200, {
        access_token: jwt({ ...sesionA, sid: "a-1", jti: "a-2" }),
        refresh_token: jwt({ ...sesionA, sid: "a-1", jti: "a-3" }),
      }),
    );
    expect(await operacionA).toBe(false);
    await vi.waitFor(() => expect(pendientes.has(refreshB)).toBe(true));

    const accessBRenovado = jwt({ ...sesionB, sid: "b-1", jti: "b-2" });
    const refreshBRotado = jwt({ ...sesionB, sid: "b-1", jti: "b-3" });
    pendientes.get(refreshB)?.(
      json(200, { access_token: accessBRenovado, refresh_token: refreshBRotado }),
    );

    expect(await operacionB).toBe(true);
    expect(obtenerAccessToken()).toBe(accessBRenovado);
    expect(obtenerRefreshToken()).toBe(refreshBRotado);
  });

  it("si A espera el bloqueo y entra B, A no consume el refresh de B", async () => {
    let liberar: (() => void) | undefined;
    const espera = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    vi.stubGlobal("navigator", {
      locks: {
        request: <T>(_nombre: string, callback: () => Promise<T>) =>
          espera.then(callback),
      },
    });

    guardarTokens({ access_token: accessA, refresh_token: refreshA });
    const operacionA = renovarSesion();

    // B entra mientras el trabajo de A sigue esperando el turno del bloqueo.
    guardarTokens({ access_token: accessB, refresh_token: refreshB });
    const operacionB = renovarSesion();

    const accessBRenovado = jwt({ ...sesionB, sid: "b-1", jti: "b-2" });
    const refreshBRotado = jwt({ ...sesionB, sid: "b-1", jti: "b-3" });
    fetchMock.mockResolvedValue(
      json(200, { access_token: accessBRenovado, refresh_token: refreshBRotado }),
    );

    liberar?.();

    expect(await operacionA).toBe(false);
    expect(await operacionB).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ refresh_token: refreshB });
    expect(obtenerAccessToken()).toBe(accessBRenovado);
    expect(obtenerRefreshToken()).toBe(refreshBRotado);
  });

  it("un 401 descarta la sesión y NO reintenta", async () => {
    guardarTokens({ access_token: "viejo", refresh_token: "refresco" });
    fetchMock.mockResolvedValue(json(401, { detail: "Refresh inválido" }));

    expect(await renovarSesion()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(obtenerAccessToken()).toBeNull();
    expect(obtenerRefreshToken()).toBeNull();
  });

  it("un 503 conserva los tokens y reintenta una vez", async () => {
    guardarTokens({ access_token: "viejo", refresh_token: "refresco" });
    fetchMock
      .mockResolvedValueOnce(json(503, { detail: "Redis caído" }))
      .mockResolvedValueOnce(
        json(200, { access_token: "nuevo", refresh_token: "refresco-nuevo" }),
      );

    expect(await renovarSesion()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(obtenerAccessToken()).toBe("nuevo");
  });

  it("si el 503 persiste conserva ambos tokens para reintentar después", async () => {
    guardarTokens({ access_token: "viejo", refresh_token: "refresco" });
    fetchMock.mockResolvedValue(json(503, { detail: "Redis caído" }));

    expect(await renovarSesion()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(obtenerAccessToken()).toBe("viejo");
    expect(obtenerRefreshToken()).toBe("refresco");
  });

  it("sin red conserva la sesión y no repite el refresh consumido", async () => {
    guardarTokens({ access_token: "viejo", refresh_token: "refresco" });
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await renovarSesion()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(obtenerAccessToken()).toBe("viejo");
    expect(obtenerRefreshToken()).toBe("refresco");
  });

  it("un 200 fuera de contrato no se reintenta", async () => {
    guardarTokens({ access_token: "viejo", refresh_token: "refresco" });
    fetchMock.mockResolvedValue(json(200, { access_token: "solo-uno" }));

    expect(await renovarSesion()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(obtenerAccessToken()).toBe("viejo");
  });

  it("sin refresh guardado no llama al backend", async () => {
    guardarTokens({ access_token: "viejo", refresh_token: "" });

    expect(await renovarSesion()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si el servidor no responde, corta a los 8 s y conserva los tokens", async () => {
    vi.useFakeTimers();
    guardarTokens({ access_token: "viejo", refresh_token: "refresco" });
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () =>
            rej(new DOMException("Abortado", "AbortError")),
          );
        }),
    );

    const resultado = renovarSesion();
    await vi.advanceTimersByTimeAsync(8_000);

    expect(await resultado).toBe(false);
    expect(obtenerRefreshToken()).toBe("refresco");
  });
});

describe("errores del backend en AuthError (CH-04)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    configureAuthApi({ baseUrl: "http://api.test/api" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (status: number, cuerpo: unknown) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

  it("conserva TODOS los errores por campo, no solo el primero", async () => {
    fetchMock.mockResolvedValue(
      json(400, {
        email: ["user with this email already exists."],
        password: ["La contraseña debe tener al menos 8 caracteres, una letra y un número."],
      }),
    );

    const error = await register({ nombre: "Ana", correo: "a@b.cl", password: "x", aceptaDatos: true }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(400);
    expect((error as AuthError).message).toBe("user with this email already exists.");
    expect((error as AuthError).campos).toEqual({
      email: ["user with this email already exists."],
      password: ["La contraseña debe tener al menos 8 caracteres, una letra y un número."],
    });
  });

  it("guarda el code del cuerpo y no lo confunde con un campo", async () => {
    fetchMock.mockResolvedValue(
      json(410, {
        code: "token_usado",
        detail: "El enlace ya fue utilizado. Solicita uno nuevo.",
        solicitar_nuevo_enlace: "/api/auth/password-reset/",
      }),
    );

    const error = (await restablecerContrasena("tok", "clave1234").catch((e: unknown) => e)) as AuthError;

    expect(error.status).toBe(410);
    expect(error.codigo).toBe("token_usado");
    expect(error.message).toBe("El enlace ya fue utilizado. Solicita uno nuevo.");
    expect(error.campos).toBeUndefined();
  });
});

describe("recuperación de contraseña (CH-06 / CH-07)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    configureAuthApi({ baseUrl: "http://api.test/api" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (status: number, cuerpo: unknown) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

  it("solicitarRecuperacion hace POST /auth/password-reset/ con el correo sin espacios", async () => {
    fetchMock.mockResolvedValue(json(200, { detail: "Si el correo está registrado, recibirás un enlace." }));

    const respuesta = await solicitarRecuperacion("  ana@ejemplo.com ");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/auth/password-reset/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ email: "ana@ejemplo.com" });
    expect(respuesta.detail).toBe("Si el correo está registrado, recibirás un enlace.");
  });

  it("restablecerContrasena hace POST /auth/password-reset/confirm/ con token y password", async () => {
    fetchMock.mockResolvedValue(json(200, { detail: "Contraseña restablecida. Inicia sesión nuevamente." }));

    await restablecerContrasena("MQ.abc-123", "clave1234");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/auth/password-reset/confirm/");
    expect(JSON.parse(init.body)).toEqual({ token: "MQ.abc-123", password: "clave1234" });
  });

  it("una contraseña rechazada llega como error del campo password", async () => {
    fetchMock.mockResolvedValue(json(400, { password: ["La contraseña debe tener al menos 8 caracteres, una letra y un número."] }));

    const error = (await restablecerContrasena("tok", "corta").catch((e: unknown) => e)) as AuthError;

    expect(error.status).toBe(400);
    expect(error.codigo).toBeUndefined();
    expect(error.campos?.password).toEqual([
      "La contraseña debe tener al menos 8 caracteres, una letra y un número.",
    ]);
  });
});
