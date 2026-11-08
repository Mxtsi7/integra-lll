// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  descartarRecomendacion,
  ErrorDeApi,
  getRecomendaciones,
  getUsuarioActual,
  guardarTokens,
  obtenerAccessToken,
  revocarSesion,
  type ListaRecomendaciones,
  type Recomendacion,
  type RecomendacionDescartada,
  type Usuario,
} from "@ojoalgasto/shared";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { RutaPrivada } from "../components/RutaPrivada";
import { RecomendacionesPage } from "./RecomendacionesPage";

// Revisión de #128: AuthProvider, guarda privada, tokens y página reales;
// solo se simula la red.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return {
    ...real,
    getRecomendaciones: vi.fn(),
    descartarRecomendacion: vi.fn(),
    getUsuarioActual: vi.fn(),
    revocarSesion: vi.fn(),
  };
});
const getRecomendacionesMock = vi.mocked(getRecomendaciones);
const descartarMock = vi.mocked(descartarRecomendacion);
const getUsuarioActualMock = vi.mocked(getUsuarioActual);

const PERSONA_A: Usuario = { id: "7", nombre: "Ana", correo: "ana@ejemplo.com", rol: "titular", organizacion_id: "org-a", plan: "gratuito" };
const PERSONA_B: Usuario = { ...PERSONA_A, id: "8", nombre: "Bruno", correo: "bruno@ejemplo.com", organizacion_id: "org-b" };

const DE_A: Recomendacion = {
  id: "9b2c1d3e-0000-4000-8000-00000000000a",
  nombre: "Servicio privado de A",
  motivo: "Pagas dos planes parecidos.",
  ahorro_estimado: 5000,
  moneda: "CLP",
};
const DE_B: Recomendacion = {
  id: "9b2c1d3e-0000-4000-8000-00000000000b",
  nombre: "Servicio de B",
  motivo: "Tienes un plan anual sin uso.",
  ahorro_estimado: 3000,
  moneda: "CLP",
};
const lista = (results: Recomendacion[]): ListaRecomendaciones => ({
  results,
  total: results.length,
  disponible: true,
  motivo_sin_sugerencias: null,
});
const CONFIRMACION_A: RecomendacionDescartada = { recomendacion_id: DE_A.id, vigente_hasta: "2026-11-28T12:00:00Z", descartado: true };
const AVISO_DESCARTE = "Listo, dejamos de mostrarte esa recomendación.";

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

function IrAOtraPagina() {
  const navegar = useNavigate();
  return <button onClick={() => navegar("/otra")}>Ir a otra página</button>;
}

async function montar() {
  render(
    <MemoryRouter initialEntries={["/recomendaciones"]}>
      <ToastProvider>
        <AuthProvider>
          <PersonaActual />
          <IrAOtraPagina />
          <Routes>
            <Route path="/login" element={<h1>Login</h1>} />
            <Route element={<RutaPrivada />}>
              <Route path="/recomendaciones" element={<RecomendacionesPage />} />
              <Route path="/otra" element={<h1>Otra página</h1>} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

/** Otra pestaña guarda otros tokens: a esta solo le llega el evento `storage`. */
function avisoDeOtraPestana(access: string) {
  guardarTokens({ access_token: access, refresh_token: `refresh-${access.slice(-12)}` });
  window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
}
async function otraPestanaGuarda(access: string) {
  await act(async () => avisoDeOtraPestana(access));
}

const tarjeta = (nombre: string) => screen.queryByRole("heading", { name: nombre, level: 2 });
const noMeInteresa = (nombre: string) =>
  act(async () => fireEvent.click(screen.getByRole("button", { name: `No me interesa: ${nombre}` })));

beforeEach(() => {
  localStorage.clear();
  guardarTokens({ access_token: TOKEN_A, refresh_token: "refresh-a" });
  // /usuarios/me/ y las recomendaciones responden según el token, como el backend.
  getUsuarioActualMock.mockReset().mockImplementation(async () => (obtenerAccessToken() === TOKEN_B ? PERSONA_B : PERSONA_A));
  getRecomendacionesMock.mockReset().mockImplementation(async () => lista(obtenerAccessToken() === TOKEN_B ? [DE_B] : [DE_A]));
  descartarMock.mockReset();
  vi.mocked(revocarSesion).mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe("Recomendaciones al cambiar de sesión (revisión de #128)", () => {
  it("si otra pestaña entra como B, la misma ruta retira lo de A al instante y carga lo de B", async () => {
    const meB = diferida<Usuario>();
    getUsuarioActualMock.mockImplementation(() => (obtenerAccessToken() === TOKEN_B ? meB.promesa : Promise.resolve(PERSONA_A)));
    await montar();
    expect(tarjeta("Servicio privado de A")).toBeInTheDocument();

    await otraPestanaGuarda(TOKEN_B);

    // /usuarios/me/ de B sigue pendiente y el contexto todavía dice A, pero
    // la tarjeta y su botón de A ya no están: la lista es la de B.
    expect(screen.getByTestId("persona")).toHaveTextContent("7");
    expect(tarjeta("Servicio privado de A")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No me interesa: Servicio privado de A" })).not.toBeInTheDocument();
    expect(tarjeta("Servicio de B")).toBeInTheDocument();
    expect(getRecomendacionesMock).toHaveBeenCalledTimes(2);

    await act(async () => meB.resolver(PERSONA_B));
    expect(screen.getByTestId("persona")).toHaveTextContent("8");
    expect(tarjeta("Servicio de B")).toBeInTheDocument();
    expect(tarjeta("Servicio privado de A")).not.toBeInTheDocument();
  });

  it("la lista de A que llega después del cambio no se muestra en B", async () => {
    const listaA = diferida<ListaRecomendaciones>();
    getRecomendacionesMock.mockReturnValueOnce(listaA.promesa);
    await montar();
    expect(screen.getByText("Cargando recomendaciones…")).toBeInTheDocument();

    await otraPestanaGuarda(TOKEN_B);
    expect(tarjeta("Servicio de B")).toBeInTheDocument();

    await act(async () => listaA.resolver(lista([DE_A])));
    expect(tarjeta("Servicio privado de A")).not.toBeInTheDocument();
    expect(tarjeta("Servicio de B")).toBeInTheDocument();
  });

  it("un error de la carga de A que llega tarde no reemplaza la lista de B", async () => {
    const listaA = diferida<ListaRecomendaciones>();
    getRecomendacionesMock.mockReturnValueOnce(listaA.promesa);
    await montar();

    await otraPestanaGuarda(TOKEN_B);
    await act(async () => listaA.rechazar(new TypeError("Failed to fetch")));

    expect(tarjeta("Servicio de B")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("un descarte de A confirmado tarde no avisa, no mueve el foco ni toca la lista de B", async () => {
    const descarteA = diferida<RecomendacionDescartada>();
    descartarMock.mockReturnValue(descarteA.promesa);
    await montar();
    await noMeInteresa("Servicio privado de A");

    await otraPestanaGuarda(TOKEN_B);
    const botonB = screen.getByRole("button", { name: "No me interesa: Servicio de B" });
    botonB.focus();

    await act(async () => descarteA.resolver(CONFIRMACION_A));

    expect(screen.queryByText(AVISO_DESCARTE)).not.toBeInTheDocument();
    expect(tarjeta("Servicio de B")).toBeInTheDocument();
    expect(botonB).toHaveFocus();
    expect(botonB).toBeEnabled();
  });

  it("un descarte de A que se confirma en el mismo instante del cambio, antes de volver a montar, no se anuncia", async () => {
    const descarteA = diferida<RecomendacionDescartada>();
    descartarMock.mockReturnValue(descarteA.promesa);
    await montar();
    await noMeInteresa("Servicio privado de A");

    // El aviso de la otra pestaña y la confirmación llegan juntos: la marca
    // ya cambió, pero la página de A sigue montada hasta el próximo render.
    await act(async () => {
      avisoDeOtraPestana(TOKEN_B);
      descarteA.resolver(CONFIRMACION_A);
    });

    expect(screen.queryByText(AVISO_DESCARTE)).not.toBeInTheDocument();
    expect(tarjeta("Servicio de B")).toBeInTheDocument();
  });

  it("un clic en la tarjeta de A en el mismo instante del cambio no manda el descarte", async () => {
    await montar();
    const botonA = screen.getByRole("button", { name: "No me interesa: Servicio privado de A" });

    await act(async () => {
      avisoDeOtraPestana(TOKEN_B);
      fireEvent.click(botonA);
    });

    expect(descartarMock).not.toHaveBeenCalled();
    expect(tarjeta("Servicio de B")).toBeInTheDocument();
  });

  it("si se sale de la página antes de que se confirme el descarte, no se anuncia", async () => {
    const descarteA = diferida<RecomendacionDescartada>();
    descartarMock.mockReturnValue(descarteA.promesa);
    await montar();
    await noMeInteresa("Servicio privado de A");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ir a otra página" })));
    expect(screen.getByRole("heading", { name: "Otra página" })).toBeInTheDocument();

    await act(async () => descarteA.resolver(CONFIRMACION_A));
    expect(screen.queryByText(AVISO_DESCARTE)).not.toBeInTheDocument();
  });

  it("un error tardío del descarte de A no aparece en la tarjeta de B", async () => {
    const descarteA = diferida<RecomendacionDescartada>();
    descartarMock.mockReturnValue(descarteA.promesa);
    await montar();
    await noMeInteresa("Servicio privado de A");

    await otraPestanaGuarda(TOKEN_B);
    await act(async () => descarteA.rechazar(new ErrorDeApi("No encontrado", 404)));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/ya no está disponible/)).not.toBeInTheDocument();
  });

  it("después de cerrar sesión, el descarte de A que llega tarde no se anuncia", async () => {
    const descarteA = diferida<RecomendacionDescartada>();
    descartarMock.mockReturnValue(descarteA.promesa);
    await montar();
    await noMeInteresa("Servicio privado de A");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" })));
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();

    await act(async () => descarteA.resolver(CONFIRMACION_A));
    expect(screen.queryByText(AVISO_DESCARTE)).not.toBeInTheDocument();
  });

  it("un refresh del token de A en otra pestaña no recarga ni vacía la página", async () => {
    const descarteA = diferida<RecomendacionDescartada>();
    descartarMock.mockReturnValue(descarteA.promesa);
    await montar();
    await noMeInteresa("Servicio privado de A");

    await otraPestanaGuarda(TOKEN_A_RENOVADO);

    // Es la misma sesión: nada se vuelve a pedir y el descarte en curso sigue
    // siendo de esta página, así que se confirma y se avisa como siempre.
    expect(getRecomendacionesMock).toHaveBeenCalledTimes(1);
    expect(getUsuarioActualMock).toHaveBeenCalledTimes(1);
    await act(async () => descarteA.resolver(CONFIRMACION_A));
    expect(screen.getByText(AVISO_DESCARTE)).toBeInTheDocument();
    expect(tarjeta("Servicio privado de A")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Recomendaciones")).toHaveFocus();
  });
});
