// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorDeApi,
  getImportacion,
  getMisImportaciones,
  getUsuarioActual,
  guardarTokens,
  obtenerAccessToken,
  type Importacion,
  type Paginado,
  type Usuario,
} from "@ojoalgasto/shared";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { RutaPrivada } from "../components/RutaPrivada";
import { ImportacionPage } from "./ImportacionPage";
import { ImportacionesPage } from "./ImportacionesPage";

// Revisión de #130: AuthProvider, guarda privada y tokens reales; solo se
// simula la red.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getImportacion: vi.fn(), getMisImportaciones: vi.fn(), getUsuarioActual: vi.fn() };
});
const getMock = vi.mocked(getImportacion);
const listarMock = vi.mocked(getMisImportaciones);
const getUsuarioActualMock = vi.mocked(getUsuarioActual);

const PERSONA_A: Usuario = { id: "7", nombre: "Ana", correo: "ana@ejemplo.com", rol: "titular", organizacion_id: "org-a", plan: "gratuito" };
const PERSONA_B: Usuario = { ...PERSONA_A, id: "8", nombre: "Bruno", correo: "bruno@ejemplo.com", organizacion_id: "org-b" };

const BASE: Importacion = {
  id: "imp-a",
  origen: "csv",
  origen_legible: "Archivo CSV o cartola",
  nombre_archivo: "Cartola privada de A.csv",
  estado: "procesando",
  estado_legible: "Procesando",
  terminada: false,
  progreso: 40,
  filas_totales: 250,
  filas_procesadas: 100,
  candidatos_detectados: 0,
  candidatos_confirmados: false,
  errores: [],
  errores_totales: 0,
  terminada_en: null,
  confirmada_en: null,
  creado_en: "2026-10-28T20:00:00Z",
};
// Terminal: el polling ya se detuvo, no llega otra consulta que dé 404.
const COMPLETADA_A: Importacion = {
  ...BASE,
  estado: "completada",
  estado_legible: "Análisis completado",
  terminada: true,
  progreso: 100,
  filas_procesadas: 250,
  candidatos_detectados: 4,
  errores: [{ codigo: "monto_invalido", mensaje: "Monto ilegible en el cobro de A", fila: 12 }],
  errores_totales: 1,
  terminada_en: "2026-10-28T20:05:00Z",
};
const ANTIGUA_A: Importacion = { ...COMPLETADA_A, id: "imp-a-vieja", nombre_archivo: "Cartola antigua de A.csv", creado_en: "2026-09-01T10:00:00Z" };
const DE_B: Importacion = { ...COMPLETADA_A, id: "imp-b", nombre_archivo: "Cartola de B.csv", candidatos_detectados: 1, errores: [], errores_totales: 0 };

const pagina = (results: Importacion[], next: string | null = null): Paginado<Importacion> => ({
  count: results.length,
  next,
  previous: null,
  results,
});

/** Un JWT con los claims que pone el servicio auth. La firma da igual: el front no la verifica. */
function token(claims: { user_id: number; organizacion_id: string; sid: string; jti: string }): string {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 1800 })}.firma`;
}
const TOKEN_A = token({ user_id: 7, organizacion_id: "org-a", sid: "sesion-a", jti: "a-1" });
// El refresh de A: otro token, misma cuenta y misma sesión.
const TOKEN_A_RENOVADO = token({ user_id: 7, organizacion_id: "org-a", sid: "sesion-a", jti: "a-2" });
const TOKEN_B = token({ user_id: 8, organizacion_id: "org-b", sid: "sesion-b", jti: "b-1" });
const deB = () => obtenerAccessToken() === TOKEN_B;

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

async function montar(ruta: string) {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <ToastProvider>
        <AuthProvider>
          <PersonaActual />
          <Routes>
            <Route path="/login" element={<h1>Login</h1>} />
            <Route element={<RutaPrivada />}>
              <Route path="/importaciones" element={<ImportacionesPage />} />
              <Route path="/importaciones/:id" element={<ImportacionPage />} />
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

/** Nada de A a la vista: ni el archivo, ni los candidatos, ni sus errores. */
function nadaDeA() {
  expect(screen.queryByText(/Cartola privada de A/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Cartola antigua de A/)).not.toBeInTheDocument();
  expect(screen.queryByText(/4 cobros posibles/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Monto ilegible en el cobro de A/)).not.toBeInTheDocument();
}

/** Con qué token salió cada consulta del detalle. */
let consultasDetalle: string[] = [];

beforeEach(() => {
  localStorage.clear();
  guardarTokens({ access_token: TOKEN_A, refresh_token: "refresh-a" });
  consultasDetalle = [];
  // /usuarios/me/ e importaciones responden según el token, como el backend:
  // para B, la importación de A es de otra organización (404).
  getUsuarioActualMock.mockReset().mockImplementation(async () => (deB() ? PERSONA_B : PERSONA_A));
  getMock.mockReset().mockImplementation(async () => {
    consultasDetalle.push(obtenerAccessToken() === TOKEN_B ? "B" : "A");
    if (deB()) throw new ErrorDeApi("No encontrado.", 404);
    return COMPLETADA_A;
  });
  listarMock.mockReset().mockImplementation(async (n = 1) => {
    if (deB()) return pagina([DE_B]);
    return n === 1 ? pagina([COMPLETADA_A], "http://api/importaciones/?mias=true&page=2") : pagina([ANTIGUA_A]);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Detalle de importación al cambiar de sesión (revisión de #130)", () => {
  it("con una importación terminal de A, al entrar B se retira al instante y se consulta con B", async () => {
    const meB = diferida<Usuario>();
    getUsuarioActualMock.mockImplementation(() => (deB() ? meB.promesa : Promise.resolve(PERSONA_A)));
    await montar("/importaciones/imp-a");
    expect(screen.getByRole("heading", { name: "Cartola privada de A.csv" })).toBeInTheDocument();
    expect(screen.getByText(/4 cobros posibles/)).toBeInTheDocument();
    expect(consultasDetalle).toEqual(["A"]);

    await otraPestanaGuarda(TOKEN_B);

    // /usuarios/me/ de B sigue pendiente, pero el detalle ya empezó de cero
    // con la misma ruta y el mismo id: se preguntó con B y no la encuentra.
    expect(screen.getByTestId("persona")).toHaveTextContent("7");
    nadaDeA();
    expect(consultasDetalle).toEqual(["A", "B"]);
    expect(screen.getByText(/No encontramos esta importación/)).toBeInTheDocument();

    await act(async () => meB.resolver(PERSONA_B));
    nadaDeA();
  });

  it("con la consulta de A pendiente, su respuesta tardía no se muestra en B", async () => {
    const getA = diferida<Importacion>();
    getMock.mockImplementationOnce(() => {
      consultasDetalle.push("A");
      return getA.promesa;
    });
    await montar("/importaciones/imp-a");
    expect(screen.getByText("Consultando la importación…")).toBeInTheDocument();

    await otraPestanaGuarda(TOKEN_B);
    expect(screen.getByText(/No encontramos esta importación/)).toBeInTheDocument();

    await act(async () => getA.resolver({ ...BASE, filas_procesadas: 180, progreso: 72 }));
    nadaDeA();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText(/No encontramos esta importación/)).toBeInTheDocument();
  });

  it("en procesamiento, un temporizador de A que vence en el mismo instante del cambio no consulta con el token de B", async () => {
    vi.useFakeTimers();
    getMock.mockImplementation(async () => {
      consultasDetalle.push(deB() ? "B" : "A");
      if (deB()) throw new ErrorDeApi("No encontrado.", 404);
      return BASE;
    });
    await montar("/importaciones/imp-a");
    expect(screen.getByRole("progressbar", { name: "Avance de la importación" })).toBeInTheDocument();
    expect(consultasDetalle).toEqual(["A"]);

    // El aviso de la otra pestaña y el próximo turno del polling llegan juntos:
    // la marca ya cambió, pero el detalle de A sigue montado hasta el próximo render.
    await act(async () => {
      avisoDeOtraPestana(TOKEN_B);
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Solo la consulta del detalle nuevo salió con B; la de A no se hizo.
    expect(consultasDetalle).toEqual(["A", "B"]);
    nadaDeA();
    expect(screen.getByText(/No encontramos esta importación/)).toBeInTheDocument();

    // Y el polling de A no sigue: con el tiempo no sale nada más.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(consultasDetalle).toEqual(["A", "B"]);
  });

  it("un refresh del token de A durante el polling no reinicia el detalle", async () => {
    vi.useFakeTimers();
    getMock.mockImplementation(async () => {
      consultasDetalle.push("A");
      return BASE;
    });
    await montar("/importaciones/imp-a");

    await otraPestanaGuarda(TOKEN_A_RENOVADO);
    // Es la misma sesión: el detalle no vuelve a "Consultando" ni pregunta antes de tiempo.
    expect(screen.getByRole("heading", { name: "Cartola privada de A.csv" })).toBeInTheDocument();
    expect(consultasDetalle).toEqual(["A"]);

    // El polling sigue con su ritmo, ya con el token renovado.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(consultasDetalle).toEqual(["A", "A"]);
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});

describe("Listado de importaciones al cambiar de sesión (revisión de #130)", () => {
  it("al entrar B se reinician las filas y la paginación", async () => {
    await montar("/importaciones");
    expect(screen.getByText("Cartola privada de A.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver más" })).toBeInTheDocument();

    await otraPestanaGuarda(TOKEN_B);

    nadaDeA();
    expect(screen.getByText("Cartola de B.csv")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  });

  it("la segunda página de A que llega después del cambio no se agrega a la lista de B", async () => {
    const pagina2 = diferida<Paginado<Importacion>>();
    await montar("/importaciones");
    listarMock.mockImplementationOnce(() => pagina2.promesa);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ver más" })));

    await otraPestanaGuarda(TOKEN_B);
    await act(async () => pagina2.resolver(pagina([ANTIGUA_A])));

    nadaDeA();
    expect(screen.getByText("Cartola de B.csv")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("un error tardío de la segunda página de A no aparece en B", async () => {
    const pagina2 = diferida<Paginado<Importacion>>();
    await montar("/importaciones");
    listarMock.mockImplementationOnce(() => pagina2.promesa);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ver más" })));

    await otraPestanaGuarda(TOKEN_B);
    await act(async () => pagina2.rechazar(new TypeError("Failed to fetch")));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Cartola de B.csv")).toBeInTheDocument();
  });

  it("un clic en Ver más en el mismo instante del cambio no pide la página siguiente con el token de B", async () => {
    await montar("/importaciones");
    const verMas = screen.getByRole("button", { name: "Ver más" });
    const conB: number[] = [];
    listarMock.mockImplementation(async (n = 1) => {
      if (deB()) {
        conB.push(n);
        return pagina([DE_B]);
      }
      return pagina([ANTIGUA_A]);
    });

    await act(async () => {
      avisoDeOtraPestana(TOKEN_B);
      fireEvent.click(verMas);
    });

    // Con B solo se pidió la primera página, la del listado nuevo.
    expect(conB).toEqual([1]);
    nadaDeA();
    expect(screen.getByText("Cartola de B.csv")).toBeInTheDocument();
  });
});
