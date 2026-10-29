import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configurarApi,
  configurarManejador401,
  ErrorDeApi,
  pedir,
} from "./cliente";
import {
  configurarTokenStorage,
  configureAuthApi,
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
    configurarApi({ urlBase: "http://api.test/api" });
    configureAuthApi({ baseUrl: "http://api.test/api" });
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
      expect(url).toBe("http://api.test/api/suscripciones/");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer abc123",
      );
    });

    it("no manda Authorization cuando no hay token", async () => {
      fetchMock.mockResolvedValue(respuesta(200, { ok: true }));

      await pedir("/publico/");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://api.test/api/publico/");
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

    it("un 401 de una petición hecha con un token viejo no borra la sesión nueva", async () => {
      guardarTokens({ access_token: "viejo", refresh_token: "viejo" });
      fetchMock.mockImplementation(async () => {
        // Mientras la petición viaja, el usuario vuelve a iniciar sesión.
        guardarTokens({ access_token: "nuevo", refresh_token: "nuevo" });
        return respuesta(401, { detail: "Token vencido" });
      });

      await expect(pedir("/suscripciones/")).rejects.toMatchObject({ status: 401 });

      expect(obtenerAccessToken()).toBe("nuevo");
      expect(manejador401).not.toHaveBeenCalled();
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

  describe("renovación automática (VI-16)", () => {
    it("ante un 401 renueva y repite la petición con el token nuevo", async () => {
      guardarTokens({ access_token: "vencido", refresh_token: "refresco" });
      fetchMock.mockImplementation(
        async (url: string, init: RequestInit) => {
          if (url.endsWith("/auth/refresh/")) {
            return respuesta(200, {
              access_token: "nuevo",
              refresh_token: "refresco-nuevo",
            });
          }
          const autorizacion = (init.headers as Record<string, string>)
            .Authorization;
          return autorizacion === "Bearer nuevo"
            ? respuesta(200, { ok: true })
            : respuesta(401, { detail: "Token vencido" });
        },
      );

      await expect(pedir("/suscripciones/")).resolves.toEqual({ ok: true });

      expect(obtenerAccessToken()).toBe("nuevo");
      expect(manejador401).not.toHaveBeenCalled();
      const urls = fetchMock.mock.calls.map(([url]) => url);
      expect(urls).toEqual([
        "http://api.test/api/suscripciones/",
        "http://api.test/api/auth/refresh/",
        "http://api.test/api/suscripciones/",
      ]);
    });

    it("si el refresh también da 401 cierra la sesión y no repite la petición", async () => {
      guardarTokens({ access_token: "vencido", refresh_token: "refresco" });
      fetchMock.mockResolvedValue(respuesta(401, { detail: "Token vencido" }));

      await expect(pedir("/suscripciones/")).rejects.toMatchObject({
        status: 401,
      });

      expect(obtenerAccessToken()).toBeNull();
      expect(obtenerRefreshToken()).toBeNull();
      expect(manejador401).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2); // original + refresh
    });

    it("si el refresh da 503 conserva la sesión y propaga el error", async () => {
      guardarTokens({ access_token: "vencido", refresh_token: "refresco" });
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith("/auth/refresh/")) {
          return respuesta(503, { detail: "Redis caído" });
        }
        return respuesta(401, { detail: "Token vencido" });
      });

      await expect(pedir("/suscripciones/")).rejects.toMatchObject({
        status: 401,
      });

      expect(obtenerAccessToken()).toBe("vencido");
      expect(obtenerRefreshToken()).toBe("refresco");
      expect(manejador401).not.toHaveBeenCalled();
    });
  });
});