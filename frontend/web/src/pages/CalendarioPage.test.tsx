// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorDeApi, getSuscripciones, type Suscripcion } from "@ojoalgasto/shared";
import { CuadriculaMes } from "../components/calendario/CuadriculaMes";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { CalendarioPage } from "./CalendarioPage";

// Solo se simula la red; la regla de qué genera cobro es la real de shared.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getSuscripciones: vi.fn() };
});
const getSuscripcionesMock = vi.mocked(getSuscripciones);

// Zona de Chile (UTC-3/-4) aunque CI corra en UTC: así un new Date("YYYY-MM-DD")
// (medianoche UTC = el día anterior acá) hace fallar los tests de fechas.
beforeAll(() => {
  vi.stubEnv("TZ", "America/Santiago");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

function sus(extra: Partial<Suscripcion>): Suscripcion {
  return {
    id: "s",
    nombre: "Servicio",
    monto: 5990,
    moneda: "CLP",
    frecuencia: "mensual",
    fecha_proximo_cobro: "2026-10-25",
    categoria: "streaming",
    estado: "activo",
    ...extra,
  };
}

const SUSCRIPCIONES: Suscripcion[] = [
  sus({ id: "1", nombre: "Netflix", fecha_proximo_cobro: "2026-10-25" }),
  sus({ id: "2", nombre: "Gimnasio", estado: "fantasma", fecha_proximo_cobro: "2026-10-25" }),
  sus({ id: "3", nombre: "Duolingo", estado: "prueba", fin_prueba: "2026-10-27", fecha_proximo_cobro: "2026-10-28" }),
  sus({ id: "4", nombre: "Cancelada", estado: "cancelado", fecha_proximo_cobro: "2026-10-26" }),
  sus({ id: "5", nombre: "Dudosa", estado: "por_confirmar", fecha_proximo_cobro: "2026-10-27" }),
  sus({ id: "6", nombre: "De noviembre", fecha_proximo_cobro: "2026-11-05" }),
  sus({ id: "7", nombre: "Del día 1", fecha_proximo_cobro: "2026-10-01" }),
];

async function montar() {
  render(
    <StrictMode>
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <CalendarioPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  await act(async () => {});
}

const cuadricula = () => screen.getByRole("grid", { name: "octubre de 2026" });
const dia = (nombre: string | RegExp) => within(cuadricula()).getByRole("button", { name: nombre });
/** El resumen del día elegido (se anuncia con aria-live). */
const resumen = () => document.querySelector("[aria-live='polite']:not(.toast-region)");

beforeEach(() => {
  // Solo se congela la fecha: las promesas y los timers siguen normales.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 21, 10, 0));
  getSuscripcionesMock.mockReset().mockResolvedValue(SUSCRIPCIONES);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Calendario (CH-17)", () => {
  it("mientras carga muestra el indicador, no una cuadrícula vacía", async () => {
    getSuscripcionesMock.mockReturnValue(new Promise(() => {}));
    await montar();

    expect(screen.getByRole("status", { name: "Cargando tus cobros" })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("dibuja el mes actual con hoy marcado y elegido", async () => {
    await montar();

    expect(screen.getByRole("heading", { name: "Octubre de 2026" })).toBeInTheDocument();
    expect(within(cuadricula()).getAllByRole("button")).toHaveLength(31);
    const hoy = dia(/^miércoles, 21 de octubre de 2026/);
    expect(hoy).toHaveAttribute("aria-current", "date");
    expect(hoy.closest("td")).toHaveAttribute("aria-selected", "true");
    expect(resumen()).toHaveTextContent("Miércoles, 21 de octubre de 2026 · Sin cobros");
  });

  it("marca los cobros reales en su día, con la misma regla que el Panel", async () => {
    await montar();

    // Netflix (activa) + Gimnasio (fantasma): las dos se cobran.
    expect(dia("domingo, 25 de octubre de 2026, 2 cobros")).toBeInTheDocument();
    // La prueba con monto y fecha de término también.
    expect(dia("miércoles, 28 de octubre de 2026, 1 cobro")).toBeInTheDocument();
    // Cancelada y por confirmar no tienen un cobro seguro.
    expect(dia("lunes, 26 de octubre de 2026, sin cobros")).toBeInTheDocument();
    expect(dia("martes, 27 de octubre de 2026, sin cobros")).toBeInTheDocument();
    // El día 1 no se corre al 30 de septiembre por la zona horaria.
    expect(dia("jueves, 1 de octubre de 2026, 1 cobro")).toBeInTheDocument();
    // Lo de noviembre no aparece en octubre.
    expect(within(cuadricula()).queryByRole("button", { name: /noviembre/ })).not.toBeInTheDocument();
  });

  it("elegir un día lo marca y dice cuántos cobros tiene", async () => {
    await montar();
    fireEvent.click(dia(/^domingo, 25 de octubre/));

    expect(dia(/^domingo, 25 de octubre/).closest("td")).toHaveAttribute("aria-selected", "true");
    expect(dia(/^miércoles, 21 de octubre/).closest("td")).toHaveAttribute("aria-selected", "false");
    expect(resumen()).toHaveTextContent("Domingo, 25 de octubre de 2026 · 2 cobros");
  });

  it("un mes sin cobros lo dice, y la cuadrícula sigue para elegir días", async () => {
    getSuscripcionesMock.mockResolvedValue([sus({ fecha_proximo_cobro: "2026-11-05" })]);
    await montar();

    expect(screen.getByText("No hay cobros este mes.")).toBeInTheDocument();
    expect(cuadricula()).toBeInTheDocument();
  });

  it("si falla, avisa y Reintentar vuelve a pedir", async () => {
    let falla = true;
    getSuscripcionesMock.mockImplementation(async () => {
      if (falla) throw new ErrorDeApi("Error interno", 500);
      return SUSCRIPCIONES;
    });
    await montar();

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus cobros.");
    falla = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    });
    expect(dia("domingo, 25 de octubre de 2026, 2 cobros")).toBeInTheDocument();
  });

  it("sin conexión lo dice distinto", async () => {
    getSuscripcionesMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await montar();

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
  });
});

describe("Cuadrícula: teclado (CH-17)", () => {
  const tabulables = () => within(cuadricula()).getAllByRole("button").filter((b) => b.tabIndex === 0);
  // Dentro de act: enfocar un día cambia cuál recibe Tab (estado de React).
  const enfocar = (boton: HTMLElement) => act(() => boton.focus());

  it("solo un día recibe Tab, y las flechas recorren días y semanas", async () => {
    await montar();
    const hoy = dia(/^miércoles, 21 de octubre/);
    expect(tabulables()).toEqual([hoy]);

    enfocar(hoy);
    fireEvent.keyDown(hoy, { key: "ArrowRight" });
    expect(dia(/^jueves, 22 de octubre/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(dia(/^jueves, 29 de octubre/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(dia(/^miércoles, 28 de octubre/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(dia(/^miércoles, 21 de octubre/)).toHaveFocus();
    expect(tabulables()).toHaveLength(1);
  });

  it("Inicio y Fin van al primer y último día de la semana dentro del mes", async () => {
    await montar();
    const hoy = dia(/^miércoles, 21 de octubre/);
    enfocar(hoy);
    fireEvent.keyDown(hoy, { key: "Home" });
    expect(dia(/^lunes, 19 de octubre/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(dia(/^domingo, 25 de octubre/)).toHaveFocus();

    // Primera semana: parte el jueves 1, no el lunes de septiembre.
    enfocar(dia(/^sábado, 3 de octubre/));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(dia(/^jueves, 1 de octubre/)).toHaveFocus();
  });

  it("en el borde del mes no se sale (cruzar de mes es de CH-19)", async () => {
    await montar();
    const primero = dia(/^jueves, 1 de octubre/);
    enfocar(primero);
    fireEvent.keyDown(primero, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(primero).toHaveFocus();
    // Y Tab sigue llevando al 1, no salta a otro día.
    expect(tabulables()).toEqual([primero]);
  });
});

describe("Cuadrícula: meses de distinto largo (CH-17)", () => {
  function dibujar(anio: number, mes: number) {
    render(
      <CuadriculaMes anio={anio} mes={mes} hoy="2026-10-21" seleccionado={null} onSeleccionar={() => {}} eventos={[]} />,
    );
    return within(screen.getByRole("grid")).getAllByRole("button");
  }

  it.each([
    [2026, 1, 28, "febrero de 2026"],
    [2028, 1, 29, "febrero de 2028"],
    [2026, 3, 30, "abril de 2026"],
    [2026, 11, 31, "diciembre de 2026"],
  ])("%i-%i dibuja %i días (%s)", (anio, mes, cantidad, nombre) => {
    const dias = dibujar(anio, mes);
    expect(dias).toHaveLength(cantidad);
    expect(screen.getByRole("grid")).toHaveAccessibleName(nombre);
    // Sin hoy ni elegido en ese mes, el día 1 es el que recibe Tab.
    expect(dias.filter((b) => b.tabIndex === 0)).toEqual([dias[0]]);
  });

  it("los encabezados van de lunes a domingo, con el nombre completo para el lector", () => {
    dibujar(2026, 9);
    const encabezados = screen.getAllByRole("columnheader");
    expect(encabezados.map((th) => th.getAttribute("abbr"))).toEqual([
      "lunes",
      "martes",
      "miércoles",
      "jueves",
      "viernes",
      "sábado",
      "domingo",
    ]);
  });
});
