import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configurarApi,
  configurarManejador401,
  ErrorDeApi,
  pedir,
} from "./cliente";
import {
  configurarTokenStorage,
  guardarTokens,
  obtenerAccessToken,
  obtenerRefreshToken,
} from "../auth";

const almacen: Record<string, string> = {};

function respuesta(status: number, cuerpo: unknown = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("pedir(): JWT en cada petición e interceptor 401", () => {
  const fetchMock = vi.fn();
  let manejador401: ReturnType<typeof vi.fn>;

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

    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    configurarApi({ urlBase: "http://api.test" });
    manejador401 = vi.fn();
    configurarManejador401(manejador401);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("envío del JWT", () => {
    it("manda Authorization: Bearer cuando hay un token guardado", async () => {
      guardarTokens({ access_token: "abc123", refresh_token: "def456" });
      fetchMock.mockResolvedValue(respuesta(200, { ok: true }));

      await pedir("/suscripciones/");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://api.test/suscripciones/");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer abc123",
      );
    });

    it("no manda Authorization cuando no hay token", async () => {
      fetchMock.mockResolvedValue(respuesta(200, { ok: true }));

      await pedir("/publico/");

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers as Record<string, string>).not.toHaveProperty(
        "Authorization",
      );
    });
  });

  describe("interceptor 401", () => {
    it("borra los tokens, avisa al manejador y rechaza con ErrorDeApi", async () => {
      guardarTokens({ access_token: "vencido", refresh_token: "tambien" });
      fetchMock.mockResolvedValue(respuesta(401, { detail: "Token vencido" }));

      await expect(pedir("/suscripciones/")).rejects.toMatchObject({
        status: 401,
        message: "Token vencido",
      });

      expect(obtenerAccessToken()).toBeNull();
      expect(obtenerRefreshToken()).toBeNull();
      expect(manejador401).toHaveBeenCalledTimes(1);
    });

    it("con un 500 no toca la sesión ni dispara el manejador", async () => {
      guardarTokens({ access_token: "valido", refresh_token: "valido" });
      fetchMock.mockResolvedValue(respuesta(500, { detail: "Error interno" }));

      await expect(pedir("/suscripciones/")).rejects.toMatchObject({
        status: 500,
      });

      expect(obtenerAccessToken()).toBe("valido");
      expect(manejador401).not.toHaveBeenCalled();
    });

    it("con un 403 tampoco cierra la sesión", async () => {
      guardarTokens({ access_token: "valido", refresh_token: "valido" });
      fetchMock.mockResolvedValue(respuesta(403, { detail: "Sin permiso" }));

      await expect(pedir("/admin/")).rejects.toMatchObject({ status: 403 });

      expect(obtenerAccessToken()).toBe("valido");
      expect(manejador401).not.toHaveBeenCalled();
    });

    it("con una respuesta exitosa no dispara el manejador", async () => {
      guardarTokens({ access_token: "valido", refresh_token: "valido" });
      fetchMock.mockResolvedValue(respuesta(200, { ok: true }));

      await pedir("/suscripciones/");

      expect(manejador401).not.toHaveBeenCalled();
      expect(obtenerAccessToken()).toBe("valido");
    });
  });
});