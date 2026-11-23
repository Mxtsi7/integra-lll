// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthError,
  getUsuarioActual,
  login,
  loginConGoogle,
  obtenerAccessToken,
  pedirNonceGoogle,
  type Usuario,
} from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import Login from "./Login";

// Entrar con contraseña y con Google a la vez (revisión de #212). Se simula solo
// la red y el script de Google; Login, el contexto de sesión y las rutas son los reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ojoalgasto/shared")>()),
  login: vi.fn(),
  getUsuarioActual: vi.fn(),
  pedirNonceGoogle: vi.fn(),
  loginConGoogle: vi.fn(),
}));

const { google } = vi.hoisted(() => ({
  google: { callback: null as null | ((r: { credential: string }) => void) },
}));
vi.mock("../utils/googleIdentity", () => ({
  cargarGoogleIdentity: async () => ({
    initialize: (config: { callback: (r: { credential: string }) => void }) => {
      google.callback = config.callback;
    },
    renderButton: () => {},
  }),
}));

const loginMock = vi.mocked(login);
const usuarioMock = vi.mocked(getUsuarioActual);
const nonceMock = vi.mocked(pedirNonceGoogle);
const googleMock = vi.mocked(loginConGoogle);

const USUARIO: Usuario = { id: "7", nombre: "Ana", correo: "ana@ejemplo.com", rol: "titular", organizacion_id: "o", plan: "premium" };

function jwt(sub: string): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ sub, exp: Math.floor((Date.now() + 30 * 60_000) / 1000) })}.firma`;
}
const A = { access_token: jwt("A"), refresh_token: "refresh-a", usuario: { id: 7, nombre: "Ana", correo: "ana@ejemplo.com" } };
const B = { access_token: jwt("B"), refresh_token: "refresh-b", usuario: { id: 8, nombre: "Bruno", correo: "bruno@ejemplo.com" } };

function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

const esperar = () => new Promise((resolver) => setTimeout(resolver, 0));

function Ubicacion() {
  return <div data-testid="ubicacion">{useLocation().pathname}</div>;
}

async function montar() {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<div>Panel</div>} />
          </Routes>
          <Ubicacion />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {
    await esperar();
  });
}

/** Envía el formulario de contraseña: queda esperando la respuesta que controla el test. */
async function enviarContrasena() {
  fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "ana@ejemplo.com" } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "Clave123" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await esperar();
  });
}

async function tocarGoogle() {
  await act(async () => {
    google.callback!({ credential: "credencial-google" });
    await esperar();
  });
}

const ubicacion = () => screen.getByTestId("ubicacion").textContent;

beforeEach(() => {
  localStorage.clear();
  google.callback = null;
  loginMock.mockReset();
  googleMock.mockReset();
  usuarioMock.mockReset().mockResolvedValue(USUARIO);
  nonceMock.mockReset().mockResolvedValue({ nonce: "n1", client_id: "cliente", vence_en_segundos: 300 });
});

afterEach(cleanup);

describe("Login: contraseña y Google a la vez", () => {
  it("contraseña A pendiente, Google B entra, llega A: se queda solo la sesión B", async () => {
    const lenta = diferida<typeof A>();
    loginMock.mockReturnValue(lenta.promesa);
    googleMock.mockResolvedValue(B);
    await montar();

    await enviarContrasena();
    await tocarGoogle();
    expect(obtenerAccessToken()).toBe(B.access_token);
    expect(ubicacion()).not.toBe("/login");

    await act(async () => {
      lenta.resolver(A);
      await esperar();
    });

    expect(obtenerAccessToken()).toBe(B.access_token); // A no la pisa
    expect(ubicacion()).not.toBe("/login");
  });

  it("Google B pendiente, la contraseña A entra primero, llega B: se queda solo la sesión A", async () => {
    const lenta = diferida<typeof B>();
    googleMock.mockReturnValue(lenta.promesa);
    loginMock.mockResolvedValue(A);
    await montar();

    await tocarGoogle();
    await enviarContrasena();
    expect(obtenerAccessToken()).toBe(A.access_token);
    expect(ubicacion()).not.toBe("/login");

    await act(async () => {
      lenta.resolver(B);
      await esperar();
    });

    expect(obtenerAccessToken()).toBe(A.access_token);
  });

  it("si la contraseña pendiente falla después de entrar por Google, no avisa un error ni toca la sesión", async () => {
    const lenta = diferida<typeof A>();
    loginMock.mockReturnValue(lenta.promesa);
    googleMock.mockResolvedValue(B);
    await montar();

    await enviarContrasena();
    await tocarGoogle();
    await act(async () => {
      lenta.rechazar(new AuthError("x", 401));
      await esperar();
    });

    expect(screen.queryByText("Usuario o contraseña inválidos")).toBeNull();
    expect(obtenerAccessToken()).toBe(B.access_token);
  });

  it("sin concurrencia, la contraseña sigue entrando como siempre", async () => {
    loginMock.mockResolvedValue(A);
    await montar();
    await enviarContrasena();

    expect(obtenerAccessToken()).toBe(A.access_token);
    expect(ubicacion()).not.toBe("/login");
  });
});
