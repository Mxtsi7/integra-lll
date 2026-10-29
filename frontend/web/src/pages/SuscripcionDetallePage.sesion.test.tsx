// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelarSuscripcion,
  ErrorDeApi,
  getSuscripcion,
  getUsos,
  getUsuarioActual,
  guardarTokens,
  obtenerAccessToken,
  registrarUso,
  revocarSesion,
  type RegistroUso,
  type Suscripcion,
  type Usuario,
} from "@ojoalgasto/shared";
import { ToastProvider } from "../context/ToastContext";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { RutaPrivada } from "../components/RutaPrivada";
import { SuscripcionDetallePage } from "./SuscripcionDetallePage";

// Tokens, sesión, rutas privadas y componentes reales; solo se simula la red.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return {
    ...real,
    getSuscripcion: vi.fn(),
    getUsos: vi.fn(),
    registrarUso: vi.fn(),
    cancelarSuscripcion: vi.fn(),
    getUsuarioActual: vi.fn(),
    revocarSesion: vi.fn(),
  };
});
const getSuscripcionMock = vi.mocked(getSuscripcion);
const getUsosMock = vi.mocked(getUsos);
const registrarUsoMock = vi.mocked(registrarUso);
const cancelarSuscripcionMock = vi.mocked(cancelarSuscripcion);

const SPOTIFY: Suscripcion = {
  id: "a",
  nombre: "Spotify",
  monto: 5990,
  moneda: "CLP",
  frecuencia: "mensual",
  fecha_proximo_cobro: "2026-11-10",
  categoria: "musica",
  estado: "activo",
};

const USOS_A: RegistroUso[] = [
  { fecha: "2026-10-18", minutos: 45 },
  { fecha: "2026-10-12", minutos: 90 },
  { fecha: "2026-10-03", minutos: 30 },
];

const minutos = () => screen.getByLabelText("Minutos de uso") as HTMLInputElement;
const registrar = () => act(async () => fireEvent.click(screen.getByRole("button", { name: /Registrar uso|Registrando/ })));

beforeEach(() => {
  localStorage.clear();
  getSuscripcionMock.mockReset();
  getUsosMock.mockReset();
  registrarUsoMock.mockReset();
  cancelarSuscripcionMock.mockReset();
});

afterEach(() => {
  cleanup();
});

const PERSONA_A: Usuario = { id: "7", nombre: "Ana", correo: "ana@ejemplo.com", rol: "titular", organizacion_id: "org-a", plan: "gratuito" };
const PERSONA_B: Usuario = { ...PERSONA_A, id: "8", nombre: "Bruno", correo: "bruno@ejemplo.com", organizacion_id: "org-b" };
function tokenRevision(sub: string) {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.firma`;
}
function PersonaActual() { return <div data-testid="persona">{useAuth().usuario?.id ?? "nadie"}</div>; }
async function montarProtegida() {
  render(
    <MemoryRouter initialEntries={["/suscripciones/a"]}>
      <ToastProvider>
        <AuthProvider>
          <PersonaActual />
          <Routes>
            <Route path="/login" element={<h1>Login</h1>} />
            <Route element={<RutaPrivada />}>
              <Route path="/suscripciones/:id" element={<SuscripcionDetallePage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}
function diferidaSesion<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => { resolver = res; rechazar = rej; });
  return { promesa, resolver, rechazar };
}
const empezarCancelacionSesion = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Cancelar suscripción" }));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar suscripción" })));
};
describe("Revision #112 aislamiento de respuestas por sesion", () => {
  let tokenA: string;
  let tokenB: string;
  beforeEach(() => {
    tokenA = tokenRevision("7"); tokenB = tokenRevision("8");
    guardarTokens({ access_token: tokenA, refresh_token: "refresh-a" });
    vi.mocked(getUsuarioActual).mockReset().mockImplementation(async () => obtenerAccessToken() === tokenB ? PERSONA_B : PERSONA_A);
    vi.mocked(revocarSesion).mockReset().mockResolvedValue(true);
    // La cuenta B pertenece a otra organización: la URL de A responde 404.
    getSuscripcionMock.mockImplementation(async () => {
      if (obtenerAccessToken() === tokenB) throw new ErrorDeApi("No encontrado", 404);
      return SPOTIFY;
    });
    getUsosMock.mockImplementation(async () => {
      if (obtenerAccessToken() === tokenB) throw new ErrorDeApi("No encontrado", 404);
      return USOS_A;
    });
  });
  it("despues de salir no anuncia como propia una cancelacion de la sesion anterior", async () => {
    const cancelacion = diferidaSesion<Suscripcion>();
    cancelarSuscripcionMock.mockReturnValue(cancelacion.promesa);
    await montarProtegida(); await empezarCancelacionSesion();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" })));
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
    await act(async () => cancelacion.resolver({ ...SPOTIFY, estado: "cancelado" }));
    expect(screen.queryByText("Cancelaste Spotify. Ya no contamos sus próximos cobros.")).not.toBeInTheDocument();
  });
  it("si otra pestana entra como B no muestra en B la respuesta de cancelacion de A", async () => {
    const cancelacion = diferidaSesion<Suscripcion>();
    cancelarSuscripcionMock.mockReturnValue(cancelacion.promesa);
    await montarProtegida(); await empezarCancelacionSesion();
    guardarTokens({ access_token: tokenB, refresh_token: "refresh-b" });
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "access_token" })));
    expect(screen.getByTestId("persona")).toHaveTextContent("8");
    expect(obtenerAccessToken()).toBe(tokenB);
    await act(async () => cancelacion.resolver({ ...SPOTIFY, estado: "cancelado" }));
    expect(screen.queryByText("Cancelada")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancelaste Spotify. Ya no contamos sus próximos cobros.")).not.toBeInTheDocument();
  });
  it("un error tardio de A no se presenta dentro de la sesion B", async () => {
    const cancelacion = diferidaSesion<Suscripcion>();
    cancelarSuscripcionMock.mockReturnValue(cancelacion.promesa);
    await montarProtegida(); await empezarCancelacionSesion();
    guardarTokens({ access_token: tokenB, refresh_token: "refresh-b" });
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "access_token" })));
    expect(screen.getByTestId("persona")).toHaveTextContent("8");
    await act(async () => cancelacion.rechazar(new ErrorDeApi("No encontrado", 404)));
    expect(screen.queryByText("Esta suscripción ya no existe. Puede que la hayan eliminado.")).not.toBeInTheDocument();
  });
  it("una respuesta de uso pendiente de A no actualiza horas al cambiar a B", async () => {
    const uso = diferidaSesion<Suscripcion>();
    registrarUsoMock.mockReturnValue(uso.promesa);
    await montarProtegida();
    fireEvent.change(minutos(), { target: { value: "45" } });
    await registrar();
    guardarTokens({ access_token: tokenB, refresh_token: "refresh-b" });
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "access_token" })));
    expect(screen.getByTestId("persona")).toHaveTextContent("8");
    await act(async () => uso.resolver({ ...SPOTIFY, horas_uso_mes: 0.75 }));
    expect(screen.queryByText("0,75 h")).not.toBeInTheDocument();
  });
  it("una carga de detalle pendiente de A no muestra el detalle dentro de B", async () => {
    const detalle = diferidaSesion<Suscripcion>();
    getSuscripcionMock.mockReturnValueOnce(detalle.promesa);
    await montarProtegida();
    guardarTokens({ access_token: tokenB, refresh_token: "refresh-b" });
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "access_token" })));
    expect(screen.getByTestId("persona")).toHaveTextContent("8");
    await act(async () => detalle.resolver(SPOTIFY));
    expect(screen.queryByRole("heading", { name: "Spotify", level: 1 })).not.toBeInTheDocument();
  });
  it("un historial pendiente de A no se presenta en la sesion B", async () => {
    const usos = diferidaSesion<RegistroUso[]>();
    getUsosMock.mockReturnValueOnce(usos.promesa);
    await montarProtegida();
    guardarTokens({ access_token: tokenB, refresh_token: "refresh-b" });
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "access_token" })));
    expect(screen.getByTestId("persona")).toHaveTextContent("8");
    await act(async () => usos.resolver([{ fecha: "2026-10-18", minutos: 45 }]));
    expect(screen.queryByRole("list", { name: "Historial de uso" })).not.toBeInTheDocument();
  });
  it("descarta cancelar antes de que /me de B termine, sin comparar solo el usuario", async () => {
    const meB = diferidaSesion<Usuario>();
    const cancelacion = diferidaSesion<Suscripcion>();
    vi.mocked(getUsuarioActual).mockImplementation(() => obtenerAccessToken() === tokenB ? meB.promesa : Promise.resolve(PERSONA_A));
    cancelarSuscripcionMock.mockReturnValue(cancelacion.promesa);
    await montarProtegida(); await empezarCancelacionSesion();
    guardarTokens({ access_token: tokenB, refresh_token: "refresh-b" });
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "access_token" })));
    // El contexto todavía muestra A, pero la marca de sesión ya cambió.
    expect(screen.getByTestId("persona")).toHaveTextContent("7");
    await act(async () => cancelacion.resolver({ ...SPOTIFY, estado: "cancelado" }));
    expect(screen.queryByText("Cancelaste Spotify. Ya no contamos sus próximos cobros.")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancelada")).not.toBeInTheDocument();
    await act(async () => meB.resolver(PERSONA_B));
    expect(screen.getByTestId("persona")).toHaveTextContent("8");
    expect(screen.getByText(/No encontramos esa suscripción/)).toBeInTheDocument();
  });
  it.each(["exito", "error"])("el formulario no anuncia %s del uso de A mientras /me de B está pendiente", async (resultado) => {
    const meB = diferidaSesion<Usuario>();
    const uso = diferidaSesion<Suscripcion>();
    vi.mocked(getUsuarioActual).mockImplementation(() => obtenerAccessToken() === tokenB ? meB.promesa : Promise.resolve(PERSONA_A));
    registrarUsoMock.mockReturnValue(uso.promesa);
    await montarProtegida();
    fireEvent.change(minutos(), { target: { value: "45" } });
    await registrar();
    guardarTokens({ access_token: tokenB, refresh_token: "refresh-b" });
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "access_token" })));
    await act(async () => {
      if (resultado === "exito") uso.resolver({ ...SPOTIFY, horas_uso_mes: 0.75 });
      else uso.rechazar(new TypeError("Failed to fetch"));
    });
    expect(screen.queryByText(/Registraste 45 minutos/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No pudimos conectar con el servidor/)).not.toBeInTheDocument();
    expect(screen.queryByText("0,75 h")).not.toBeInTheDocument();
    await act(async () => meB.resolver(PERSONA_B));
    expect(screen.getByText(/No encontramos esa suscripción/)).toBeInTheDocument();
  });
});
