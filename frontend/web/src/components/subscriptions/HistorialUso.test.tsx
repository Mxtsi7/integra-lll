// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { etiquetaDelPeriodo, formatearFecha, type RegistroUso } from "@ojoalgasto/shared";
import { HistorialUso, type EstadoHistorial } from "./HistorialUso";

// Historial del mes (S3-CH-18): los mismos registros que manda la API, filtrados por mes en la vista.
// El total del mes no se muestra: el tile de horas de uso ya trae el que calcula el servidor.

// Del más reciente al más antiguo, como los manda el backend.
const USOS: RegistroUso[] = [
  { fecha: "2026-10-31", minutos: 45 },
  { fecha: "2026-10-15", minutos: 90 },
  { fecha: "2026-10-01", minutos: 30 },
  { fecha: "2026-09-30", minutos: 60 },
  { fecha: "2025-10-15", minutos: 20 },
];

const TODO = "Todo el historial";

function renderizar(estado: EstadoHistorial) {
  const onReintentar = vi.fn();
  render(<HistorialUso estado={estado} onReintentar={onReintentar} />);
  return { onReintentar };
}

const listo = (usos: RegistroUso[] = USOS): EstadoHistorial => ({ tipo: "listo", usos });
const selector = () => screen.getByRole("combobox", { name: "Período" });
const filas = () => within(screen.getByRole("list", { name: "Historial de uso" })).getAllByRole("listitem").map((li) => li.textContent);
const opciones = () => within(selector()).getAllByRole("option").map((opcion) => opcion.textContent);

afterEach(() => {
  cleanup();
});

describe("historial de uso por período (S3-CH-18)", () => {
  it("sin período elegido muestra todos los registros en el orden de la API", () => {
    renderizar(listo());

    expect(selector()).toHaveValue("");
    expect(filas()).toEqual([
      `${formatearFecha("2026-10-31")}45 min`,
      `${formatearFecha("2026-10-15")}1 h 30 min`,
      `${formatearFecha("2026-10-01")}30 min`,
      `${formatearFecha("2026-09-30")}1 h`,
      `${formatearFecha("2025-10-15")}20 min`,
    ]);
  });

  it("el selector ofrece solo los meses con registros, del más reciente al más antiguo", () => {
    renderizar(listo());

    expect(opciones()).toEqual([TODO, etiquetaDelPeriodo("2026-10"), etiquetaDelPeriodo("2026-09"), etiquetaDelPeriodo("2025-10")]);
  });

  it("al elegir un mes muestra solo sus registros, con el primer y el último día, y en el mismo orden", () => {
    renderizar(listo());

    fireEvent.change(selector(), { target: { value: "2026-10" } });

    expect(filas()).toEqual([
      `${formatearFecha("2026-10-31")}45 min`,
      `${formatearFecha("2026-10-15")}1 h 30 min`,
      `${formatearFecha("2026-10-01")}30 min`,
    ]);
  });

  it("el mismo mes de otro año no se mezcla con el elegido", () => {
    renderizar(listo());

    fireEvent.change(selector(), { target: { value: "2025-10" } });

    expect(filas()).toEqual([`${formatearFecha("2025-10-15")}20 min`]);
  });

  it("volver a «Todo el historial» muestra todos otra vez", () => {
    renderizar(listo());
    fireEvent.change(selector(), { target: { value: "2026-09" } });
    expect(filas()).toHaveLength(1);

    fireEvent.change(selector(), { target: { value: "" } });

    expect(filas()).toHaveLength(USOS.length);
  });

  it("no muestra un total del mes: el tile de horas de uso ya trae el del servidor", () => {
    renderizar(listo());

    fireEvent.change(selector(), { target: { value: "2026-10" } });

    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
  });

  it("sin registros no hay selector y dice que todavía no hay uso", () => {
    renderizar(listo([]));

    expect(screen.queryByRole("combobox", { name: "Período" })).not.toBeInTheDocument();
    expect(screen.getByText("Todavía no registras uso de esta suscripción.")).toBeInTheDocument();
  });

  it("mientras carga no hay selector", () => {
    renderizar({ tipo: "cargando" });

    expect(screen.queryByRole("combobox", { name: "Período" })).not.toBeInTheDocument();
    expect(screen.getByText("Cargando el historial…")).toBeInTheDocument();
  });

  it("si la lista cambia y el mes elegido ya no tiene registros, vuelve a mostrar todo", () => {
    const { rerender } = render(<HistorialUso estado={listo()} onReintentar={vi.fn()} />);
    fireEvent.change(selector(), { target: { value: "2025-10" } });

    rerender(<HistorialUso estado={listo(USOS.filter((uso) => uso.fecha.startsWith("2026")))} onReintentar={vi.fn()} />);

    expect(selector()).toHaveValue("");
    expect(filas()).toHaveLength(4);
  });
});
