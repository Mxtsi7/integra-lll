import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configurarTokenStorage,
  guardarTokens,
  haySesionValida,
  logout,
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
