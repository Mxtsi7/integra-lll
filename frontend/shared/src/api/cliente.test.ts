import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configurarApi, configurarManejador401, ErrorDeApi, pedir} from "./cliente";
import { guardarTokens, obtenerAccessToken, obtenerRefreshToken } from "../auth";

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
    localStorage.clear();
    fetchMock.mockReset();
    // pedir() llama a `fetch` global en cada invocación, así que
    // reemplazarlo acá alcanza: ninguna prueba toca la red de verdad.
    vi.stubGlobal("fetch", fetchMock);
    configurarApi({ urlBase: "http://api.test" });
    // Manejador nuevo por prueba: configurarManejador401 guarda estado a
    // nivel de módulo, y sin esto una prueba vería las llamadas de la
    // anterior.
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

      const promesa = pedir("/suscripciones/");

      await expect(promesa).rejects.toBeInstanceOf(ErrorDeApi);
      await expect(promesa).rejects.toMatchObject({
        status: 401,
        message: "Token vencido",
      });
      // "forzar logout": no queda ningún token en el storage
      expect(obtenerAccessToken()).toBeNull();
      expect(obtenerRefreshToken()).toBeNull();
      // y la app (web/móvil) fue avisada para redirigir a login
      expect(manejador401).toHaveBeenCalledTimes(1);
    });

    it("con un 500 no toca la sesión ni dispara el manejador", async () => {
      guardarTokens({ access_token: "valido", refresh_token: "valido" });
      fetchMock.mockResolvedValue(respuesta(500, { detail: "Error interno" }));

      await expect(pedir("/suscripciones/")).rejects.toMatchObject({
        status: 500,
      });

      // Un error del servidor no significa que la sesión sea inválida:
      // desloguear acá sacaría al usuario por un fallo que no es suyo.
      expect(obtenerAccessToken()).toBe("valido");
      expect(manejador401).not.toHaveBeenCalled();
    });

    it("con un 403 tampoco cierra la sesión", async () => {
      guardarTokens({ access_token: "valido", refresh_token: "valido" });
      fetchMock.mockResolvedValue(respuesta(403, { detail: "Sin permiso" }));

      await expect(pedir("/admin/")).rejects.toMatchObject({ status: 403 });

      // 403 = autenticado pero sin permiso para ese recurso. El token
      // sigue siendo válido; solo se rechazó esa acción puntual.
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