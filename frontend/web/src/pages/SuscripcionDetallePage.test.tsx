// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorDeApi,
  getSuscripcion,
  getUsos,
  hoyLocalIso,
  registrarUso,
  type RegistroUso,
  type Suscripcion,
} from "@ojoalgasto/shared";
import { ToastProvider } from "../context/ToastContext";
import { AuthProvider } from "../context/AuthContext";
import { SuscripcionDetallePage } from "./SuscripcionDetallePage";

// Solo se simula la red; la página y sus componentes son reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getSuscripcion: vi.fn(), getUsos: vi.fn(), registrarUso: vi.fn() };
});
const getSuscripcionMock = vi.mocked(getSuscripcion);
const getUsosMock = vi.mocked(getUsos);
const registrarUsoMock = vi.mocked(registrarUso);

const SPOTIFY: Suscripcion = {
  id: "a",
  nombre: "Spotify",
  monto: 5990,
  moneda: "CLP",
  frecuencia: "mensual",
  fecha_proximo_cobro: "2026-11-10",
  categoria: "musica",
  estado: "activo",
};
const NETFLIX: Suscripcion = { ...SPOTIFY, id: "b", nombre: "Netflix", categoria: "streaming" };

const USOS_A: RegistroUso[] = [
  { fecha: "2026-10-18", minutos: 45 },
  { fecha: "2026-10-12", minutos: 90 },
  { fecha: "2026-10-03", minutos: 30 },
];

async function montar(ruta = "/suscripciones/a") {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <ToastProvider>
        <AuthProvider>
          <Link to="/suscripciones/b">Ir a Netflix</Link>
          <Routes>
            <Route path="/suscripciones/:id" element={<SuscripcionDetallePage />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

const historial = () => screen.getByRole("list", { name: "Historial de uso" });
const filas = () => within(historial()).getAllByRole("listitem").map((li) => li.textContent);
const minutos = () => screen.getByLabelText("Minutos de uso") as HTMLInputElement;
const registrar = () => act(async () => fireEvent.click(screen.getByRole("button", { name: /Registrar uso|Registrando/ })));

beforeEach(() => {
  localStorage.clear();
  getSuscripcionMock.mockReset().mockImplementation(async (id) => (id === "b" ? NETFLIX : SPOTIFY));
  getUsosMock.mockReset().mockResolvedValue(USOS_A);
  registrarUsoMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Historial de uso (CH-15)", () => {
  it("muestra los registros en el mismo orden y con los mismos valores que la API", async () => {
    await montar();

    expect(getUsosMock).toHaveBeenCalledWith("a");
    expect(filas()).toEqual(["18 oct 202645 min", "12 oct 20261 h 30 min", "03 oct 202630 min"]);
  });

  it("sin registros muestra un estado vacío claro", async () => {
    getUsosMock.mockResolvedValue([]);
    await montar();
    expect(screen.getByText("Todavía no registras uso de esta suscripción.")).toBeInTheDocument();
  });

  it("mientras carga lo indica, y si falla permite reintentar", async () => {
    let fallar: (e: unknown) => void = () => {};
    getUsosMock.mockReturnValueOnce(new Promise((_, rej) => (fallar = rej)));
    await montar();
    expect(screen.getByText("Cargando el historial…")).toBeInTheDocument();

    await act(async () => fallar(new TypeError("Failed to fetch")));
    expect(screen.getByText("No pudimos cargar el historial de uso.")).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reintentar" })));
    expect(filas()).toHaveLength(3);
  });

  it("no mezcla usos de distintas suscripciones: una respuesta tardía se descarta", async () => {
    let responderA: (u: RegistroUso[]) => void = () => {};
    getUsosMock.mockImplementation((id: string) =>
      id === "a"
        ? new Promise((r) => (responderA = r))
        : Promise.resolve([{ fecha: "2026-10-15", minutos: 120 }]),
    );
    await montar("/suscripciones/a");

    await act(async () => fireEvent.click(screen.getByRole("link", { name: "Ir a Netflix" })));
    await act(async () => responderA(USOS_A)); // llega tarde, de la suscripción anterior

    expect(screen.getByRole("heading", { name: "Netflix", level: 1 })).toBeInTheDocument();
    expect(filas()).toEqual(["15 oct 20262 h"]);
  });

  it("una suscripción que no existe muestra el mensaje de no encontrada", async () => {
    getSuscripcionMock.mockRejectedValue(new ErrorDeApi("No encontrado.", 404));
    await montar();
    expect(screen.getByText("No encontramos esa suscripción. Puede que haya sido eliminada.")).toBeInTheDocument();
  });
});

describe("Horas de uso del mes con VI-10", () => {
  it("con cero horas este mes (VI-10 reinicia el conteo al cambiar de mes) dice 'Sin registrar'", async () => {
    getSuscripcionMock.mockResolvedValue({ ...SPOTIFY, horas_uso_mes: 0 });
    await montar();

    const dato = screen.getByText("Horas de uso este mes").closest("div");
    expect(dato).toHaveTextContent("Sin registrar");
    expect(screen.getByText("Costo por hora de uso").closest("div")).toHaveTextContent("Sin uso este mes");
  });
});

describe("Registrar minutos de uso (CH-14)", () => {
  it("un registro válido se envía una vez y se refleja una sola vez en el historial y el detalle", async () => {
    registrarUsoMock.mockResolvedValue({ ...SPOTIFY, horas_uso_mes: 0.75 });
    await montar();
    getUsosMock.mockResolvedValue([{ fecha: hoyLocalIso(), minutos: 45 }, ...USOS_A]);

    fireEvent.change(minutos(), { target: { value: "45" } });
    await registrar();

    expect(registrarUsoMock).toHaveBeenCalledTimes(1);
    expect(registrarUsoMock).toHaveBeenCalledWith("a", { minutos: 45, fecha: hoyLocalIso() });
    expect(filas()).toHaveLength(4); // la fila nueva, una sola vez
    expect(filas().filter((f) => f?.endsWith("45 min"))).toHaveLength(2); // la nueva + la del 18 oct
    expect(screen.getByText("0,75 h")).toBeInTheDocument(); // horas del mes, desde la respuesta (coma de Chile)
    expect(screen.getByRole("status")).toHaveTextContent("Registraste 45 minutos.");
    expect(minutos()).toHaveValue("");
  });

  it("si se cambia de suscripción mientras se registra, la respuesta no pisa la otra", async () => {
    let responder: (s: Suscripcion) => void = () => {};
    registrarUsoMock.mockReturnValue(new Promise((r) => (responder = r)));
    await montar("/suscripciones/a");
    fireEvent.change(minutos(), { target: { value: "30" } });
    await registrar();

    await act(async () => fireEvent.click(screen.getByRole("link", { name: "Ir a Netflix" })));
    await act(async () => responder({ ...SPOTIFY, horas_uso_mes: 9.5 })); // llega tarde, de Spotify

    expect(screen.getByRole("heading", { name: "Netflix", level: 1 })).toBeInTheDocument();
    expect(screen.queryByText("9,5 h")).not.toBeInTheDocument();
  });

  it("si se borra el Día, se registra sin la propiedad fecha (el backend usa hoy)", async () => {
    // Contrato real (RegistrarUsoSerializer): { minutos: 30 } es válido;
    // { minutos: 30, fecha: "" } y { minutos: 30, fecha: null } no.
    registrarUsoMock.mockResolvedValue({ ...SPOTIFY, horas_uso_mes: 0.5 });
    await montar();
    fireEvent.change(minutos(), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Día"), { target: { value: "" } });
    await registrar();

    expect(registrarUsoMock).toHaveBeenCalledTimes(1);
    const [id, cuerpo] = registrarUsoMock.mock.calls[0];
    expect(id).toBe("a");
    expect(Object.keys(cuerpo)).toEqual(["minutos"]); // sin "fecha", ni vacía ni null
    expect(cuerpo).toEqual({ minutos: 30 });
    expect(screen.getByRole("status")).toHaveTextContent("Registraste 30 minutos.");
  });

  it("dos envíos seguidos registran una sola vez", async () => {
    registrarUsoMock.mockResolvedValue(SPOTIFY);
    await montar();
    fireEvent.change(minutos(), { target: { value: "30" } });
    const formulario = minutos().closest("form") as HTMLFormElement;
    fireEvent.submit(formulario);
    fireEvent.submit(formulario);
    await act(async () => {});

    expect(registrarUsoMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["0", "Los minutos de uso no pueden ser negativos ni cero."],
    ["-5", "Los minutos de uso no pueden ser negativos ni cero."],
    ["1.5", "Los minutos deben ser un número entero válido."],
    ["", "Ingresa los minutos de uso."],
    ["44641", "Los minutos de uso no pueden superar el máximo mensual (44.640 minutos)."],
  ])("minutos %j no se envían y dejan un mensaje claro", async (valor, mensaje) => {
    await montar();
    fireEvent.change(minutos(), { target: { value: valor } });
    await registrar();

    expect(registrarUsoMock).not.toHaveBeenCalled();
    expect(minutos()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(mensaje)).toBeInTheDocument();
    expect(document.activeElement).toBe(minutos());
  });

  it("una fecha futura no se envía", async () => {
    await montar();
    fireEvent.change(minutos(), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Día"), { target: { value: "2099-01-01" } });
    await registrar();

    expect(registrarUsoMock).not.toHaveBeenCalled();
    expect(screen.getByText("No se puede registrar uso de una fecha futura.")).toBeInTheDocument();
  });

  it("un error del servidor por campo se muestra bajo ese campo y no se pierde lo escrito", async () => {
    registrarUsoMock.mockRejectedValue(
      new ErrorDeApi("Los minutos de uso no pueden ser negativos ni cero.", 400, {
        minutos: ["Los minutos de uso no pueden ser negativos ni cero."],
      }),
    );
    await montar();
    fireEvent.change(minutos(), { target: { value: "30" } });
    await registrar();

    expect(minutos()).toHaveAttribute("aria-invalid", "true");
    expect(minutos()).toHaveValue("30");
    expect(filas()).toHaveLength(3); // el historial no cambia
  });

  it.each([
    [new ErrorDeApi("Error interno", 500), "Error interno"],
    [new TypeError("Failed to fetch"), "No pudimos conectar con el servidor"],
  ])("un error general (%s) deja un mensaje claro y se puede reintentar", async (error, mensaje) => {
    registrarUsoMock.mockRejectedValueOnce(error).mockResolvedValueOnce(SPOTIFY);
    await montar();
    fireEvent.change(minutos(), { target: { value: "30" } });
    await registrar();

    expect(screen.getByRole("alert")).toHaveTextContent(mensaje);
    expect(minutos()).toHaveValue("30");

    await registrar();
    expect(registrarUsoMock).toHaveBeenCalledTimes(2);
  });
});
