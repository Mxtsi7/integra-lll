// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmarCandidato,
  ErrorDeApi,
  getCandidatos,
  getCatalogosSuscripciones,
  getCobrosDelMes,
  getSuscripciones,
  type CandidatoDetectado,
  type CatalogosSuscripciones,
  type CobroCalendario,
  type Suscripcion,
} from "@ojoalgasto/shared";
import { RevisionDeCandidatos } from "../components/candidatos/RevisionDeCandidatos";
import { AuthProvider } from "../context/AuthContext";
import { CatalogosProvider } from "../context/CatalogosContext";
import { ToastProvider } from "../context/ToastContext";
import { candidatoDePrueba, paginaDeCandidatosDePrueba } from "../test/candidatosDePrueba";
import { CalendarioPage } from "./CalendarioPage";
import Homepage from "./Homepage";

// Solo se simula la red. Las vistas, la revisión de cobros y las decisiones son las reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return {
    ...real,
    getCandidatos: vi.fn(),
    confirmarCandidato: vi.fn(),
    getSuscripciones: vi.fn(),
    getCatalogosSuscripciones: vi.fn(),
    getCobrosDelMes: vi.fn(),
  };
});

const SPOTIFY_PENDIENTE = candidatoDePrueba({ id: "c-1", servicio: "Spotify" });
const SPOTIFY_CONFIRMADO: CandidatoDetectado = {
  ...SPOTIFY_PENDIENTE,
  estado: "confirmado",
  estado_legible: "Confirmado",
  decidido_en: "2026-11-24T10:00:00-03:00",
  aplicacion: "pendiente",
};
// Lo que guarda el servidor después de confirmar: la suscripción y su primer cobro.
const SUSCRIPCION_SPOTIFY: Suscripcion = {
  id: "s-1",
  nombre: "Spotify",
  monto: 5900,
  moneda: "CLP",
  frecuencia: "mensual",
  fecha_proximo_cobro: "2026-11-28",
  categoria: "musica",
  estado: "activo",
};
const COBRO_SPOTIFY: CobroCalendario = {
  id: "cb-1",
  suscripcion_id: "s-1",
  fecha: "2026-11-28",
  servicio: "Spotify",
  importe: 5900,
  moneda: "CLP",
  tipo: "confirmado",
};

const opcion = (codigo: string, nombre: string) => ({ codigo, nombre, activo: true, orden: 1 });
const CATALOGO: CatalogosSuscripciones = {
  monedas: [opcion("CLP", "Peso chileno")],
  categorias: [opcion("musica", "Música"), opcion("otro", "Otro")],
  frecuencias: [{ codigo: "mensual", nombre: "Mensual" }],
  predeterminados: { moneda: "CLP", categoria: "otro", frecuencia: "mensual" },
};

/** Navegación dentro de la app, sin recarga completa: los enlaces viven fuera de las vistas. */
function Raiz() {
  return (
    <>
      <nav aria-label="Navegación de prueba">
        <Link to="/importaciones/imp-1">Ir a la importación</Link>
        <Link to="/home">Ir a suscripciones</Link>
        <Link to="/calendario?mes=2026-11">Ir al calendario</Link>
      </nav>
      <Outlet />
    </>
  );
}

/**
 * La revisión de cobros de una importación. La página de importación todavía no la monta
 * (S3-CH-06 la dejó solo lectura hasta que las operaciones reales se acepten), así que la
 * prueba la monta directamente en su ruta.
 */
function RevisionDePrueba() {
  return <RevisionDeCandidatos importacion="imp-1" />;
}

function montar(ruta: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Raiz />,
        children: [
          { path: "home", element: <Homepage /> },
          { path: "calendario", element: <CalendarioPage /> },
          { path: "importaciones/:id", element: <RevisionDePrueba /> },
        ],
      },
    ],
    { initialEntries: [ruta] },
  );
  render(
    <ToastProvider>
      <AuthProvider>
        <CatalogosProvider>
          <RouterProvider router={router} />
        </CatalogosProvider>
      </AuthProvider>
    </ToastProvider>,
  );
}

async function confirmarSpotify() {
  fireEvent.click(await screen.findByRole("checkbox", { name: /^Seleccionar Spotify,/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Confirm(ar|ando)/ }));
}

const enlace = (nombre: string) => screen.getByRole("link", { name: nombre });

beforeEach(() => {
  vi.mocked(getCatalogosSuscripciones).mockReset().mockResolvedValue(structuredClone(CATALOGO));
  vi.mocked(getSuscripciones).mockReset().mockResolvedValue([]);
  vi.mocked(getCobrosDelMes).mockReset().mockResolvedValue([]);
  vi.mocked(getCandidatos).mockReset().mockResolvedValue(paginaDeCandidatosDePrueba({ count: 1, results: [SPOTIFY_PENDIENTE] }));
  vi.mocked(confirmarCandidato).mockReset().mockResolvedValue(SPOTIFY_CONFIRMADO);
});

afterEach(() => {
  cleanup();
});

describe("después de confirmar, las vistas muestran lo que guardó el servidor (S3-CH-10)", () => {
  it("una suscripción confirmada aparece en Suscripciones al volver, sin recargar la app", async () => {
    montar("/home");
    await waitFor(() => expect(getSuscripciones).toHaveBeenCalled());
    expect(screen.queryByText("Spotify")).not.toBeInTheDocument();
    const lecturasAntesDeConfirmar = vi.mocked(getSuscripciones).mock.calls.length;

    fireEvent.click(enlace("Ir a la importación"));
    await confirmarSpotify();
    await screen.findByLabelText("Resultado de la confirmación");

    expect(confirmarCandidato).toHaveBeenCalledWith("c-1");
    // La revisión vuelve a leer la página del servidor después de la tanda.
    expect(getCandidatos).toHaveBeenCalledTimes(2);

    // El servidor ya tiene la suscripción: al volver, Suscripciones la pide de nuevo.
    vi.mocked(getSuscripciones).mockResolvedValue([SUSCRIPCION_SPOTIFY]);
    fireEvent.click(enlace("Ir a suscripciones"));

    expect(await screen.findByText("Spotify")).toBeInTheDocument();
    expect(vi.mocked(getSuscripciones).mock.calls.length).toBeGreaterThan(lecturasAntesDeConfirmar);
    const ordenes = vi.mocked(getSuscripciones).mock.invocationCallOrder;
    expect(ordenes[ordenes.length - 1]).toBeGreaterThan(vi.mocked(confirmarCandidato).mock.invocationCallOrder[0]);
  });

  it("un cobro confirmado aparece en el calendario del mes al volver, sin recargar la app", async () => {
    montar("/calendario?mes=2026-11");
    await waitFor(() => expect(getCobrosDelMes).toHaveBeenCalledWith("2026-11"));
    expect(screen.queryByText("Spotify")).not.toBeInTheDocument();

    fireEvent.click(enlace("Ir a la importación"));
    await confirmarSpotify();
    await screen.findByLabelText("Resultado de la confirmación");

    vi.mocked(getCobrosDelMes).mockResolvedValue([COBRO_SPOTIFY]);
    fireEvent.click(enlace("Ir al calendario"));

    expect((await screen.findAllByText("Spotify")).length).toBeGreaterThan(0);
    expect(getCobrosDelMes).toHaveBeenCalledTimes(2);
  });

  it("si el servidor rechaza la confirmación, no aparece ninguna suscripción ficticia", async () => {
    vi.mocked(confirmarCandidato).mockRejectedValue(new ErrorDeApi("Error del servidor", 500));
    montar("/home");
    await waitFor(() => expect(getSuscripciones).toHaveBeenCalled());
    const lecturasAntesDeConfirmar = vi.mocked(getSuscripciones).mock.calls.length;

    fireEvent.click(enlace("Ir a la importación"));
    await confirmarSpotify();
    const resultado = await screen.findByLabelText("Resultado de la confirmación");
    expect(resultado).toHaveTextContent("No se pudo confirmar. Inténtalo de nuevo.");

    fireEvent.click(enlace("Ir a suscripciones"));
    await waitFor(() => expect(vi.mocked(getSuscripciones).mock.calls.length).toBeGreaterThan(lecturasAntesDeConfirmar));
    expect(screen.queryByText("Spotify")).not.toBeInTheDocument();
  });
});
