// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCandidatos,
  getImportacion,
  getLecturasDeCorreo,
  getMisImportaciones,
  type Importacion,
  type Paginado,
} from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { candidatoDePrueba, paginaDeCandidatosDePrueba } from "../test/candidatosDePrueba";
import { MENSAJE_SIN_RED } from "../utils/mensajes";
import { ImportacionPage } from "./ImportacionPage";
import { ImportacionesPage } from "./ImportacionesPage";

// Solo se simula la red; las páginas son las reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return {
    ...real,
    getCandidatos: vi.fn(),
    getImportacion: vi.fn(),
    getLecturasDeCorreo: vi.fn(),
    getMisImportaciones: vi.fn(),
  };
});
const candidatosMock = vi.mocked(getCandidatos);
const getMock = vi.mocked(getImportacion);
const lecturasMock = vi.mocked(getLecturasDeCorreo);
const propiasMock = vi.mocked(getMisImportaciones);

/** Una lectura programada de correo, ya terminada y con cobros por revisar. */
const LECTURA: Importacion = {
  id: "lec-1",
  origen: "correo",
  origen_legible: "Lectura de correo",
  nombre_archivo: "",
  cuenta: "cuenta-1",
  estado: "completada",
  estado_legible: "Análisis completado",
  terminada: true,
  progreso: null,
  filas_totales: null,
  filas_procesadas: 12,
  candidatos_detectados: 3,
  candidatos_confirmados: false,
  errores: [],
  errores_totales: 0,
  terminada_en: "2026-11-27T10:05:00Z",
  confirmada_en: null,
  creado_en: "2026-11-27T10:00:00Z",
};
const CARTOLA: Importacion = {
  ...LECTURA,
  id: "imp-1",
  origen: "csv",
  origen_legible: "Archivo CSV o cartola",
  nombre_archivo: "cartola-noviembre.csv",
  cuenta: null,
};

const pagina = (results: Importacion[], next: string | null = null): Paginado<Importacion> => ({
  count: results.length,
  next,
  previous: null,
  results,
});

async function montar() {
  render(
    <MemoryRouter initialEntries={["/importaciones"]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/importaciones" element={<ImportacionesPage />} />
            <Route path="/importaciones/:id" element={<ImportacionPage />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

const lecturas = () => screen.getByRole("region", { name: "Lecturas de correo" });
const cartolas = () => screen.getByRole("region", { name: "Tus cartolas" });
const enlacesDe = (zona: HTMLElement) =>
  within(zona)
    .queryAllByRole("link")
    .filter((enlace) => enlace.getAttribute("href")?.startsWith("/importaciones/"));
const destinosDe = (zona: HTMLElement) => enlacesDe(zona).map((enlace) => enlace.getAttribute("href"));

beforeEach(() => {
  localStorage.clear();
  candidatosMock.mockReset().mockResolvedValue(paginaDeCandidatosDePrueba({ count: 0, results: [] }));
  getMock.mockReset();
  propiasMock.mockReset().mockResolvedValue(pagina([CARTOLA]));
  lecturasMock.mockReset().mockResolvedValue(pagina([LECTURA]));
});

afterEach(() => {
  cleanup();
});

describe("Lecturas de correo en Importaciones (RF-14, CU-13)", () => {
  it("muestra las lecturas programadas aparte de las cartolas, con enlace a cada una", async () => {
    await montar();

    expect(lecturasMock).toHaveBeenCalledWith(1);
    expect(destinosDe(lecturas())).toEqual(["/importaciones/lec-1"]);
    expect(destinosDe(cartolas())).toEqual(["/importaciones/imp-1"]);
    expect(enlacesDe(lecturas())[0]).toHaveTextContent("Lectura de correo");
    expect(enlacesDe(lecturas())[0]).toHaveTextContent("Análisis completado");
  });

  it("desde el listado se abre una lectura y se pueden revisar sus cobros", async () => {
    getMock.mockResolvedValue(LECTURA);
    candidatosMock.mockResolvedValue(
      paginaDeCandidatosDePrueba({ count: 1, results: [candidatoDePrueba({ id: "c-1", servicio: "Spotify", origen: "correo" })] }),
    );
    await montar();

    await act(async () => fireEvent.click(enlacesDe(lecturas())[0]));
    await act(async () => {});

    expect(getMock).toHaveBeenCalledWith("lec-1");
    expect(candidatosMock).toHaveBeenCalledWith(expect.objectContaining({ importacion: "lec-1" }));
    expect(screen.getByRole("checkbox", { name: /^Seleccionar Spotify,/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument();
  });

  it("dice cuántos cobros trae cada lectura terminada, y no promete cobros que la página no muestra", async () => {
    lecturasMock.mockResolvedValue(
      pagina([
        LECTURA,
        { ...LECTURA, id: "lec-2", candidatos_detectados: 1 },
        { ...LECTURA, id: "lec-3", candidatos_detectados: 0 },
        { ...LECTURA, id: "lec-4", estado: "procesando", estado_legible: "Procesando", terminada: false },
        { ...LECTURA, id: "lec-5", estado: "fallida", estado_legible: "Fallida" },
      ]),
    );
    await montar();

    const [tres, uno, ninguno, enCurso, fallida] = enlacesDe(lecturas());
    expect(tres).toHaveTextContent("3 cobros encontrados");
    expect(uno).toHaveTextContent("1 cobro encontrado");
    expect(ninguno).toHaveTextContent("Sin cobros encontrados");
    // La revisión solo se ofrece en las completadas: en las demás no se anuncia ninguna cantidad.
    expect(enCurso).not.toHaveTextContent(/cobros? encontrado/i);
    expect(fallida).not.toHaveTextContent(/cobros? encontrado/i);
  });

  it("sin lecturas lo dice y lleva a conectar una cuenta", async () => {
    lecturasMock.mockResolvedValue(pagina([]));
    await montar();

    expect(within(lecturas()).getByText(/Todavía no hay lecturas de correo/)).toBeInTheDocument();
    expect(within(lecturas()).getByRole("link", { name: "Cuentas conectadas" })).toHaveAttribute("href", "/cuentas");
    expect(destinosDe(cartolas())).toEqual(["/importaciones/imp-1"]);
  });

  it("sin cartolas, las lecturas de correo se ven igual", async () => {
    propiasMock.mockResolvedValue(pagina([]));
    await montar();

    expect(within(cartolas()).getByRole("heading", { name: "Todavía no tienes importaciones" })).toBeInTheDocument();
    expect(destinosDe(lecturas())).toEqual(["/importaciones/lec-1"]);
  });

  it("si las lecturas no cargan, las cartolas se ven y se reintenta solo esa parte", async () => {
    lecturasMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(pagina([LECTURA]));
    await montar();

    expect(within(lecturas()).getByRole("alert")).toHaveTextContent(MENSAJE_SIN_RED);
    expect(destinosDe(cartolas())).toEqual(["/importaciones/imp-1"]);

    await act(async () => fireEvent.click(within(lecturas()).getByRole("button", { name: "Reintentar" })));

    expect(destinosDe(lecturas())).toEqual(["/importaciones/lec-1"]);
    expect(lecturasMock).toHaveBeenCalledTimes(2);
    expect(propiasMock).toHaveBeenCalledTimes(1);
  });

  it("cada parte pagina por su cuenta y no repite lo que ya está", async () => {
    lecturasMock
      .mockReset()
      .mockResolvedValueOnce(pagina([LECTURA], "?page=2"))
      // Entró una lectura nueva: la que ya estaba se corrió a la página 2 y vuelve a llegar.
      .mockResolvedValueOnce(pagina([LECTURA, { ...LECTURA, id: "lec-0" }]));
    propiasMock
      .mockReset()
      .mockResolvedValueOnce(pagina([CARTOLA], "?page=2"))
      .mockResolvedValueOnce(pagina([{ ...CARTOLA, id: "imp-0" }]));
    await montar();

    await act(async () => fireEvent.click(within(lecturas()).getByRole("button", { name: "Ver más lecturas" })));

    expect(lecturasMock).toHaveBeenLastCalledWith(2);
    expect(propiasMock).toHaveBeenCalledTimes(1);
    expect(destinosDe(lecturas())).toEqual(["/importaciones/lec-1", "/importaciones/lec-0"]);
    expect(within(lecturas()).queryByRole("button", { name: "Ver más lecturas" })).not.toBeInTheDocument();

    await act(async () => fireEvent.click(within(cartolas()).getByRole("button", { name: "Ver más" })));

    expect(propiasMock).toHaveBeenLastCalledWith(2);
    expect(lecturasMock).toHaveBeenCalledTimes(2);
    expect(destinosDe(cartolas())).toEqual(["/importaciones/imp-1", "/importaciones/imp-0"]);
  });
});
