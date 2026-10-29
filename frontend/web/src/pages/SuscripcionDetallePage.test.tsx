// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelarSuscripcion,
  ErrorDeApi,
  getSuscripcion,
  getUsos,
  formatearFecha,
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
  return {
    ...real,
    getSuscripcion: vi.fn(),
    getUsos: vi.fn(),
    registrarUso: vi.fn(),
    cancelarSuscripcion: vi.fn(),
  };
});
const getSuscripcionMock = vi.mocked(getSuscripcion);
const getUsosMock = vi.mocked(getUsos);
const registrarUsoMock = vi.mocked(registrarUso);
const cancelarSuscripcionMock = vi.mocked(cancelarSuscripcion);

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
  cancelarSuscripcionMock.mockReset();
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

  it("un día de otro mes se registra y avisa que no suma a las horas de este mes (VI-10)", async () => {
    // Último día del mes anterior, calculado desde hoy (sin pasar por UTC).
    const [anio, mes] = hoyLocalIso().split("-").map(Number);
    const fin = new Date(anio, mes - 1, 0);
    const diaMesAnterior = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, "0")}-${String(fin.getDate()).padStart(2, "0")}`;
    registrarUsoMock.mockResolvedValue(SPOTIFY); // VI-10: las horas del mes no cambian
    await montar();
    fireEvent.change(minutos(), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Día"), { target: { value: diaMesAnterior } });
    await registrar();

    expect(registrarUsoMock).toHaveBeenCalledWith("a", { minutos: 90, fecha: diaMesAnterior });
    expect(screen.getByRole("status")).toHaveTextContent(
      `Registraste 90 minutos el ${formatearFecha(diaMesAnterior)}. No suma a las horas de este mes.`,
    );
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

describe("Cancelar suscripción sin borrarla (CH-10)", () => {
  const CANCELADA: Suscripcion = { ...SPOTIFY, estado: "cancelado" };
  const dialogo = () => screen.getByRole("alertdialog", { name: "¿Cancelar Spotify?" });
  const abrir = () => fireEvent.click(screen.getByRole("button", { name: "Cancelar suscripción" }));
  const confirmar = () =>
    act(async () => fireEvent.click(within(dialogo()).getByRole("button", { name: /Cancelar suscripción|Cancelando/ })));
  const proximoCobro = () => screen.getByText("Próximo cobro").closest("div");

  /** Promesa que el test resuelve cuando quiere. */
  function diferida<T>() {
    let resolver!: (v: T) => void;
    const promesa = new Promise<T>((res) => (resolver = res));
    return { promesa, resolver };
  }

  it("confirmar usa la transición cancelar y muestra la suscripción cancelada, sin cobros pendientes", async () => {
    cancelarSuscripcionMock.mockResolvedValue(CANCELADA);
    await montar();
    expect(screen.getByText("Activa")).toBeInTheDocument();

    abrir();
    // Explica que no es eliminar y el foco empieza en la opción que no cambia nada.
    expect(dialogo()).toHaveTextContent("Su historial de cobros y de uso se conserva.");
    expect(dialogo()).toHaveTextContent("Esto no la elimina");
    expect(within(dialogo()).getByRole("button", { name: "Volver" })).toHaveFocus();
    await confirmar();

    expect(cancelarSuscripcionMock).toHaveBeenCalledTimes(1);
    expect(cancelarSuscripcionMock).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(proximoCobro()).toHaveTextContent("Sin cobros pendientes");
    expect(proximoCobro()).not.toHaveTextContent(formatearFecha(SPOTIFY.fecha_proximo_cobro));
    expect(screen.getByText(/La cancelaste/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar suscripción" })).not.toBeInTheDocument();
    expect(screen.getByText("Cancelaste Spotify. Ya no contamos sus próximos cobros.")).toBeInTheDocument();
    // El historial de uso sigue ahí: cancelar no lo borra.
    expect(filas()).toHaveLength(3);
  });

  it.each([
    ["Volver", () => fireEvent.click(within(dialogo()).getByRole("button", { name: "Volver" }))],
    ["la X", () => fireEvent.click(within(dialogo()).getByRole("button", { name: "Cerrar" }))],
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
  ])("cerrar con %s no llama a la API ni cambia la suscripción", async (_, cerrar) => {
    await montar();
    abrir();
    cerrar();

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(cancelarSuscripcionMock).not.toHaveBeenCalled();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(proximoCobro()).toHaveTextContent(formatearFecha(SPOTIFY.fecha_proximo_cobro));
  });

  it("mientras se cancela no se puede cerrar ni confirmar dos veces", async () => {
    const respuesta = diferida<Suscripcion>();
    cancelarSuscripcionMock.mockReturnValue(respuesta.promesa);
    await montar();
    abrir();
    await confirmar();
    await confirmar();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(cancelarSuscripcionMock).toHaveBeenCalledTimes(1);
    expect(dialogo()).toBeInTheDocument();
    expect(within(dialogo()).getByRole("button", { name: "Volver" })).toBeDisabled();

    await act(async () => respuesta.resolver(CANCELADA));
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
  });

  it.each([
    [new ErrorDeApi("El actor no tiene un rol válido para solicitar la cancelación.", 403), "No tienes permiso para cancelar esta suscripción."],
    [new ErrorDeApi("No encontrado.", 404), "Esta suscripción ya no existe."],
    [new ErrorDeApi("No se permite la transición.", 400), "No se permite la transición."],
    [new TypeError("Failed to fetch"), "No pudimos conectar con el servidor."],
  ])("si falla (%s), avisa dentro del diálogo y la suscripción no cambia", async (error, mensaje) => {
    cancelarSuscripcionMock.mockRejectedValueOnce(error).mockResolvedValueOnce(CANCELADA);
    await montar();
    abrir();
    await confirmar();

    expect(within(dialogo()).getByRole("alert")).toHaveTextContent(mensaje);
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.queryByText(/Cancelaste/)).not.toBeInTheDocument();

    // Se puede reintentar desde el mismo diálogo.
    await confirmar();
    expect(cancelarSuscripcionMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
  });

  it("una suscripción ya cancelada no ofrece cancelarla otra vez", async () => {
    getSuscripcionMock.mockResolvedValue(CANCELADA);
    await montar();

    expect(screen.queryByRole("button", { name: "Cancelar suscripción" })).not.toBeInTheDocument();
    expect(screen.getByText(/La cancelaste/)).toBeInTheDocument();
    expect(proximoCobro()).toHaveTextContent("Sin cobros pendientes");
  });

  it("si se pasa a otra suscripción mientras se cancela, la respuesta no se muestra en la nueva", async () => {
    const respuesta = diferida<Suscripcion>();
    cancelarSuscripcionMock.mockReturnValue(respuesta.promesa);
    await montar("/suscripciones/a");
    abrir();
    await confirmar();

    await act(async () => fireEvent.click(screen.getByRole("link", { name: "Ir a Netflix" })));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await act(async () => respuesta.resolver(CANCELADA)); // llega tarde, de Spotify

    expect(screen.getByRole("heading", { name: "Netflix", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.queryByText(/Cancelaste/)).not.toBeInTheDocument();
  });
});

// Revisión de #112: registrar uso y cancelar devuelven la suscripción completa
// y, cruzadas, una respuesta vieja tapaba a la nueva. Ahora no pueden estar en
// vuelo a la vez: la segunda no se envía hasta que termina la primera.
describe("Registrar uso y cancelar no se cruzan (revisión de #112)", () => {
  const CANCELADA: Suscripcion = { ...SPOTIFY, estado: "cancelado" };
  const botonCancelar = () => screen.getByRole("button", { name: "Cancelar suscripción" });
  const botonRegistrar = () => screen.getByRole("button", { name: /Registrar uso|Registrando/ });
  const dialogo = () => screen.getByRole("alertdialog", { name: "¿Cancelar Spotify?" });
  const confirmar = () =>
    act(async () => fireEvent.click(within(dialogo()).getByRole("button", { name: /Cancelar suscripción|Cancelando/ })));
  const enviarUso = (valor = "45") =>
    act(async () => {
      fireEvent.change(minutos(), { target: { value: valor } });
      fireEvent.submit(minutos().closest("form")!);
    });
  const proximoCobro = () => screen.getByText("Próximo cobro").closest("div");
  const horasDelMes = () => screen.getByText("Horas de uso este mes").closest("div");

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

  it("mientras se registra uso no se puede cancelar, y al terminar la cancelación muestra lo confirmado", async () => {
    const uso = diferida<Suscripcion>();
    registrarUsoMock.mockReturnValue(uso.promesa);
    // El servidor ya sumó el uso cuando cancela: su respuesta trae las horas.
    cancelarSuscripcionMock.mockResolvedValue({ ...CANCELADA, horas_uso_mes: 0.75 });
    await montar();
    await enviarUso();

    // El caso de la revisión (uso pendiente → confirmar cancelar) ya no puede empezar.
    expect(botonCancelar()).toBeDisabled();
    fireEvent.click(botonCancelar());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(cancelarSuscripcionMock).not.toHaveBeenCalled();

    await act(async () => uso.resolver({ ...SPOTIFY, horas_uso_mes: 0.75 }));
    expect(botonCancelar()).toBeEnabled();
    fireEvent.click(botonCancelar());
    await confirmar();

    expect(cancelarSuscripcionMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.queryByText("Activa")).not.toBeInTheDocument();
    expect(proximoCobro()).toHaveTextContent("Sin cobros pendientes");
    expect(horasDelMes()).toHaveTextContent("0,75 h");
    expect(screen.getByText("Cancelaste Spotify. Ya no contamos sus próximos cobros.")).toBeInTheDocument();
    expect(getUsosMock).toHaveBeenCalledTimes(2); // el historial se recargó tras el uso
    expect(getSuscripcionMock).toHaveBeenCalledTimes(1); // sin recargas del detalle
  });

  it("mientras se cancela no se registra uso, aunque se envíe el formulario de detrás del diálogo", async () => {
    const cancelacion = diferida<Suscripcion>();
    cancelarSuscripcionMock.mockReturnValue(cancelacion.promesa);
    await montar();
    fireEvent.click(botonCancelar());
    await confirmar();

    await enviarUso();
    expect(botonRegistrar()).toBeDisabled();
    expect(registrarUsoMock).not.toHaveBeenCalled();

    await act(async () => cancelacion.resolver(CANCELADA));
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(registrarUsoMock).not.toHaveBeenCalled(); // tampoco se envía después
  });

  it("con la confirmación abierta tampoco se registra uso; al cerrarla, sí", async () => {
    registrarUsoMock.mockResolvedValue({ ...SPOTIFY, horas_uso_mes: 0.75 });
    await montar();
    fireEvent.click(botonCancelar());

    await enviarUso();
    expect(registrarUsoMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo()).getByRole("button", { name: "Volver" }));
    expect(botonRegistrar()).toBeEnabled();
    await enviarUso();
    expect(registrarUsoMock).toHaveBeenCalledTimes(1);
    expect(horasDelMes()).toHaveTextContent("0,75 h");
  });

  it.each([
    ["sale bien", (c: ReturnType<typeof diferida<Suscripcion>>) => c.resolver(CANCELADA)],
    ["falla", (c: ReturnType<typeof diferida<Suscripcion>>) => c.rechazar(new TypeError("Failed to fetch"))],
  ])("cuando la cancelación %s, registrar uso vuelve a estar disponible", async (resultado, terminar) => {
    const cancelacion = diferida<Suscripcion>();
    cancelarSuscripcionMock.mockReturnValue(cancelacion.promesa);
    registrarUsoMock.mockResolvedValue({ ...SPOTIFY, horas_uso_mes: 0.75 });
    await montar();
    fireEvent.click(botonCancelar());
    await confirmar();

    await act(async () => terminar(cancelacion));
    if (resultado === "falla") {
      // El error queda en el diálogo; al cerrarlo, el formulario vuelve.
      expect(within(dialogo()).getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
      fireEvent.click(within(dialogo()).getByRole("button", { name: "Volver" }));
    }

    expect(botonRegistrar()).toBeEnabled();
    await enviarUso();
    expect(registrarUsoMock).toHaveBeenCalledTimes(1);
  });

  it("si registrar uso falla, cancelar vuelve a estar disponible", async () => {
    registrarUsoMock.mockRejectedValue(new TypeError("Failed to fetch"));
    cancelarSuscripcionMock.mockResolvedValue(CANCELADA);
    await montar();
    await enviarUso();

    expect(botonCancelar()).toBeEnabled();
    fireEvent.click(botonCancelar());
    await confirmar();
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
  });

  it("dos envíos del uso en el mismo instante mandan uno solo", async () => {
    const uso = diferida<Suscripcion>();
    registrarUsoMock.mockReturnValue(uso.promesa);
    await montar();
    fireEvent.change(minutos(), { target: { value: "45" } });
    const formulario = minutos().closest("form")!;
    await act(async () => {
      fireEvent.submit(formulario);
      fireEvent.submit(formulario);
    });

    expect(registrarUsoMock).toHaveBeenCalledTimes(1);
    await act(async () => uso.resolver({ ...SPOTIFY, horas_uso_mes: 0.75 }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("una operación sola muestra su respuesta sin volver a pedir el detalle", async () => {
    cancelarSuscripcionMock.mockResolvedValue(CANCELADA);
    await montar();
    fireEvent.click(botonCancelar());
    await confirmar();

    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(getSuscripcionMock).toHaveBeenCalledTimes(1); // solo la carga inicial
  });
});
