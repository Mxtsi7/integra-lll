// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumenDelPeriodo } from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { InformesPage } from "./InformesPage";

// "Hoy" fijo: solo se falsea Date, para que los temporizadores sigan funcionando.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 9, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const CONTEO = { activo: 2, prueba: 0, por_confirmar: 1, cancelado: 1, fantasma: 0, total: 4 };

// Datos solo de prueba: la página nunca los inventa, los recibe de `cargarResumen`.
function resumen(cambios: Partial<ResumenDelPeriodo> = {}): ResumenDelPeriodo {
  return {
    periodo: "2026-11",
    conteo: CONTEO,
    gastos: [
      { moneda: "CLP", gastoReal: 25000, gastoProyectado: 12990, totalEstimado: 37990 },
      { moneda: "USD", gastoReal: 10.5, gastoProyectado: 0, totalEstimado: 10.5 },
    ],
    ...cambios,
  };
}

async function montar(cargarResumen: (mes: string) => Promise<ResumenDelPeriodo>, direccion = "/informes") {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[direccion]}>
        <ToastProvider>
          <AuthProvider>
            <InformesPage cargarResumen={cargarResumen} />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  await act(async () => {});
}

const titulo = () => screen.getByRole("heading", { level: 2, name: /de 20\d\d$/ });

describe("Informes web por periodo (AN-22)", () => {
  it("muestra cada moneda en su fila, sin sumarlas, y la cantidad por estado", async () => {
    await montar(vi.fn().mockResolvedValue(resumen()));

    const tabla = screen.getByRole("table");
    const filaClp = within(tabla).getByRole("row", { name: /CLP/ });
    expect(filaClp).toHaveTextContent("$25.000");
    expect(filaClp).toHaveTextContent("$12.990");
    expect(filaClp).toHaveTextContent("$37.990");
    const filaUsd = within(tabla).getByRole("row", { name: /USD/ });
    expect(filaUsd).toHaveTextContent("10,50");
    expect(filaClp).not.toHaveTextContent("10,50");

    const conteo = screen.getByRole("list", { name: "Suscripciones por estado" });
    expect(within(conteo).getByText("Activas").previousSibling).toHaveTextContent("2");
    expect(screen.getByRole("heading", { name: "Suscripciones: 4" })).toBeInTheDocument();
  });

  it("incluye el resumen en texto con el periodo y la moneda de cada importe", async () => {
    await montar(vi.fn().mockResolvedValue(resumen()));
    expect(screen.getByText(/Resumen de Noviembre de 2026\. En CLP: gastado \$25\.000/)).toBeInTheDocument();
  });

  it("sin mes en la dirección pide el mes de hoy", async () => {
    const cargar = vi.fn().mockResolvedValue(resumen());
    await montar(cargar);
    expect(cargar).toHaveBeenCalledWith("2026-11");
    expect(titulo()).toHaveTextContent("Noviembre de 2026");
  });

  it("el mes de la dirección (?mes=) es el que se pide", async () => {
    const cargar = vi.fn().mockResolvedValue(resumen({ periodo: "2026-10" }));
    await montar(cargar, "/informes?mes=2026-10");
    expect(cargar).toHaveBeenCalledWith("2026-10");
    expect(titulo()).toHaveTextContent("Octubre de 2026");
  });

  it("un mes mal escrito en la dirección no se manda: se usa el de hoy", async () => {
    const cargar = vi.fn().mockResolvedValue(resumen());
    await montar(cargar, "/informes?mes=2026-13");
    expect(cargar).toHaveBeenCalledTimes(2); // StrictMode monta dos veces
    expect(cargar).not.toHaveBeenCalledWith("2026-13");
    expect(cargar).toHaveBeenCalledWith("2026-11");
  });

  it("Mes anterior pide el mes anterior y no deja las cifras del mes viejo mientras carga", async () => {
    let responderOctubre: (valor: ResumenDelPeriodo) => void = () => {};
    const cargar = vi.fn().mockImplementation((mes: string) =>
      mes === "2026-10" ? new Promise<ResumenDelPeriodo>((resolver) => (responderOctubre = resolver)) : Promise.resolve(resumen()),
    );
    await montar(cargar);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    });

    expect(titulo()).toHaveTextContent("Octubre de 2026");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Cargando el resumen del periodo" })).toBeInTheDocument();
    await act(async () => responderOctubre(resumen({ periodo: "2026-10" })));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("una respuesta que llega tarde de un mes que ya se dejó no pisa al mes actual", async () => {
    let responderNoviembre: (valor: ResumenDelPeriodo) => void = () => {};
    const cargar = vi.fn().mockImplementation((mes: string) =>
      mes === "2026-11"
        ? new Promise<ResumenDelPeriodo>((resolver) => (responderNoviembre = resolver))
        : Promise.resolve(
            resumen({ periodo: mes, gastos: [{ moneda: "CLP", gastoReal: 111, gastoProyectado: 0, totalEstimado: 111 }] }),
          ),
    );
    await montar(cargar);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    });
    await act(async () => responderNoviembre(resumen()));

    expect(titulo()).toHaveTextContent("Octubre de 2026");
    expect(screen.getByRole("table")).toHaveTextContent("$111");
    expect(screen.getByRole("table")).not.toHaveTextContent("$25.000");
  });

  it("no se puede avanzar más allá del mes actual, pero sí volver a él con «Este mes»", async () => {
    await montar(vi.fn().mockImplementation(async (mes: string) => resumen({ periodo: mes })), "/informes?mes=2026-09");
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Este mes" }));
    });

    expect(titulo()).toHaveTextContent("Noviembre de 2026");
    expect(screen.getByRole("button", { name: "Mes siguiente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Este mes" })).toBeDisabled();
  });

  it("omite la moneda sin movimiento", async () => {
    const solo = resumen({ gastos: [resumen().gastos[0], { moneda: "USD", gastoReal: 0, gastoProyectado: 0, totalEstimado: 0 }] });
    await montar(vi.fn().mockResolvedValue(solo));
    expect(within(screen.getByRole("table")).queryByRole("row", { name: /USD/ })).not.toBeInTheDocument();
  });

  it("un periodo sin gastos lo dice y no produce NaN", async () => {
    const vacio = resumen({
      conteo: { activo: 0, prueba: 0, por_confirmar: 0, cancelado: 0, fantasma: 0, total: 0 },
      gastos: [{ moneda: "CLP", gastoReal: 0, gastoProyectado: 0, totalEstimado: 0 }],
    });
    await montar(vi.fn().mockResolvedValue(vacio));

    expect(screen.getAllByText(/Sin gastos registrados ni proyectados/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it("si falla avisa y Reintentar vuelve a pedir", async () => {
    let falla = true;
    const cargar = vi.fn(async () => {
      if (falla) throw new Error("500");
      return resumen();
    });
    await montar(cargar);

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el resumen de este periodo.");
    falla = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("sin conexión lo dice distinto de un error del servidor", async () => {
    await montar(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
  });
});
