// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUsuarioActual,
  guardarTokens,
  hayTokenGuardado,
  obtenerAccessToken,
  obtenerRefreshToken,
  type Usuario,
} from "@ojoalgasto/shared";
import { AuthProvider, useAuth } from "./AuthContext";
import { ToastProvider } from "./ToastContext";

// Solo se simula /usuarios/me/; tokens y sesión son los reales de shared.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getUsuarioActual: vi.fn() };
});
const getUsuarioActualMock = vi.mocked(getUsuarioActual);

const USUARIO_A: Usuario = {
  id: "7",
  nombre: "Ana Pérez",
  correo: "ana@ejemplo.com",
  rol: "titular",
  organizacion_id: "org-1",
  plan: "gratuito",
};
const USUARIO_B: Usuario = { ...USUARIO_A, id: "8", nombre: "Bruno Soto", correo: "bruno@ejemplo.com", organizacion_id: "org-2" };

function jwt(sub: string): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ sub, exp: Math.floor((Date.now() + 30 * 60_000) / 1000) })}.firma`;
}

function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

async function montar() {
  const hook = renderHook(() => useAuth(), { wrapper: Proveedores });
  await act(async () => {}); // /usuarios/me/ de A
  return hook;
}

beforeEach(() => {
  localStorage.clear();
  guardarTokens({ access_token: jwt("7"), refresh_token: "refresh-a" });
  getUsuarioActualMock.mockReset().mockResolvedValue(USUARIO_A);
});

afterEach(() => {
  cleanup();
});

// Revisión de #99: el contexto es quien garantiza que una respuesta tardía
// no toque otra sesión, no el formulario que la pidió.
describe("Marca de sesión", () => {
  it("actualizarUsuario acepta al usuario confirmado en la misma sesión", async () => {
    const { result } = await montar();
    const sesion = result.current.capturarSesion();

    let aplicado = false;
    act(() => {
      aplicado = result.current.actualizarUsuario({ ...USUARIO_A, nombre: "Ana Cambiada" }, sesion);
    });

    expect(aplicado).toBe(true);
    expect(result.current.usuario?.nombre).toBe("Ana Cambiada");
  });

  it("actualizarUsuario rechaza a otro usuario aunque la marca sea la vigente", async () => {
    const { result } = await montar();
    const sesion = result.current.capturarSesion();

    let aplicado = true;
    act(() => {
      aplicado = result.current.actualizarUsuario(USUARIO_B, sesion);
    });

    expect(aplicado).toBe(false);
    expect(result.current.usuario?.id).toBe("7");
  });

  it("cerrarSesionLocal con la marca de una sesión anterior no cierra la nueva; sin marca, cierra la que haya", async () => {
    const { result } = await montar();
    const sesionA = result.current.capturarSesion();
    getUsuarioActualMock.mockResolvedValue(USUARIO_B);
    const tokenB = jwt("8");
    await act(async () => {
      result.current.iniciarSesion({ access_token: tokenB, refresh_token: "refresh-b" });
    });

    let cerrada = true;
    act(() => {
      cerrada = result.current.cerrarSesionLocal(sesionA);
    });
    expect(cerrada).toBe(false);
    expect(obtenerAccessToken()).toBe(tokenB);
    expect(result.current.usuario?.id).toBe("8");

    // Restablecer contraseña y eliminar cuenta la llaman sin marca, como antes.
    act(() => {
      cerrada = result.current.cerrarSesionLocal();
    });
    expect(cerrada).toBe(true);
    expect(hayTokenGuardado()).toBe(false);
    expect(result.current.estaAutenticado).toBe(false);
  });
});

/** Un JWT con los claims del servicio auth. */
function jwtDeSesion(user_id: number, sid: string, jti: string): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const exp = Math.floor((Date.now() + 30 * 60_000) / 1000);
  return `${b64({ alg: "HS256" })}.${b64({ user_id, organizacion_id: `org-${user_id}`, sid, jti, exp })}.firma`;
}

/** Otra pestaña guarda tokens: a esta solo le llega el evento `storage`. */
async function otraPestanaGuarda(access: string, refresh = `refresh-${access.slice(-8)}`) {
  guardarTokens({ access_token: access, refresh_token: refresh });
  await act(async () => {
    window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
  });
}

// Revisión de #128: la marca es observable (`sesion`) para que <RutaPrivada>
// vuelva a montar lo privado, y un refresh del access no la cambia.
describe("Marca de sesión observable", () => {
  beforeEach(() => {
    guardarTokens({ access_token: jwtDeSesion(7, "sesion-a", "a-1"), refresh_token: "refresh-a" });
  });

  it("cambia, junto con capturarSesion(), cuando otra pestaña entra con otra cuenta", async () => {
    const { result } = await montar();
    const antes = result.current.sesion;
    expect(result.current.capturarSesion()).toBe(antes);

    getUsuarioActualMock.mockResolvedValue(USUARIO_B);
    await otraPestanaGuarda(jwtDeSesion(8, "sesion-b", "b-1"));

    expect(result.current.sesion).not.toBe(antes);
    expect(result.current.capturarSesion()).toBe(result.current.sesion);
    expect(result.current.usuario?.id).toBe("8");
  });

  it("no cambia ni vuelve a pedir el usuario cuando otra pestaña solo renueva el access", async () => {
    const { result } = await montar();
    const antes = result.current.sesion;
    expect(getUsuarioActualMock).toHaveBeenCalledTimes(1);

    await otraPestanaGuarda(jwtDeSesion(7, "sesion-a", "a-2"));
    expect(result.current.sesion).toBe(antes);
    expect(result.current.capturarSesion()).toBe(antes);
    expect(getUsuarioActualMock).toHaveBeenCalledTimes(1);

    // Después del refresh, otra cuenta sí se detecta (el token conocido es el nuevo).
    getUsuarioActualMock.mockResolvedValue(USUARIO_B);
    await otraPestanaGuarda(jwtDeSesion(8, "sesion-b", "b-1"));
    expect(result.current.sesion).not.toBe(antes);
    expect(result.current.usuario?.id).toBe("8");
  });

  it("un nuevo login de la misma cuenta en otra pestaña (otro sid) es otra sesión", async () => {
    const { result } = await montar();
    const antes = result.current.sesion;

    await otraPestanaGuarda(jwtDeSesion(7, "sesion-a-2", "a-3"));
    expect(result.current.sesion).not.toBe(antes);
  });

  it("cambia al cerrar sesión y al entrar", async () => {
    const { result } = await montar();
    const conA = result.current.sesion;

    await act(async () => {
      result.current.cerrarSesionLocal();
    });
    const anonima = result.current.sesion;
    expect(anonima).not.toBe(conA);

    await act(async () => {
      result.current.iniciarSesion({ access_token: jwtDeSesion(8, "sesion-b", "b-1"), refresh_token: "refresh-b" });
    });
    expect(result.current.sesion).not.toBe(anonima);
    expect(result.current.capturarSesion()).toBe(result.current.sesion);
  });
});

// Revisión de #128 (P2): un refresh mientras /usuarios/me/ viaja. Acá el
// cliente compartido es el real (pedir() y su protección del 401 de un token
// anterior); solo se simula fetch.
describe("Refresh con /usuarios/me/ en vuelo", () => {
  const A1 = jwtDeSesion(7, "sesion-a", "a-1");
  const A2 = jwtDeSesion(7, "sesion-a", "a-2");
  const A3 = jwtDeSesion(7, "sesion-a", "a-3");
  const B = jwtDeSesion(8, "sesion-b", "b-1");

  type Respuesta = { status: number; cuerpo: unknown };
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  /** Cada consulta a /usuarios/me/ queda pendiente hasta que el test la responde. */
  const consultas: { token: string | undefined; responder: (r: Respuesta) => void }[] = [];
  const responder = (n: number, status: number, cuerpo: unknown = {}) =>
    act(async () => consultas[n].responder({ status, cuerpo }));

  beforeEach(async () => {
    const real = await vi.importActual<typeof import("@ojoalgasto/shared")>("@ojoalgasto/shared");
    real.configurarApi({ urlBase: "http://api.test" });
    getUsuarioActualMock.mockImplementation(real.getUsuarioActual);
    consultas.length = 0;
    fetchMock.mockReset().mockImplementation(
      (_url, init) =>
        new Promise<Response>((resolver) => {
          const encabezados = init?.headers as Record<string, string> | undefined;
          consultas.push({
            token: encabezados?.Authorization?.replace("Bearer ", ""),
            responder: ({ status, cuerpo }) =>
              resolver({ ok: status >= 200 && status < 300, status, json: async () => cuerpo } as unknown as Response),
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    guardarTokens({ access_token: A1, refresh_token: "refresh-a1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un 401 tardío de la consulta con el access anterior no borra el par renovado", async () => {
    const { result } = await montar();
    expect(result.current.estado.tipo).toBe("verificando");
    const marca = result.current.sesion;

    await otraPestanaGuarda(A2, "refresh-a2");
    await responder(0, 401, { detail: "Token vencido." });

    // Se conservan los dos tokens nuevos y se vuelve a preguntar con A2.
    expect(obtenerAccessToken()).toBe(A2);
    expect(obtenerRefreshToken()).toBe("refresh-a2");
    expect(consultas.map((c) => c.token)).toEqual([A1, A2]);
    expect(result.current.estado.tipo).toBe("verificando");

    await responder(1, 200, USUARIO_A);
    expect(result.current.usuario).toEqual(USUARIO_A);
    expect(obtenerAccessToken()).toBe(A2);
    expect(obtenerRefreshToken()).toBe("refresh-a2");
    // La misma sesión de principio a fin: nada se vuelve a montar.
    expect(result.current.sesion).toBe(marca);
  });

  it("vuelve a preguntar una vez por cada renovación y termina", async () => {
    const { result } = await montar();

    await otraPestanaGuarda(A2, "refresh-a2");
    await responder(0, 401);
    await otraPestanaGuarda(A3, "refresh-a3");
    await responder(1, 401);
    await responder(2, 200, USUARIO_A);

    expect(consultas.map((c) => c.token)).toEqual([A1, A2, A3]);
    expect(result.current.usuario).toEqual(USUARIO_A);
    expect(obtenerRefreshToken()).toBe("refresh-a3");
  });

  it("si la consulta con el access anterior responde bien, se usa sin volver a preguntar", async () => {
    const { result } = await montar();

    await otraPestanaGuarda(A2, "refresh-a2");
    await responder(0, 200, USUARIO_A);

    expect(result.current.usuario).toEqual(USUARIO_A);
    expect(consultas).toHaveLength(1);
    expect(obtenerAccessToken()).toBe(A2);
  });

  it("después de volver a preguntar, un 404 del access renovado cierra la sesión sin insistir", async () => {
    const { result } = await montar();

    await otraPestanaGuarda(A2, "refresh-a2");
    await responder(0, 401);
    await responder(1, 404, { detail: "Usuario no encontrado." });

    expect(consultas.map((c) => c.token)).toEqual([A1, A2]);
    expect(obtenerAccessToken()).toBeNull();
    expect(result.current.estado.tipo).toBe("anonimo");
  });

  it("una renovación hecha en esta misma pestaña (sin evento storage) también se respeta", async () => {
    const { result } = await montar();

    // El refresh lo guarda esta pestaña: no llega ningún `storage`.
    guardarTokens({ access_token: A2, refresh_token: "refresh-a2" });
    await responder(0, 401);
    expect(consultas.map((c) => c.token)).toEqual([A1, A2]);
    expect(obtenerRefreshToken()).toBe("refresh-a2");

    // El rechazo ahora es del access vigente: se cierra, sin volver a preguntar.
    await responder(1, 404);
    expect(consultas).toHaveLength(2);
    expect(obtenerAccessToken()).toBeNull();
    expect(result.current.estado.tipo).toBe("anonimo");
  });

  it("si el 401 es del access vigente, la sesión se cierra como siempre", async () => {
    const { result } = await montar();

    await responder(0, 401, { detail: "Token inválido." });

    expect(obtenerAccessToken()).toBeNull();
    expect(obtenerRefreshToken()).toBeNull();
    expect(result.current.estado.tipo).toBe("anonimo");
  });

  it("el 401 de A que llega cuando ya se guardó otra cuenta no borra a B ni le pone un perfil", async () => {
    const { result } = await montar();

    // El 401 de A llega entre que la otra pestaña guarda B y el aviso `storage`.
    await act(async () => {
      guardarTokens({ access_token: B, refresh_token: "refresh-b" });
      consultas[0].responder({ status: 401, cuerpo: {} });
    });
    expect(obtenerAccessToken()).toBe(B);
    expect(obtenerRefreshToken()).toBe("refresh-b");
    expect(result.current.usuario).toBeNull();
    expect(consultas).toHaveLength(1);

    // El aviso llega: es otra sesión y se pide el perfil de B.
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
    });
    expect(consultas.map((c) => c.token)).toEqual([A1, B]);
    await responder(1, 200, USUARIO_B);
    expect(result.current.usuario).toEqual(USUARIO_B);
    expect(obtenerAccessToken()).toBe(B);
  });
});
