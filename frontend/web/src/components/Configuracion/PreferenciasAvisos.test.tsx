// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorDeApi,
  getPreferenciasAlertas,
  guardarPreferenciasAlertas,
  type PreferenciasAlertas,
} from "@ojoalgasto/shared";
import { ToastProvider } from "../../context/ToastContext";
import { PreferenciasAvisos } from "./PreferenciasAvisos";

// Solo se simula la red; el componente y el router (de datos, como main.tsx) son reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getPreferenciasAlertas: vi.fn(), guardarPreferenciasAlertas: vi.fn() };
});
const getMock = vi.mocked(getPreferenciasAlertas);
const guardarMock = vi.mocked(guardarPreferenciasAlertas);

// Los valores por omisión del modelo de FE-21, como los devuelve el primer GET.
const POR_OMISION: PreferenciasAlertas = {
  por_email: true,
  por_push: false,
  en_la_app: true,
  avisar_proximo_cobro: true,
  avisar_fin_prueba: true,
  avisar_alza_tarifa: true,
  avisar_doble_cobro: true,
  avisar_presupuesto_excedido: true,
  dias_anticipacion: 3,
  canales_disponibles: ["email", "in_app"],
  canales_elegidos: ["email", "in_app"],
  actualizado_en: "2026-10-20T15:30:00Z",
};

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

async function montar() {
  const router = createMemoryRouter(
    [
      {
        path: "/configuracion",
        element: (
          <>
            <Link to="/home">Ir a Inicio</Link>
            <PreferenciasAvisos />
          </>
        ),
      },
      { path: "/home", element: <h1>Inicio</h1> },
    ],
    { initialEntries: ["/configuracion"] },
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  await act(async () => {});
  return router;
}

const interruptor = (nombre: string) => screen.getByRole("switch", { name: nombre });
const alternar = (nombre: string) => fireEvent.click(interruptor(nombre));
const guardar = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" })));
// El aviso de guardado también es role="status": se busca el del pie de la sección.
const estado = () => screen.getAllByRole("status").find((e) => e.tagName === "P")!;

beforeEach(() => {
  getMock.mockReset().mockResolvedValue(POR_OMISION);
  guardarMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Leer las preferencias (CH-30)", () => {
  it("muestra los canales y los tipos como los tiene guardados", async () => {
    await montar();
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(interruptor("Por correo")).toHaveAttribute("aria-checked", "true");
    expect(interruptor("Notificaciones push")).toHaveAttribute("aria-checked", "false");
    expect(interruptor("Dentro de la app")).toHaveAttribute("aria-checked", "true");
    for (const tipo of ["Antes de cada cobro", "Cuando termina una prueba gratis", "Alza de tarifa", "Posible doble cobro", "Presupuesto excedido"]) {
      expect(interruptor(tipo)).toHaveAttribute("aria-checked", "true");
    }
    expect(screen.getByText("3 días antes del cobro.")).toBeInTheDocument();
    expect(estado()).toHaveTextContent("Guardado");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });

  it("un canal que el servidor todavía no entrega no se promete", async () => {
    await montar();
    const filaPush = interruptor("Notificaciones push").parentElement!;
    expect(filaPush).toHaveTextContent("Todavía no lo enviamos");
    expect(interruptor("Por correo").parentElement!).not.toHaveTextContent("Todavía no lo enviamos");
  });

  it("si la carga falla, avisa y permite reintentar", async () => {
    getMock.mockReset().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(POR_OMISION);
    await montar();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reintentar" })));
    expect(interruptor("Por correo")).toBeInTheDocument();
  });
});

describe("Editar y guardar (CH-30)", () => {
  it("editar no guarda: dice que hay cambios pendientes, y volver al valor original los quita", async () => {
    await montar();
    alternar("Alza de tarifa");
    expect(interruptor("Alza de tarifa")).toHaveAttribute("aria-checked", "false");
    expect(estado()).toHaveTextContent("Tienes cambios sin guardar.");
    expect(guardarMock).not.toHaveBeenCalled();

    alternar("Alza de tarifa");
    expect(estado()).toHaveTextContent("Guardado");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });

  it("el PATCH lleva solo lo que cambió y lo confirmado queda como guardado", async () => {
    const respuesta = diferida<PreferenciasAlertas>();
    guardarMock.mockReturnValue(respuesta.promesa);
    await montar();
    alternar("Notificaciones push");
    alternar("Alza de tarifa");
    await guardar();

    expect(guardarMock).toHaveBeenCalledTimes(1);
    expect(guardarMock).toHaveBeenCalledWith({ por_push: true, avisar_alza_tarifa: false });
    // Mientras viaja no se edita: la respuesta es la que manda.
    expect(interruptor("Por correo")).toBeDisabled();

    await act(async () =>
      respuesta.resolver({ ...POR_OMISION, por_push: true, avisar_alza_tarifa: false, actualizado_en: "2026-10-28T22:00:00Z" }),
    );
    expect(interruptor("Notificaciones push")).toHaveAttribute("aria-checked", "true");
    expect(interruptor("Alza de tarifa")).toHaveAttribute("aria-checked", "false");
    expect(interruptor("Por correo")).toBeEnabled();
    expect(estado()).toHaveTextContent("Guardado");
    expect(screen.getByText("Guardamos tus avisos.")).toBeInTheDocument();
  });

  it("al recargar se recupera lo guardado (lo que devuelve el GET, no lo que se editó)", async () => {
    getMock.mockReset().mockResolvedValue({ ...POR_OMISION, por_push: true, avisar_doble_cobro: false, dias_anticipacion: 7 });
    await montar();
    expect(interruptor("Notificaciones push")).toHaveAttribute("aria-checked", "true");
    expect(interruptor("Posible doble cobro")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("7 días antes del cobro.")).toBeInTheDocument();
  });

  it("con un día de anticipación lo dice en singular", async () => {
    getMock.mockReset().mockResolvedValue({ ...POR_OMISION, dias_anticipacion: 1 });
    await montar();
    expect(screen.getByText("1 día antes del cobro.")).toBeInTheDocument();
  });

  it.each([
    ["sin red", new TypeError("Failed to fetch"), "No pudimos conectar con el servidor."],
    ["un 400", new ErrorDeApi("Asegúrese de que este valor es menor o igual a 30.", 400), "No se guardó: Asegúrese"],
    ["un 500", new ErrorDeApi("Error interno.", 500), "Siguen aquí"],
  ])("si el guardado falla (%s), lo editado se queda como pendiente y se puede reintentar", async (_, error, mensaje) => {
    guardarMock.mockRejectedValueOnce(error).mockResolvedValueOnce({ ...POR_OMISION, avisar_fin_prueba: false });
    await montar();
    alternar("Cuando termina una prueba gratis");
    await guardar();

    expect(screen.getByRole("alert")).toHaveTextContent(mensaje);
    expect(interruptor("Cuando termina una prueba gratis")).toHaveAttribute("aria-checked", "false");
    expect(estado()).toHaveTextContent("Tienes cambios sin guardar.");
    expect(screen.queryByText("Guardamos tus avisos.")).not.toBeInTheDocument();

    await guardar();
    expect(guardarMock).toHaveBeenLastCalledWith({ avisar_fin_prueba: false });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(estado()).toHaveTextContent("Guardado");
  });

  it("Descartar vuelve a lo guardado sin llamar a la API", async () => {
    await montar();
    alternar("Por correo");
    alternar("Presupuesto excedido");
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(interruptor("Por correo")).toHaveAttribute("aria-checked", "true");
    expect(interruptor("Presupuesto excedido")).toHaveAttribute("aria-checked", "true");
    expect(estado()).toHaveTextContent("Guardado");
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("dos clics en Guardar en el mismo instante mandan un solo PATCH", async () => {
    guardarMock.mockResolvedValue({ ...POR_OMISION, por_email: false });
    await montar();
    alternar("Por correo");
    const boton = screen.getByRole("button", { name: "Guardar cambios" });
    await act(async () => {
      fireEvent.click(boton);
      fireEvent.click(boton);
    });
    expect(guardarMock).toHaveBeenCalledTimes(1);
  });

  it("con todos los canales apagados avisa que no llegará nada", async () => {
    await montar();
    alternar("Por correo");
    expect(screen.queryByText(/no te llega ningún aviso/)).not.toBeInTheDocument();
    alternar("Dentro de la app");
    expect(screen.getByText("Con todos los canales apagados no te llega ningún aviso.")).toBeInTheDocument();
  });
});

describe("Salir con cambios sin guardar (CH-30, como CH-16)", () => {
  it("navegar queda retenido; Seguir editando conserva lo editado", async () => {
    const router = await montar();
    alternar("Alza de tarifa");
    await act(async () => fireEvent.click(screen.getByRole("link", { name: "Ir a Inicio" })));

    expect(router.state.location.pathname).toBe("/configuracion");
    const aviso = screen.getByText("Tienes cambios sin guardar. Si sales ahora, se pierden.").closest("[role=alert]")!;
    await act(async () => fireEvent.click(within(aviso as HTMLElement).getByRole("button", { name: "Seguir editando" })));
    expect(router.state.location.pathname).toBe("/configuracion");
    expect(interruptor("Alza de tarifa")).toHaveAttribute("aria-checked", "false");
  });

  it("Descartar cambios deja seguir la navegación sin guardar", async () => {
    const router = await montar();
    alternar("Alza de tarifa");
    await act(async () => fireEvent.click(screen.getByRole("link", { name: "Ir a Inicio" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" })));

    expect(router.state.location.pathname).toBe("/home");
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it("guardar con la navegación retenida la completa", async () => {
    guardarMock.mockResolvedValue({ ...POR_OMISION, avisar_alza_tarifa: false });
    const router = await montar();
    alternar("Alza de tarifa");
    await act(async () => fireEvent.click(screen.getByRole("link", { name: "Ir a Inicio" })));
    await guardar();

    expect(router.state.location.pathname).toBe("/home");
  });

  it("sin cambios no se retiene nada", async () => {
    const router = await montar();
    await act(async () => fireEvent.click(screen.getByRole("link", { name: "Ir a Inicio" })));
    expect(router.state.location.pathname).toBe("/home");
  });
});
