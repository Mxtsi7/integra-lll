// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorDeApi,
  getImportacion,
  getMisImportaciones,
  type Importacion,
  type Paginado,
} from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { ImportacionPage } from "./ImportacionPage";
import { ImportacionesPage } from "./ImportacionesPage";

// Solo se simula la red; las páginas y el polling son reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getImportacion: vi.fn(), getMisImportaciones: vi.fn() };
});
const getMock = vi.mocked(getImportacion);
const listarMock = vi.mocked(getMisImportaciones);

const BASE: Importacion = {
  id: "imp-1",
  origen: "csv",
  origen_legible: "Archivo CSV o cartola",
  nombre_archivo: "cartola-octubre.csv",
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
const COMPLETADA: Importacion = {
  ...BASE,
  estado: "completada",
  estado_legible: "Análisis completado",
  terminada: true,
  progreso: 100,
  filas_procesadas: 250,
  candidatos_detectados: 4,
  terminada_en: "2026-10-28T20:05:00Z",
};

async function montar(ruta = "/importaciones/imp-1") {
  render(
    <MemoryRouter initialEntries={[ruta]}>
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

const barra = () => screen.getByRole("progressbar", { name: "Avance de la importación" });

beforeEach(() => {
  localStorage.clear();
  getMock.mockReset();
  listarMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Progreso de una importación (CH-27)", () => {
  it("procesando con total conocido: barra con porcentaje y filas", async () => {
    getMock.mockResolvedValue(BASE);
    await montar();
    expect(screen.getByRole("heading", { name: "cartola-octubre.csv" })).toBeInTheDocument();
    expect(screen.getByText("Procesando")).toBeInTheDocument();
    expect(screen.getByText("Leyendo el archivo…")).toBeInTheDocument();
    expect(barra()).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("100 de 250 filas (40 %)")).toBeInTheDocument();
  });

  it("sin total conocido la barra no inventa un avance (null no es 0)", async () => {
    getMock.mockResolvedValue({ ...BASE, origen: "correo", origen_legible: "Lectura de correo", nombre_archivo: "", progreso: null, filas_totales: null, filas_procesadas: 12 });
    await montar();
    expect(barra()).not.toHaveAttribute("aria-valuenow");
    // En el correo, cada fila de FE-08 es un mensaje.
    expect(barra()).toHaveAttribute("aria-valuetext", "Todavía no sabemos cuántos mensajes son.");
    expect(screen.getByText("Leyendo tus correos…")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lectura de correo" })).toBeInTheDocument();
  });

  it("un archivo sin total todavía habla de filas; un correo con total, de mensajes", async () => {
    getMock.mockResolvedValueOnce({ ...BASE, progreso: null, filas_totales: null });
    await montar();
    expect(barra()).toHaveAttribute("aria-valuetext", "Todavía no sabemos cuántas filas son.");
    cleanup();

    getMock.mockResolvedValueOnce({ ...BASE, origen: "correo", origen_legible: "Lectura de correo", filas_totales: 80, filas_procesadas: 20, progreso: 25 });
    await montar();
    expect(screen.getByText("20 de 80 mensajes (25 %)")).toBeInTheDocument();
  });

  it("pendiente dice que está en cola", async () => {
    getMock.mockResolvedValue({ ...BASE, estado: "pendiente", estado_legible: "Pendiente", progreso: null, filas_totales: null, filas_procesadas: 0 });
    await montar();
    expect(screen.getByText("En cola: empieza en unos momentos.")).toBeInTheDocument();
  });

  it("completada no afirma que se importó: hay candidatos sin confirmar y no se tocó ninguna suscripción", async () => {
    getMock.mockResolvedValue(COMPLETADA);
    await montar();
    expect(screen.getByText("Análisis completado")).toBeInTheDocument();
    expect(screen.getByText(/Encontramos 4 cobros posibles/)).toBeInTheDocument();
    expect(screen.getByText(/Todavía no se creó ni cambió ninguna suscripción/)).toBeInTheDocument();
    expect(screen.queryByText(/import(ó|aron|ada con éxito)|exitos/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // La previsualización (FE-10) todavía no existe: el paso se ve, pero no lleva a ninguna parte.
    expect(screen.getByRole("button", { name: "Revisar cobros encontrados" })).toBeDisabled();
  });

  it("completada y confirmada lo dice; sin candidatos, también", async () => {
    getMock.mockResolvedValueOnce({ ...COMPLETADA, candidatos_confirmados: true, confirmada_en: "2026-10-28T21:00:00Z" });
    await montar();
    expect(screen.getByText(/Confirmaste estos cobros el/)).toBeInTheDocument();
    cleanup();

    getMock.mockResolvedValueOnce({ ...COMPLETADA, candidatos_detectados: 0 });
    await montar();
    expect(screen.getByText("No encontramos cobros que parezcan suscripciones.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revisar cobros encontrados" })).not.toBeInTheDocument();
  });

  it("fallida muestra los errores por fila y cuántos más hubo", async () => {
    getMock.mockResolvedValue({
      ...BASE,
      estado: "fallida",
      estado_legible: "Fallida",
      terminada: true,
      progreso: 100,
      errores: [
        { codigo: "fecha_invalida", mensaje: "La fecha no tiene el formato AAAA-MM-DD.", fila: 3 },
        { codigo: "monto_invalido", mensaje: "El monto no es un número.", fila: 8 },
        { codigo: "archivo", mensaje: "El archivo se cortó antes de terminar.", fila: null },
      ],
      errores_totales: 45,
    });
    await montar();
    expect(screen.getByText(/La importación no se pudo terminar/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "45 problemas" })).toBeInTheDocument();
    const filas = within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent);
    expect(filas).toEqual([
      "Fila 3La fecha no tiene el formato AAAA-MM-DD.",
      "Fila 8El monto no es un número.",
      "El archivo se cortó antes de terminar.",
    ]);
    expect(screen.getByText("Y 42 más.")).toBeInTheDocument();
  });

  it("una completada con errores también los muestra", async () => {
    getMock.mockResolvedValue({ ...COMPLETADA, errores: [{ codigo: "x", mensaje: "Fila vacía.", fila: 12 }], errores_totales: 1 });
    await montar();
    expect(screen.getByRole("heading", { name: "1 problema" })).toBeInTheDocument();
    expect(screen.queryByText(/más\./)).not.toBeInTheDocument();
  });

  it("de otra organización o inexistente: no encontrada", async () => {
    getMock.mockRejectedValue(new ErrorDeApi("No encontrado.", 404));
    await montar();
    expect(screen.getByText("No encontramos esta importación. Revisa que el enlace esté completo.")).toBeInTheDocument();
  });

  it("se actualiza sola y deja de preguntar al terminar", async () => {
    vi.useFakeTimers();
    getMock.mockResolvedValueOnce(BASE).mockResolvedValueOnce({ ...BASE, filas_procesadas: 200, progreso: 80 }).mockResolvedValue(COMPLETADA);
    await montar();
    expect(barra()).toHaveAttribute("aria-valuenow", "40");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(barra()).toHaveAttribute("aria-valuenow", "80");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText("Análisis completado")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getMock).toHaveBeenCalledTimes(3);
  });

  it("si deja de responder, avisa que puede estar desactualizado y permite reintentar", async () => {
    vi.useFakeTimers();
    getMock.mockResolvedValueOnce(BASE).mockRejectedValue(new TypeError("Failed to fetch"));
    await montar();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText("No pudimos consultar el avance. Seguimos intentando…")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(screen.getByRole("alert")).toHaveTextContent("puede estar desactualizado");
    expect(barra()).toHaveAttribute("aria-valuenow", "40"); // lo último sigue a la vista

    getMock.mockReset().mockResolvedValue(COMPLETADA);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reintentar" })));
    expect(screen.getByText("Análisis completado")).toBeInTheDocument();
  });
});

describe("Tus importaciones (CH-27)", () => {
  const pagina = (results: Importacion[], next: string | null = null): Paginado<Importacion> => ({ count: results.length, next, previous: null, results });

  it("lista las propias con su estado y lleva al progreso de cada una", async () => {
    listarMock.mockResolvedValue(pagina([BASE, { ...COMPLETADA, id: "imp-0", nombre_archivo: "septiembre.csv" }]));
    await montar("/importaciones");
    expect(listarMock).toHaveBeenCalledWith(1);
    const enlaces = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/importaciones/"));
    expect(enlaces.map((a) => a.getAttribute("href"))).toEqual(["/importaciones/imp-1", "/importaciones/imp-0"]);
    expect(enlaces[0]).toHaveTextContent("cartola-octubre.csv");
    expect(enlaces[0]).toHaveTextContent("Procesando");
    expect(enlaces[1]).toHaveTextContent("Análisis completado");
  });

  it("sin importaciones muestra el estado vacío; con error, reintentar", async () => {
    listarMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(pagina([]));
    await montar("/importaciones");
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reintentar" })));
    expect(screen.getByRole("heading", { name: "Todavía no tienes importaciones" })).toBeInTheDocument();
  });

  it("Ver más pide la página siguiente sin repetir las que ya están", async () => {
    const primeras = Array.from({ length: 10 }, (_, i) => ({ ...BASE, id: `imp-${i}`, nombre_archivo: `a${i}.csv` }));
    listarMock
      .mockResolvedValueOnce(pagina(primeras, "?page=2"))
      // Entró una nueva: la 9 se corrió a la página 2 y vuelve a llegar.
      .mockResolvedValueOnce(pagina([primeras[9], { ...BASE, id: "imp-10", nombre_archivo: "a10.csv" }]));
    await montar("/importaciones");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ver más" })));

    expect(listarMock).toHaveBeenLastCalledWith(2);
    const enlaces = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/importaciones/"));
    expect(enlaces).toHaveLength(11);
    expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  });
});
