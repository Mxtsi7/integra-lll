import { describe, it, expect, vi, beforeEach } from "vitest";
import { configurarApi, configurarManejador401, pedir, ErrorDeApi} from "./cliente";
import { configurarTokenStorage, guardarTokens, hayTokenGuardado} from "../auth";

const almacen: Record<string, string> = {};

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

  configurarApi({ urlBase: "http://api.test/api" });
});

function respuesta(status: number, cuerpo: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => cuerpo,
  });
}

describe("pedir", () => {
  it("agrega el Authorization cuando hay token", async () => {
    guardarTokens({ access_token: "abc", refresh_token: "def" });
    const fetchFalso = respuesta(200, { ok: true });
    vi.stubGlobal("fetch", fetchFalso);

    await pedir("/suscripciones/");

    const [, init] = fetchFalso.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe("Bearer abc");
  });

  it("un 401 borra los tokens y avisa al manejador", async () => {
    guardarTokens({ access_token: "abc", refresh_token: "def" });
    const avisado = vi.fn();
    configurarManejador401(avisado);
    vi.stubGlobal("fetch", respuesta(401, { detail: "Token inválido" }));

    await expect(pedir("/suscripciones/")).rejects.toBeInstanceOf(ErrorDeApi);
    expect(hayTokenGuardado()).toBe(false);
    expect(avisado).toHaveBeenCalled();
  });

  it("un 403 NO cierra la sesión", async () => {
    guardarTokens({ access_token: "abc", refresh_token: "def" });
    vi.stubGlobal(
      "fetch",
      respuesta(403, { detail: "Falta el contexto de organización" }),
    );

    await expect(pedir("/suscripciones/")).rejects.toMatchObject({ status: 403 });
    expect(hayTokenGuardado()).toBe(true);
  });
});