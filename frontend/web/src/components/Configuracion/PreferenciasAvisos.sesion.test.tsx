// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPreferenciasAlertas,
  getUsuarioActual,
  guardarPreferenciasAlertas,
  guardarTokens,
  obtenerAccessToken,
  revocarSesion,
  type PreferenciasAlertas,
  type Usuario,
} from "@ojoalgasto/shared";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import { ToastProvider } from "../../context/ToastContext";
import { RutaPrivada } from "../RutaPrivada";
import { PreferenciasAvisos } from "./PreferenciasAvisos";

// Revisión de #129: AuthProvider, guarda privada, router de datos (como
// main.tsx) y tokens reales; solo se simula la red.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return {
    ...real,
    getPreferenciasAlertas: vi.fn(),
    guardarPreferenciasAlertas: vi.fn(),
    getUsuarioActual: vi.fn(),
    revocarSesion: vi.fn(),
  };
});
const getMock = vi.mocked(getPreferenciasAlertas);
const guardarMock = vi.mocked(guardarPreferenciasAlertas);
const getUsuarioActualMock = vi.mocked(getUsuarioActual);

const PERSONA_A: Usuario = { id: "7", nombre: "Ana", correo: "ana@ejemplo.com", rol: "titular", organizacion_id: "org-a", plan: "gratuito" };
const PERSONA_B: Usuario = { ...PERSONA_A, id: "8", nombre: "Bruno", correo: "bruno@ejemplo.com", organizacion_id: "org-b" };

const PREFERENCIAS_A: PreferenciasAlertas = {
  por_email: true,
  por_push: false,
  en_la_app: true,
  avisar_proximo_cobro: true,
  avisar_fin_prueba: true,
  avisar_alza_tarifa: true,
  avisar_doble_cobro: true,
  avisar_presupuesto_excedido: true,
  dias_anticipacion: 3,
  canales_disponibles: ["email", "in_app"],
  canales_elegidos: ["email", "in_app"],
  actualizado_en: "2026-10-20T15:30:00Z",
};
// B tiene otras preferencias: sin correo, con push y otra anticipación.
const PREFERENCIAS_B: PreferenciasAlertas = {
  ...PREFERENCIAS_A,
  por_email: false,
  por_push: true,
  avisar_alza_tarifa: false,
  dias_anticipacion: 7,
  canales_elegidos: ["in_app"],
  actualizado_en: "2026-10-25T09:00:00Z",
};
const AVISO_GUARDADO = "Guardamos tus avisos.";

/** Un JWT con los claims que pone el servicio auth. La firma da igual: el front no la verifica. */
function token(claims: { user_id: number; organizacion_id: string; sid: string; jti: string }): string {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 1800 })}.firma`;
}
const TOKEN_A = token({ user_id: 7, organizacion_id: "org-a", sid: "sesion-a", jti: "a-1" });
// El refresh de A: otro token, misma cuenta y misma sesión.
const TOKEN_A_RENOVADO = token({ user_id: 7, organizacion_id: "org-a", sid: "sesion-a", jti: "a-2" });
const TOKEN_B = token({ user_id: 8, organizacion_id: "org-b", sid: "sesion-b", jti: "b-1" });

/** Promesa que el test resuelve o rechaza cuando quiere. */
function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function PersonaActual() {
  return <div data-testid="persona">{useAuth().usuario?.id ?? "nadie"}</div>;
}

function Salir() {
  const { cerrarSesion } = useAuth();
  return <button onClick={() => void cerrarSesion()}>Salir</button>;
}

async function montar() {
  // Como App.tsx: los proveedores dentro del router de datos y Configuración
  // bajo <RutaPrivada>.
  const router = createMemoryRouter(
    [
      {
        element: (
          <ToastProvider>
            <AuthProvider>
              <PersonaActual />
              <Salir />
              <Outlet />
            </AuthProvider>
          </ToastProvider>
        ),
        children: [
          { path: "/login", element: <h1>Login</h1> },
          {
            element: <RutaPrivada />,
            children: [
              {
                path: "/configuracion",
                element: (
                  <>
                    <Link to="/home">Ir a Inicio</Link>
                    <PreferenciasAvisos />
                  </>
                ),
              },
              { path: "/home", element: <h1>Inicio</h1> },
            ],
          },
        ],
      },
    ],
    { initialEntries: ["/configuracion"] },
  );
  render(<RouterProvider router={router} />);
  await act(async () => {});
  return router;
}

/** Otra pestaña guarda otros tokens: a esta solo le llega el evento `storage`. */
function avisoDeOtraPestana(access: string) {
  guardarTokens({ access_token: access, refresh_token: `refresh-${access.slice(-12)}` });
  window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
}
async function otraPestanaGuarda(access: string) {
  await act(async () => avisoDeOtraPestana(access));
}

const interruptor = (nombre: string) => screen.getByRole("switch", { name: nombre });
const alternar = (nombre: string) => fireEvent.click(interruptor(nombre));
const botonGuardar = () => screen.getByRole("button", { name: "Guardar cambios" });
const guardar = () => act(async () => fireEvent.click(botonGuardar()));
// El aviso de guardado también es role="status": se busca el del pie de la sección.
const estado = () => screen.getAllByRole("status").find((e) => e.tagName === "P")!;

/** Los valores propios de B, como los devolvió su GET. */
function seVenLasDeB() {
  expect(interruptor("Por correo")).toHaveAttribute("aria-checked", "false");
  expect(interruptor("Notificaciones push")).toHaveAttribute("aria-checked", "true");
  expect(interruptor("Alza de tarifa")).toHaveAttribute("aria-checked", "false");
  expect(screen.getByText("7 días antes del cobro.")).toBeInTheDocument();
  expect(estado()).toHaveTextContent("Guardado");
  expect(botonGuardar()).toBeDisabled();
}

beforeEach(() => {
  localStorage.clear();
  guardarTokens({ access_token: TOKEN_A, refresh_token: "refresh-a" });
  // /usuarios/me/ y las preferencias responden según el token, como el backend.
  getUsuarioActualMock.mockReset().mockImplementation(async () => (obtenerAccessToken() === TOKEN_B ? PERSONA_B : PERSONA_A));
  getMock.mockReset().mockImplementation(async () => (obtenerAccessToken() === TOKEN_B ? PREFERENCIAS_B : PREFERENCIAS_A));
  guardarMock.mockReset();
  vi.mocked(revocarSesion).mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe("Avisos al cambiar de sesión (revisión de #129)", () => {
  it("si otra pestaña entra como B, el borrador de A se descarta y se ven las preferencias de B", async () => {
    const meB = diferida<Usuario>();
    getUsuarioActualMock.mockImplementation(() => (obtenerAccessToken() === TOKEN_B ? meB.promesa : Promise.resolve(PERSONA_A)));
    await montar();
    alternar("Por correo");
    expect(estado()).toHaveTextContent("Tienes cambios sin guardar.");

    await otraPestanaGuarda(TOKEN_B);

    // /usuarios/me/ de B sigue pendiente y el contexto todavía dice A, pero
    // el formulario ya es el de B, sin el borrador de A.
    expect(screen.getByTestId("persona")).toHaveTextContent("7");
    seVenLasDeB();
    await guardar();
    expect(guardarMock).not.toHaveBeenCalled();

    await act(async () => meB.resolver(PERSONA_B));
    seVenLasDeB();
  });

  it("un clic en Guardar en el mismo instante del cambio no manda el borrador de A con el token de B", async () => {
    await montar();
    alternar("Por correo");
    const guardarDeA = botonGuardar();

    await act(async () => {
      avisoDeOtraPestana(TOKEN_B);
      fireEvent.click(guardarDeA);
    });

    expect(guardarMock).not.toHaveBeenCalled();
    seVenLasDeB();
  });

  it("las preferencias de A que llegan después del cambio no se muestran en B", async () => {
    const getA = diferida<PreferenciasAlertas>();
    getMock.mockReturnValueOnce(getA.promesa);
    await montar();
    expect(screen.getByText("Cargando tus avisos…")).toBeInTheDocument();

    await otraPestanaGuarda(TOKEN_B);
    seVenLasDeB();

    await act(async () => getA.resolver(PREFERENCIAS_A));
    seVenLasDeB();
  });

  it("un guardado de A confirmado después del cambio no avisa ni reemplaza las de B", async () => {
    const patchA = diferida<PreferenciasAlertas>();
    guardarMock.mockReturnValue(patchA.promesa);
    await montar();
    alternar("Por correo");
    await guardar();
    expect(guardarMock).toHaveBeenCalledWith({ por_email: false });

    await otraPestanaGuarda(TOKEN_B);
    await act(async () => patchA.resolver({ ...PREFERENCIAS_A, por_email: false, actualizado_en: "2026-10-29T12:00:00Z" }));

    expect(screen.queryByText(AVISO_GUARDADO)).not.toBeInTheDocument();
    seVenLasDeB();
  });

  it("con la navegación retenida, un guardado de A confirmado en el mismo instante del cambio no la sigue ni avisa", async () => {
    const patchA = diferida<PreferenciasAlertas>();
    guardarMock.mockReturnValue(patchA.promesa);
    const router = await montar();
    alternar("Por correo");
    await act(async () => fireEvent.click(screen.getByRole("link", { name: "Ir a Inicio" })));
    expect(router.state.location.pathname).toBe("/configuracion");
    expect(screen.getByText("Tienes cambios sin guardar. Si sales ahora, se pierden.")).toBeInTheDocument();
    await guardar();

    // El aviso de la otra pestaña y la confirmación llegan juntos: la marca
    // ya cambió, pero el formulario de A sigue montado hasta el próximo render.
    await act(async () => {
      avisoDeOtraPestana(TOKEN_B);
      patchA.resolver({ ...PREFERENCIAS_A, por_email: false });
    });

    expect(router.state.location.pathname).toBe("/configuracion");
    expect(screen.queryByRole("heading", { name: "Inicio" })).not.toBeInTheDocument();
    expect(screen.queryByText(AVISO_GUARDADO)).not.toBeInTheDocument();
    seVenLasDeB();
  });

  it("al cerrar sesión y entrar B, el guardado de A que llega tarde no avisa ni toca lo de B", async () => {
    const patchA = diferida<PreferenciasAlertas>();
    guardarMock.mockReturnValue(patchA.promesa);
    const router = await montar();
    alternar("Por correo");
    await guardar();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salir" })));
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();

    await otraPestanaGuarda(TOKEN_B);
    await act(async () => router.navigate("/configuracion"));
    seVenLasDeB();

    await act(async () => patchA.resolver({ ...PREFERENCIAS_A, por_email: false }));
    expect(screen.queryByText(AVISO_GUARDADO)).not.toBeInTheDocument();
    seVenLasDeB();
  });

  it("si se sale de la página mientras guarda, la confirmación no avisa", async () => {
    const patchA = diferida<PreferenciasAlertas>();
    guardarMock.mockReturnValue(patchA.promesa);
    const router = await montar();
    alternar("Por correo");
    await guardar();

    // Con el guardado en vuelo, salir pasa por "Descartar cambios".
    await act(async () => fireEvent.click(screen.getByRole("link", { name: "Ir a Inicio" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" })));
    expect(router.state.location.pathname).toBe("/home");

    await act(async () => patchA.resolver({ ...PREFERENCIAS_A, por_email: false }));
    expect(screen.queryByText(AVISO_GUARDADO)).not.toBeInTheDocument();
  });

  it("si el guardado falla en la misma sesión, el borrador se queda y se puede reintentar", async () => {
    guardarMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ...PREFERENCIAS_A, por_email: false, actualizado_en: "2026-10-29T12:00:00Z" });
    await montar();
    alternar("Por correo");

    await guardar();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
    expect(interruptor("Por correo")).toHaveAttribute("aria-checked", "false");
    expect(estado()).toHaveTextContent("Tienes cambios sin guardar.");

    await guardar();
    expect(guardarMock).toHaveBeenLastCalledWith({ por_email: false });
    expect(screen.getByText(AVISO_GUARDADO)).toBeInTheDocument();
    expect(estado()).toHaveTextContent("Guardado");
  });

  it("un refresh del token de A durante el guardado no lo invalida", async () => {
    const patchA = diferida<PreferenciasAlertas>();
    guardarMock.mockReturnValue(patchA.promesa);
    await montar();
    alternar("Por correo");
    await guardar();

    await otraPestanaGuarda(TOKEN_A_RENOVADO);
    // Es la misma sesión: nada se vuelve a pedir y el guardado sigue siendo de este formulario.
    expect(getMock).toHaveBeenCalledTimes(1);
    await act(async () => patchA.resolver({ ...PREFERENCIAS_A, por_email: false, actualizado_en: "2026-10-29T12:00:00Z" }));

    expect(screen.getByText(AVISO_GUARDADO)).toBeInTheDocument();
    expect(interruptor("Por correo")).toHaveAttribute("aria-checked", "false");
    expect(estado()).toHaveTextContent("Guardado");
  });
});
