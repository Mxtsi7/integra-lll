// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorDeApi, getCobrosDelMes, type CobroCalendario } from "@ojoalgasto/shared";
import { CuadriculaMes } from "../components/calendario/CuadriculaMes";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { AgendaPage } from "./AgendaPage";
import { CalendarioPage } from "./CalendarioPage";

// Solo se simula la red (VI-07); fechas, totales y formatos son los reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getCobrosDelMes: vi.fn() };
});
const getCobrosMock = vi.mocked(getCobrosDelMes);

// Zona de Chile (UTC-3/-4) aunque CI corra en UTC: así un new Date("YYYY-MM-DD")
// (medianoche UTC = el día anterior acá) hace fallar los tests de fechas.
beforeAll(() => {
  vi.stubEnv("TZ", "America/Santiago");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

/** Un cobro con la forma de CalendarioCobroSerializer (ya con importe numérico). */
function cobro(id: string, fecha: string, servicio: string, importe: number, extra: Partial<CobroCalendario> = {}): CobroCalendario {
  return { id, suscripcion_id: `sus-${id}`, fecha, servicio, importe, moneda: "CLP", tipo: "proyectado", ...extra };
}

const OCTUBRE: CobroCalendario[] = [
  cobro("c1", "2026-10-01", "iCloud", 990, { tipo: "confirmado" }),
  cobro("c5", "2026-10-27", "Gimnasio", 25000, { tipo: "confirmado" }),
  cobro("c2", "2026-10-24", "Netflix", 9990),
  cobro("c3", "2026-10-24", "Spotify", 5990),
  cobro("c4", "2026-10-24", "ChatGPT", 20, { moneda: "USD" }),
  cobro("c7", "2026-10-21", "Disney+", 7990),
];
// (Desordenado a propósito: la Agenda tiene que ordenar por fecha igual.)
const NOVIEMBRE: CobroCalendario[] = [cobro("c6", "2026-11-05", "Netflix", 9990)];
const POR_MES: Record<string, CobroCalendario[]> = { "2026-10": OCTUBRE, "2026-11": NOVIEMBRE };

/** Promesa que el test resuelve cuando quiere. */
function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => (resolver = r));
  return { promesa, resolver };
}

function Ubicacion() {
  const { pathname, search } = useLocation();
  return <div data-testid="ubicacion">{`${pathname}${search}`}</div>;
}

async function montar(ruta = "/calendario") {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[ruta]}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/calendario" element={<CalendarioPage />} />
              <Route path="/calendario/agenda" element={<AgendaPage />} />
            </Routes>
            <Ubicacion />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  await act(async () => {});
}

const ubicacion = () => screen.getByTestId("ubicacion").textContent;
const cuadricula = (mes = "octubre de 2026") => screen.getByRole("grid", { name: mes });
const dia = (nombre: string | RegExp, mes?: string) => within(cuadricula(mes)).getByRole("button", { name: nombre });
const detalle = () => screen.getByRole("region", { name: /de 20\d\d$/ });
const pulsar = async (nombre: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: nombre }));
  });
};
const enfocar = (boton: HTMLElement) => act(() => boton.focus());
const teclear = async (tecla: string) => {
  await act(async () => {
    fireEvent.keyDown(document.activeElement!, { key: tecla });
  });
};

beforeEach(() => {
  // Solo se congela la fecha: las promesas y los timers siguen normales.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 21, 10, 0));
  getCobrosMock.mockReset().mockImplementation(async (mes) => POR_MES[mes] ?? []);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Calendario: cobros en su día (CH-18)", () => {
  it("pide el mes actual a VI-07 y pone cada cobro en su día", async () => {
    await montar();

    expect(getCobrosMock).toHaveBeenCalledWith("2026-10");
    expect(screen.getByRole("heading", { name: "Octubre de 2026" })).toBeInTheDocument();
    expect(within(cuadricula()).getAllByRole("button")).toHaveLength(31);
    // El día 1 no se corre al 30 de septiembre por la zona horaria.
    expect(dia("jueves, 1 de octubre de 2026, 1 cobro: iCloud, $990, confirmado")).toBeInTheDocument();
    expect(dia("lunes, 26 de octubre de 2026, sin cobros")).toBeInTheDocument();
  });

  it("varios cobros el mismo día: se escuchan todos aunque en pantalla quepan dos", async () => {
    await montar();

    const sabado = dia(/^sábado, 24 de octubre de 2026, 3 cobros: /);
    expect(sabado).toHaveAccessibleName(
      /Netflix, \$9\.990, previsto; Spotify, \$5\.990, previsto; ChatGPT, US\$20,00, previsto$/,
    );
    expect(sabado).toHaveTextContent("Netflix");
    expect(sabado).toHaveTextContent("Spotify");
    expect(sabado).not.toHaveTextContent("ChatGPT");
    expect(sabado).toHaveTextContent("+1 más");
  });

  it("mientras carga, la cuadrícula se ve pero los días no dicen 'sin cobros' (todavía no se sabe)", async () => {
    getCobrosMock.mockReturnValue(new Promise(() => {}));
    await montar();

    expect(screen.getByRole("status", { name: "Cargando tus cobros" })).toBeInTheDocument();
    expect(cuadricula()).toHaveAttribute("aria-busy", "true");
    expect(dia("miércoles, 21 de octubre de 2026")).toBeInTheDocument();
    expect(detalle()).toHaveTextContent("Cargando cobros…");
  });

  it("si falla, avisa sin decir 'sin cobros', y Reintentar vuelve a pedir", async () => {
    let falla = true;
    getCobrosMock.mockImplementation(async (mes) => {
      if (falla) throw new ErrorDeApi("Error interno", 500);
      return POR_MES[mes] ?? [];
    });
    await montar();

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus cobros.");
    expect(detalle()).toHaveTextContent("No pudimos cargar los cobros de este mes.");
    expect(dia("miércoles, 21 de octubre de 2026")).toBeInTheDocument();

    falla = false;
    await pulsar("Reintentar");
    expect(dia(/^sábado, 24 de octubre de 2026, 3 cobros/)).toBeInTheDocument();
  });
});

describe("Calendario: navegar meses y volver a hoy (CH-19)", () => {
  it("Mes siguiente pide noviembre, cambia el título y queda en la URL", async () => {
    await montar();
    await pulsar("Mes siguiente: noviembre de 2026");

    expect(getCobrosMock).toHaveBeenLastCalledWith("2026-11");
    expect(screen.getByRole("heading", { name: "Noviembre de 2026" })).toBeInTheDocument();
    expect(ubicacion()).toBe("/calendario?mes=2026-11");
    expect(dia("jueves, 5 de noviembre de 2026, 1 cobro: Netflix, $9.990, previsto", "noviembre de 2026")).toBeInTheDocument();
  });

  it("de enero a diciembre del año anterior, con las fechas correctas", async () => {
    await montar("/calendario?mes=2027-01");
    expect(screen.getByRole("heading", { name: "Enero de 2027" })).toBeInTheDocument();

    await pulsar("Mes anterior: diciembre de 2026");

    expect(getCobrosMock).toHaveBeenLastCalledWith("2026-12");
    expect(within(cuadricula("diciembre de 2026")).getAllByRole("button")).toHaveLength(31);
    expect(dia(/^martes, 1 de diciembre de 2026/, "diciembre de 2026")).toBeInTheDocument();
  });

  it("Hoy vuelve al mes y al día actuales, sin duplicar cobros", async () => {
    await montar();
    fireEvent.click(dia(/^sábado, 24 de octubre/));
    await pulsar("Mes siguiente: noviembre de 2026");
    await pulsar("Mes siguiente: diciembre de 2026");
    await pulsar("Hoy");

    expect(ubicacion()).toBe("/calendario?mes=2026-10");
    expect(dia(/^miércoles, 21 de octubre/).closest("td")).toHaveAttribute("aria-selected", "true");
    expect(dia(/^sábado, 24 de octubre de 2026, 3 cobros/)).toBeInTheDocument();
    expect(detalle()).toHaveAccessibleName("Miércoles, 21 de octubre de 2026");
  });

  it("una respuesta que llega tarde de un mes que ya se dejó no se mezcla", async () => {
    const noviembre = diferida<CobroCalendario[]>();
    getCobrosMock.mockImplementation((mes) => (mes === "2026-11" ? noviembre.promesa : Promise.resolve(OCTUBRE)));
    await montar();

    await pulsar("Mes siguiente: noviembre de 2026");
    await pulsar("Mes anterior: octubre de 2026");
    await act(async () => noviembre.resolver(NOVIEMBRE));

    expect(screen.getByRole("heading", { name: "Octubre de 2026" })).toBeInTheDocument();
    // El Netflix del 5 de noviembre no aparece en el 5 de octubre.
    expect(dia("lunes, 5 de octubre de 2026, sin cobros")).toBeInTheDocument();
    expect(dia(/^sábado, 24 de octubre de 2026, 3 cobros/)).toBeInTheDocument();
  });

  it("un ?mes= inválido muestra el mes actual y no pide un mes mal escrito", async () => {
    await montar("/calendario?mes=2026-13");

    expect(getCobrosMock.mock.calls.map(([mes]) => mes)).toEqual(expect.arrayContaining(["2026-10"]));
    expect(getCobrosMock.mock.calls.every(([mes]) => mes === "2026-10")).toBe(true);
    expect(screen.getByRole("heading", { name: "Octubre de 2026" })).toBeInTheDocument();
  });

  it("con el teclado se cruza de mes y el foco llega al día de destino", async () => {
    await montar();
    await enfocar(dia(/^sábado, 31 de octubre/));

    await teclear("ArrowRight");
    expect(dia(/^domingo, 1 de noviembre de 2026/, "noviembre de 2026")).toHaveFocus();
    expect(getCobrosMock).toHaveBeenLastCalledWith("2026-11");

    await teclear("PageUp");
    expect(dia(/^jueves, 1 de octubre de 2026/)).toHaveFocus();

    await teclear("ArrowLeft");
    expect(dia(/^miércoles, 30 de septiembre de 2026/, "septiembre de 2026")).toHaveFocus();
  });

  it("RePág/AvPág no se desbordan: del 31 de enero se llega al 28 de febrero", async () => {
    await montar("/calendario?mes=2027-01");
    await enfocar(dia(/^domingo, 31 de enero de 2027/, "enero de 2027"));

    await teclear("PageDown");
    expect(dia(/^domingo, 28 de febrero de 2027/, "febrero de 2027")).toHaveFocus();
  });
});

describe("Calendario: detalle del día elegido (CH-20)", () => {
  it("muestra sus cobros con enlace al detalle y el total por moneda, sin mezclarlas", async () => {
    await montar();
    fireEvent.click(dia(/^sábado, 24 de octubre/));

    expect(detalle()).toHaveAccessibleName("Sábado, 24 de octubre de 2026");
    expect(detalle()).toHaveTextContent("3 cobros");
    const filas = within(detalle()).getAllByRole("listitem");
    expect(filas).toHaveLength(3);
    expect(within(filas[0]).getByRole("link", { name: "Netflix" })).toHaveAttribute("href", "/suscripciones/sus-c2");
    expect(filas[0]).toHaveTextContent("Previsto");
    expect(within(detalle()).getByText(/^Total del día:/).closest("p")).toHaveTextContent(
      "Total del día: $15.980 y US$20,00",
    );
  });

  it("elegir otro día actualiza solo sus cobros", async () => {
    await montar();
    fireEvent.click(dia(/^sábado, 24 de octubre/));
    fireEvent.click(dia(/^martes, 27 de octubre/));

    const filas = within(detalle()).getAllByRole("listitem");
    expect(filas).toHaveLength(1);
    expect(filas[0]).toHaveTextContent("Gimnasio");
    expect(filas[0]).toHaveTextContent("Confirmado");
    expect(detalle()).not.toHaveTextContent("Netflix");
  });

  it("un día sin cobros lo dice claro", async () => {
    await montar();
    fireEvent.click(dia(/^jueves, 22 de octubre/));

    expect(detalle()).toHaveTextContent("Este día no tiene cobros confirmados ni previstos.");
    expect(within(detalle()).queryByRole("list")).not.toBeInTheDocument();
  });

  it("al cambiar de mes el detalle pasa a un día de ese mes", async () => {
    await montar();
    fireEvent.click(dia(/^sábado, 24 de octubre/));
    await pulsar("Mes siguiente: noviembre de 2026");

    expect(detalle()).toHaveAccessibleName("Domingo, 1 de noviembre de 2026");
  });

  it("un mes sin cobros lo dice, y la cuadrícula sigue para elegir días", async () => {
    await montar("/calendario?mes=2026-12");

    expect(screen.getByText("No hay cobros en diciembre de 2026.")).toBeInTheDocument();
    expect(cuadricula("diciembre de 2026")).toBeInTheDocument();
  });
});

describe("Agenda (CH-21)", () => {
  it("lista los cobros del mes agrupados por día, en orden, con total por moneda", async () => {
    await montar("/calendario/agenda?mes=2026-10");

    const dias = within(screen.getByRole("list", { name: "Cobros de octubre de 2026" })).getAllByRole("heading", {
      level: 3,
    });
    expect(dias.map((h) => h.textContent)).toEqual([
      "Jueves, 1 de octubre de 2026",
      "Miércoles, 21 de octubre de 2026Hoy",
      "Sábado, 24 de octubre de 2026",
      "Martes, 27 de octubre de 2026",
    ]);
    expect(screen.getByText(/^Total del mes:/).closest("p")).toHaveTextContent("Total del mes: $49.960 y US$20,00");
    expect(screen.getByRole("link", { name: "Gimnasio" })).toHaveAttribute("href", "/suscripciones/sus-c5");
  });

  it("muestra los mismos cobros que el calendario y conserva el mes al cambiar de vista", async () => {
    await montar("/calendario?mes=2026-11");
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Agenda" }));
    });

    expect(ubicacion()).toBe("/calendario/agenda?mes=2026-11");
    expect(screen.getByRole("link", { name: "Agenda" })).toHaveAttribute("aria-current", "page");
    const lista = screen.getByRole("list", { name: "Cobros de noviembre de 2026" });
    expect(within(lista).getAllByRole("link").map((a) => a.textContent)).toEqual(["Netflix"]);
  });

  it("cambiar de mes no deja a la vista cobros del mes anterior", async () => {
    const noviembre = diferida<CobroCalendario[]>();
    getCobrosMock.mockImplementation((mes) => (mes === "2026-11" ? noviembre.promesa : Promise.resolve(OCTUBRE)));
    await montar("/calendario/agenda");

    await pulsar("Mes siguiente: noviembre de 2026");
    // Mientras llega noviembre no se muestran los de octubre.
    expect(screen.queryByRole("link", { name: "Gimnasio" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Cargando tus cobros" })).toBeInTheDocument();

    await act(async () => noviembre.resolver(NOVIEMBRE));
    expect(screen.getByRole("list", { name: "Cobros de noviembre de 2026" })).toHaveTextContent("Netflix");
  });

  it("un mes sin cobros lo dice", async () => {
    await montar("/calendario/agenda?mes=2027-02");
    expect(screen.getByText("No hay cobros en febrero de 2027.")).toBeInTheDocument();
  });

  it("si falla, avisa y se puede reintentar", async () => {
    getCobrosMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await montar("/calendario/agenda");
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});

describe("Cuadrícula: teclado dentro del mes (CH-17)", () => {
  const tabulables = () => within(cuadricula()).getAllByRole("button").filter((b) => b.tabIndex === 0);

  it("solo un día recibe Tab, y las flechas recorren días y semanas", async () => {
    await montar();
    const hoy = dia(/^miércoles, 21 de octubre/);
    expect(tabulables()).toEqual([hoy]);

    await enfocar(hoy);
    await teclear("ArrowRight");
    expect(dia(/^jueves, 22 de octubre/)).toHaveFocus();
    await teclear("ArrowDown");
    expect(dia(/^jueves, 29 de octubre/)).toHaveFocus();
    await teclear("ArrowLeft");
    expect(dia(/^miércoles, 28 de octubre/)).toHaveFocus();
    await teclear("ArrowUp");
    expect(dia(/^miércoles, 21 de octubre/)).toHaveFocus();
    expect(tabulables()).toHaveLength(1);
  });

  it("Inicio y Fin van al primer y último día de la semana dentro del mes", async () => {
    await montar();
    await enfocar(dia(/^miércoles, 21 de octubre/));
    await teclear("Home");
    expect(dia(/^lunes, 19 de octubre/)).toHaveFocus();
    await teclear("End");
    expect(dia(/^domingo, 25 de octubre/)).toHaveFocus();

    // Primera semana: parte el jueves 1, no el lunes de septiembre.
    await enfocar(dia(/^sábado, 3 de octubre/));
    await teclear("Home");
    expect(dia(/^jueves, 1 de octubre/)).toHaveFocus();
  });

  it("Inicio en un lunes no deja un foco pendiente que después robe el foco", async () => {
    await montar();
    await enfocar(dia(/^lunes, 19 de octubre/));
    await teclear("Home");
    // Si quedara pendiente el lunes, al enfocar otro día se lo robaría.
    await enfocar(dia(/^jueves, 22 de octubre/));
    expect(dia(/^jueves, 22 de octubre/)).toHaveFocus();
  });
});

describe("Cuadrícula: meses de distinto largo (CH-17)", () => {
  function dibujar(anio: number, mes: number) {
    render(
      <CuadriculaMes anio={anio} mes={mes} hoy="2026-10-21" seleccionado={null} onSeleccionar={() => {}} cobros={[]} />,
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

  it("sin navegación de meses, el teclado no sale del mes", async () => {
    const dias = dibujar(2026, 9);
    await enfocar(dias[0]);
    await teclear("ArrowLeft");
    expect(dias[0]).toHaveFocus();
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
