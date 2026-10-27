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
