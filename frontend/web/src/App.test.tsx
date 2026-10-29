// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCobrosDelMes, getRecomendaciones, getUsuarioActual, guardarTokens, type Usuario } from "@ojoalgasto/shared";
import { App } from "./App";

// Prueba el árbol de rutas REAL de App.tsx (RutaPrivada.test.tsx usa una
// copia liviana). Solo se simula la red.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getUsuarioActual: vi.fn(), getCobrosDelMes: vi.fn(), getRecomendaciones: vi.fn() };
});

const USUARIO: Usuario = {
  id: "1",
  nombre: "Christopher",
  correo: "c@test.cl",
  rol: "titular",
  organizacion_id: "org-1",
  plan: "gratuito",
};

function jwtVigente(): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 1800 })}.firma`;
}

function montar(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getUsuarioActual).mockReset();
  vi.mocked(getUsuarioActual).mockResolvedValue(USUARIO);
});

afterEach(() => {
  cleanup();
});

describe("App: rutas de recuperación de contraseña (AN-14) son públicas", () => {
  it("sin sesión, /recuperar-contrasena muestra la página (no manda al login)", () => {
    montar("/recuperar-contrasena");
    expect(screen.getByRole("heading", { name: "Recuperar contraseña" })).toBeInTheDocument();
  });

  it("con sesión, /recuperar-contrasena tampoco redirige al panel", () => {
    guardarTokens({ access_token: jwtVigente(), refresh_token: "refresh" });
    montar("/recuperar-contrasena");
    expect(screen.getByRole("heading", { name: "Recuperar contraseña" })).toBeInTheDocument();
  });

  it("con sesión, el enlace del correo /restablecer-contrasena sigue abriendo", () => {
    guardarTokens({ access_token: jwtVigente(), refresh_token: "refresh" });
    montar("/restablecer-contrasena?token=abc");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/contraseña|enlace/i);
    expect(screen.queryByText("Bienvenido de nuevo")).not.toBeInTheDocument();
  });
});

describe("App: rutas privadas", () => {
  it("sin sesión, /perfil termina en el login", async () => {
    montar("/perfil");
    expect(await screen.findByText("Bienvenido de nuevo")).toBeInTheDocument();
  });
});

describe("App: secciones del menú que ya existen", () => {
    it("con sesión, /cuentas abre Cuentas conectadas y no el 'En construcción' (CH-23)", async () => {
    guardarTokens({ access_token: jwtVigente(), refresh_token: "refresh" });
    montar("/cuentas");
    expect(await screen.findByRole("heading", { name: "Tus cuentas" })).toBeInTheDocument();
    expect(screen.queryByText("En construcción")).not.toBeInTheDocument();
  });

  it("con sesión, /recomendaciones abre la página real y pide VI-17, ya no Próximamente (CH-26)", async () => {
    vi.mocked(getRecomendaciones).mockResolvedValue({ results: [], disponible: true, motivo_sin_sugerencias: null });
    guardarTokens({ access_token: jwtVigente(), refresh_token: "refresh" });
    montar("/recomendaciones");
    expect(await screen.findByText("No tienes recomendaciones por ahora")).toBeInTheDocument();
    expect(screen.queryByText("En construcción")).not.toBeInTheDocument();
    expect(getRecomendaciones).toHaveBeenCalledTimes(1);
  });

  it("con sesión, /calendario abre la cuadrícula del mes (CH-17)", async () => {
    vi.mocked(getCobrosDelMes).mockResolvedValue([]);
    guardarTokens({ access_token: jwtVigente(), refresh_token: "refresh" });
    montar("/calendario");
    expect(await screen.findByRole("grid")).toBeInTheDocument();
    expect(screen.queryByText("En construcción")).not.toBeInTheDocument();
  });

  it("con sesión, /calendario/agenda abre la Agenda (CH-21)", async () => {
    vi.mocked(getCobrosDelMes).mockResolvedValue([]);
    guardarTokens({ access_token: jwtVigente(), refresh_token: "refresh" });
    montar("/calendario/agenda?mes=2026-10");
    expect(await screen.findByText("No hay cobros en octubre de 2026.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agenda" })).toHaveAttribute("aria-current", "page");
  });
});
