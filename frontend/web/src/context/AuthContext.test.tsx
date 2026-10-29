// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUsuarioActual,
  guardarTokens,
  hayTokenGuardado,
  obtenerAccessToken,
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

// Revisión de #128: la marca es observable (`sesion`) para que <RutaPrivada>
// vuelva a montar lo privado, y un refresh del access no la cambia.
describe("Marca de sesión observable", () => {
  /** Un JWT con los claims del servicio auth. */
  function jwtDeSesion(user_id: number, sid: string, jti: string): string {
    const b64 = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const exp = Math.floor((Date.now() + 30 * 60_000) / 1000);
    return `${b64({ alg: "HS256" })}.${b64({ user_id, organizacion_id: `org-${user_id}`, sid, jti, exp })}.firma`;
  }

  async function otraPestanaGuarda(access: string) {
    guardarTokens({ access_token: access, refresh_token: `refresh-${access.slice(-8)}` });
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
    });
  }

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
