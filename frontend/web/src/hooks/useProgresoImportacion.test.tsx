// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorDeApi, getImportacion, type Importacion } from "@ojoalgasto/shared";
import { useProgresoImportacion } from "./useProgresoImportacion";

vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getImportacion: vi.fn() };
});
const getMock = vi.mocked(getImportacion);

// La forma de ImportacionSerializer (FE-08).
const BASE: Importacion = {
  id: "imp-1",
  origen: "csv",
  origen_legible: "Archivo CSV o cartola",
  nombre_archivo: "cartola-octubre.csv",
  estado: "pendiente",
  estado_legible: "Pendiente",
  terminada: false,
  progreso: null,
  filas_totales: null,
  filas_procesadas: 0,
  candidatos_detectados: 0,
  candidatos_confirmados: false,
  errores: [],
  errores_totales: 0,
  terminada_en: null,
  confirmada_en: null,
  creado_en: "2026-10-28T20:00:00Z",
};
const procesando = (filas: number): Importacion => ({
  ...BASE,
  estado: "procesando",
  estado_legible: "Procesando",
  filas_totales: 100,
  filas_procesadas: filas,
  progreso: filas,
});
const COMPLETADA: Importacion = {
  ...BASE,
  estado: "completada",
  estado_legible: "Análisis completado",
  terminada: true,
  progreso: 100,
  filas_totales: 100,
  filas_procesadas: 100,
  candidatos_detectados: 4,
};

/** Avanza el reloj falso y deja correr las promesas que eso suelta. */
const pasar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const montar = async (id: string | undefined = "imp-1") => {
  const hook = renderHook(({ id: actual }) => useProgresoImportacion(actual), { initialProps: { id } });
  await pasar(0);
  return hook;
};

function ocultarPestana(oculta: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (oculta ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  getMock.mockReset();
  ocultarPestana(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Polling del progreso (CH-27)", () => {
  it("pregunta hasta el estado terminal y ahí se detiene", async () => {
    getMock
      .mockResolvedValueOnce(BASE)
      .mockResolvedValueOnce(procesando(30))
      .mockResolvedValueOnce(procesando(70))
      .mockResolvedValueOnce(COMPLETADA);
    const { result } = await montar();
    expect(getMock).toHaveBeenCalledWith("imp-1");
    expect(result.current.estado).toMatchObject({ tipo: "listo", importacion: { estado: "pendiente" } });

    await pasar(1000);
    expect(result.current.estado).toMatchObject({ importacion: { filas_procesadas: 30 } });
    await pasar(1000);
    await pasar(1000);
    expect(result.current.estado).toMatchObject({ tipo: "listo", importacion: { estado: "completada" }, problema: null });
    expect(getMock).toHaveBeenCalledTimes(4);

    await pasar(60_000); // terminal: no cambia más, no se pregunta más
    expect(getMock).toHaveBeenCalledTimes(4);
  });

  it("sin avance espera el doble cada vez, hasta 10 s; al avanzar vuelve a 1 s", async () => {
    getMock.mockResolvedValue(procesando(10));
    await montar();
    // 1 (inicial) · +1 s (avanzó: era la primera) · +2 · +4 · +8 · +10 · +10
    for (const [ms, llamadas] of [[1000, 2], [1999, 2], [1, 3], [4000, 4], [8000, 5], [10_000, 6], [10_000, 7]] as const) {
      await pasar(ms);
      expect(getMock).toHaveBeenCalledTimes(llamadas);
    }
    getMock.mockResolvedValue(procesando(20)); // avanzó
    await pasar(10_000);
    expect(getMock).toHaveBeenCalledTimes(8);
    await pasar(1000);
    expect(getMock).toHaveBeenCalledTimes(9);
  });

  it("al desmontar deja de preguntar", async () => {
    getMock.mockResolvedValue(procesando(10));
    const { unmount } = await montar();
    unmount();
    await pasar(60_000);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("con la pestaña oculta no pregunta; al volver pregunta enseguida", async () => {
    getMock.mockResolvedValue(procesando(10));
    await montar();
    ocultarPestana(true);
    await pasar(30_000);
    expect(getMock).toHaveBeenCalledTimes(1);

    getMock.mockResolvedValue(procesando(40));
    await act(async () => ocultarPestana(false));
    await pasar(0);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("si una consulta falla sigue mostrando lo último y reintenta; tras varias seguidas se detiene", async () => {
    getMock.mockResolvedValueOnce(procesando(30)).mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = await montar();

    await pasar(1000);
    expect(result.current.estado).toMatchObject({ tipo: "listo", importacion: { filas_procesadas: 30 }, problema: "reintentando" });
    await pasar(2000);
    await pasar(4000);
    expect(result.current.estado).toMatchObject({ tipo: "listo", problema: "detenido" });
    expect(getMock).toHaveBeenCalledTimes(4);
    await pasar(60_000);
    expect(getMock).toHaveBeenCalledTimes(4);

    // Reintentar a mano vuelve a empezar, sin borrar lo que se veía.
    getMock.mockReset().mockResolvedValue(COMPLETADA);
    act(() => result.current.reintentar());
    expect(result.current.estado).toMatchObject({ tipo: "listo", importacion: { filas_procesadas: 30 }, problema: null });
    await pasar(0);
    expect(result.current.estado).toMatchObject({ importacion: { estado: "completada" } });
  });

  it("si nunca respondió, el error no se muestra como progreso", async () => {
    getMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = await montar();
    await pasar(2000); // sin nada que mostrar, la espera también se duplica: 2 s, 4 s
    await pasar(4000);
    expect(getMock).toHaveBeenCalledTimes(3);
    expect(result.current.estado).toEqual({
      tipo: "error",
      mensaje: "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
    });
  });

  it("un 404 (no existe o es de otra organización) se dice y se deja de preguntar", async () => {
    getMock.mockRejectedValue(new ErrorDeApi("No encontrado.", 404));
    const { result } = await montar();
    expect(result.current.estado).toEqual({ tipo: "no-encontrada" });
    await pasar(60_000);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("al cambiar de id no se mezcla: la consulta vieja se descarta y su polling se corta", async () => {
    let responderVieja: (v: Importacion) => void = () => {};
    getMock.mockImplementation((id: string) =>
      id === "imp-1" ? new Promise((r) => (responderVieja = r)) : Promise.resolve({ ...procesando(10), id: "imp-2" }),
    );
    const { result, rerender } = await montar("imp-1");
    rerender({ id: "imp-2" });
    await pasar(0);
    await act(async () => responderVieja(COMPLETADA)); // llega tarde, de la otra
    expect(result.current.estado).toMatchObject({ importacion: { id: "imp-2", estado: "procesando" } });
    await pasar(1000);
    expect(getMock.mock.calls.filter(([id]) => id === "imp-1")).toHaveLength(1);
  });
});
