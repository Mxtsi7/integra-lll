// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUsuarioActual, guardarTokens, hayTokenGuardado, type Usuario } from "@ojoalgasto/shared";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { ToastProvider } from "../../context/ToastContext";
import { EliminarCuenta } from "./EliminarCuenta";

// S3-AN-03: con la sesión y el contexto reales (solo se simula la red), una respuesta de
// borrado que llega cuando ya hay otra sesión no puede cerrarla ni redirigirla.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getUsuarioActual: vi.fn() };
});
const getUsuarioActualMock = vi.mocked(getUsuarioActual);

const USUARIO: Usuario = {
  id: "7",
  nombre: "Ana Pérez",
  correo: "ana@ejemplo.com",
  rol: "titular",
  organizacion_id: "org-1",
  plan: "gratuito",
};

function jwt(sub: string): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ sub, exp: Math.floor((Date.now() + 30 * 60_000) / 1000) })}.firma`;
}

function Ubicacion() {
  return <div data-testid="ubicacion">{useLocation().pathname}</div>;
}

/** Lo que hace Login tras entrar otra cuenta (B) en el mismo navegador. */
function EntrarComoB() {
  const { iniciarSesion } = useAuth();
  return (
    <button
      type="button"
      onClick={() => iniciarSesion({ access_token: jwt("8"), refresh_token: "refresh-b" })}
    >
      Entrar como B
    </button>
  );
}

function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

async function montarYPedirBorrado(onEliminar: () => Promise<{ estado: "eliminada" }>) {
  render(
    <MemoryRouter initialEntries={["/perfil"]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<h1>Inicia sesión</h1>} />
            <Route path="/perfil" element={<EliminarCuenta onEliminar={onEliminar} disponible />} />
          </Routes>
          <EntrarComoB />
          <Ubicacion />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /^Eliminar$/ }));
  fireEvent.change(screen.getByLabelText("Tu contraseña actual"), { target: { value: "Clave123" } });
  fireEvent.change(screen.getByLabelText("Escribe ELIMINAR para confirmar"), { target: { value: "ELIMINAR" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Eliminar mi cuenta" }));
  });
}

beforeEach(() => {
  localStorage.clear();
  guardarTokens({ access_token: jwt("7"), refresh_token: "refresh" });
  getUsuarioActualMock.mockReset().mockResolvedValue(USUARIO);
});

afterEach(() => {
  cleanup();
});

describe("Eliminar cuenta: respuesta que llega con otra sesión (S3-AN-03)", () => {
  it("si entró otra cuenta mientras esperaba, la respuesta no la cierra ni redirige", async () => {
    const espera = diferida<{ estado: "eliminada" }>();
    await montarYPedirBorrado(() => espera.promesa);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Entrar como B" }));
    });
    await act(async () => {
      espera.resolver({ estado: "eliminada" });
    });

    expect(hayTokenGuardado()).toBe(true);
    expect(screen.getByTestId("ubicacion")).toHaveTextContent("/perfil");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("si la sesión sigue siendo la misma, cierra sesión, avisa y va a /login", async () => {
    const espera = diferida<{ estado: "eliminada" }>();
    await montarYPedirBorrado(() => espera.promesa);

    await act(async () => {
      espera.resolver({ estado: "eliminada" });
    });

    expect(hayTokenGuardado()).toBe(false);
    expect(screen.getByTestId("ubicacion")).toHaveTextContent("/login");
    expect(screen.getByRole("status")).toHaveTextContent("Tu cuenta fue eliminada");
  });
});
