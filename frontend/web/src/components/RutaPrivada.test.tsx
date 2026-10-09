// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorDeApi,
  getUsuarioActual,
  hayTokenGuardado,
  login,
  type Usuario,
} from "@ojoalgasto/shared";
import { ToastProvider } from "../context/ToastContext";
import { AuthProvider } from "../context/AuthContext";
import { RutaPrivada, SoloInvitados } from "./RutaPrivada";
import { AppLayout } from "./layout/AppLayout";
import Login from "../pages/Login";

// Solo se reemplazan las llamadas de red; tokens, logout() y la validación
// del JWT son las reales de shared (usan el localStorage de jsdom).
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getUsuarioActual: vi.fn(), login: vi.fn() };
});

const getUsuarioActualMock = vi.mocked(getUsuarioActual);
const loginMock = vi.mocked(login);

const USUARIO: Usuario = {
  id: "1",
  nombre: "Christopher",
  correo: "c@test.cl",
  rol: "titular",
  organizacion_id: "org-1",
  plan: "premium",
};

function jwt(expEnMs: number): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(expEnMs / 1000) })}.firma`;
}

function guardarSesion(expEnMs: number) {
  localStorage.setItem("access_token", jwt(expEnMs));
  localStorage.setItem("refresh_token", "refresh");
}

function UbicacionActual() {
  const location = useLocation();
  return <div data-testid="ubicacion">{location.pathname}</div>;
}

function PaginaPrivada({ titulo }: { titulo: string }) {
  return (
    <AppLayout headerTitulo={titulo} headerSubtitulo="">
      <p>contenido privado</p>
    </AppLayout>
  );
}

/** Misma estructura de rutas que App.tsx, con páginas livianas. */
function montar(rutaInicial: string) {
  return render(
    <MemoryRouter initialEntries={[rutaInicial]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route element={<SoloInvitados />}>
              <Route path="/login" element={<Login />} />
            </Route>
            <Route element={<RutaPrivada />}>
              <Route path="/dashboard" element={<PaginaPrivada titulo="Panel" />} />
              <Route path="/home" element={<PaginaPrivada titulo="Inicio" />} />
              <Route path="/perfil" element={<PaginaPrivada titulo="Perfil" />} />
            </Route>
          </Routes>
          <UbicacionActual />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const ubicacion = () => screen.getByTestId("ubicacion").textContent;

beforeEach(() => {
  localStorage.clear();
  getUsuarioActualMock.mockReset();
  loginMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Protección de rutas privadas", () => {
  it.each(["/home", "/dashboard", "/perfil"])(
    "sin sesión, %s redirige a /login",
    async (ruta) => {
      montar(ruta);
      await waitFor(() => expect(ubicacion()).toBe("/login"));
      expect(screen.queryByText("contenido privado")).not.toBeInTheDocument();
      expect(getUsuarioActualMock).not.toHaveBeenCalled();
    },
  );

  it("con un token vencido redirige a /login y borra los tokens", async () => {
    guardarSesion(Date.now() - 60_000);
    montar("/dashboard");

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(hayTokenGuardado()).toBe(false);
  });

  it("con un token que no es JWT redirige a /login", async () => {
    localStorage.setItem("access_token", "undefined");
    montar("/perfil");

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(hayTokenGuardado()).toBe(false);
  });

  it("con sesión, /login manda al panel", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    montar("/login");

    await waitFor(() => expect(ubicacion()).toBe("/dashboard"));
  });
});

describe("Recuperación de la sesión al recargar", () => {
  it("con token vigente muestra un spinner y luego la página con el usuario real", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    let responder: (u: Usuario) => void = () => {};
    getUsuarioActualMock.mockReturnValue(new Promise((r) => (responder = r)));

    montar("/perfil");

    // Mientras /usuarios/me/ no responde: ni login ni página.
    expect(screen.getByRole("status", { name: "Verificando tu sesión" })).toBeInTheDocument();
    expect(ubicacion()).toBe("/perfil");

    await act(async () => responder(USUARIO));

    expect(screen.getByText("contenido privado")).toBeInTheDocument();
    expect(screen.getByText("Christopher")).toBeInTheDocument();
    expect(screen.getByText("Plan Premium")).toBeInTheDocument();
    expect(ubicacion()).toBe("/perfil");
  });

  it("si /usuarios/me/ responde 401, cierra la sesión y va a /login", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockRejectedValue(new ErrorDeApi("Token inválido", 401));
    montar("/dashboard");

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(hayTokenGuardado()).toBe(false);
  });

  it("si /usuarios/me/ falla por red, NO echa al usuario", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockRejectedValue(new TypeError("Failed to fetch"));
    montar("/dashboard");

    expect(await screen.findByText("contenido privado")).toBeInTheDocument();
    expect(hayTokenGuardado()).toBe(true);
  });
});

describe("Login y vuelta a la página pedida", () => {
  it("tras iniciar sesión vuelve a la ruta privada que se quiso abrir", async () => {
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    loginMock.mockResolvedValue({
      access_token: jwt(Date.now() + 30 * 60_000),
      refresh_token: "refresh",
      usuario: { id: 1, nombre: "Christopher", correo: "c@test.cl" },
    });

    montar("/perfil");
    await waitFor(() => expect(ubicacion()).toBe("/login"));

    fireEvent.change(screen.getByLabelText("CORREO ELECTRÓNICO"), {
      target: { value: "c@test.cl" },
    });
    fireEvent.change(screen.getByLabelText("CONTRASEÑA"), {
      target: { value: "Clave1234!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(ubicacion()).toBe("/perfil"));
    expect(await screen.findByText("contenido privado")).toBeInTheDocument();
    expect(hayTokenGuardado()).toBe(true);
  });
});

describe("Cierre de sesión", () => {
  it("el botón Cerrar sesión borra los tokens, avisa y lleva a /login", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    montar("/dashboard");

    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(hayTokenGuardado()).toBe(false);
    expect(screen.getByText("Cerraste sesión.")).toBeInTheDocument();
  });

  it("después de cerrar sesión, volver a una ruta privada no deja entrar", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    montar("/dashboard");

    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(ubicacion()).toBe("/login"));

    cleanup();
    montar("/home"); // simula recargar o escribir la URL a mano
    await waitFor(() => expect(ubicacion()).toBe("/login"));
  });

  it("si otra pestaña cierra sesión, esta también vuelve a /login", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    montar("/dashboard");
    await screen.findByText("contenido privado");

    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
    });

    await waitFor(() => expect(ubicacion()).toBe("/login"));
  });
});
