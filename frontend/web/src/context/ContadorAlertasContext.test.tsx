// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getContadorAlertas, type ContadorAlertas } from "@ojoalgasto/shared";
import { ContadorAlertasProvider, useContadorAlertas } from "./ContadorAlertasContext";

vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getContadorAlertas: vi.fn() };
});
const contadorMock = vi.mocked(getContadorAlertas);

function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function Sonda() {
  const { pendientes, actualizar, descontar } = useContadorAlertas();
  return (
    <>
      <p data-testid="pendientes">{pendientes === null ? "sin dato" : pendientes}</p>
      <button onClick={() => descontar(1)}>Descontar</button>
      <button onClick={actualizar}>Actualizar</button>
    </>
  );
}

async function montar(conProvider = true) {
  const sonda = <Sonda />;
  render(<StrictMode>{conProvider ? <ContadorAlertasProvider>{sonda}</ContadorAlertasProvider> : sonda}</StrictMode>);
  await act(async () => {});
}

const pendientes = () => screen.getByTestId("pendientes");
const respuesta = (n: number): ContadorAlertas => ({ pendientes: n, total: n + 2 });

beforeEach(() => {
  contadorMock.mockReset().mockResolvedValue(respuesta(3));
});

afterEach(() => {
  cleanup();
});

describe("ContadorAlertasProvider: el número de la campana (CH-31)", () => {
  it("al montarse pregunta al servidor cuántas hay sin leer", async () => {
    await montar();
    expect(pendientes()).toHaveTextContent("3");
    expect(contadorMock).toHaveBeenCalled();
  });

  it("descontar baja al instante y después vale lo que diga el servidor", async () => {
    await montar();
    const confirmacion = diferida<ContadorAlertas>();
    contadorMock.mockReturnValueOnce(confirmacion.promesa);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Descontar" })));
    expect(pendientes()).toHaveTextContent("2");

    // Otra pestaña leyó otra más: manda el servidor.
    await act(async () => confirmacion.resolver(respuesta(1)));
    expect(pendientes()).toHaveTextContent("1");
  });

  it("una respuesta pedida antes de descontar que llega después no vuelve a subir el número", async () => {
    await montar();
    const vieja = diferida<ContadorAlertas>();
    contadorMock.mockReturnValueOnce(vieja.promesa).mockResolvedValueOnce(respuesta(2));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Actualizar" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Descontar" })));
    expect(pendientes()).toHaveTextContent("2");

    await act(async () => vieja.resolver(respuesta(3)));
    expect(pendientes()).toHaveTextContent("2");
  });

  it("nunca baja de cero", async () => {
    contadorMock.mockResolvedValue(respuesta(0));
    await montar();
    contadorMock.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Descontar" })));
    expect(pendientes()).toHaveTextContent("0");
  });

  it("si el servidor falla, se queda con lo último que supo", async () => {
    await montar();
    contadorMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Actualizar" })));
    expect(pendientes()).toHaveTextContent("3");
  });

  it("al volver a la pestaña pregunta de nuevo", async () => {
    await montar();
    contadorMock.mockResolvedValue(respuesta(5));
    const llamadas = contadorMock.mock.calls.length;
    const visibilidad = vi.spyOn(document, "visibilityState", "get");
    try {
      visibilidad.mockReturnValue("hidden");
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      expect(contadorMock).toHaveBeenCalledTimes(llamadas);

      visibilidad.mockReturnValue("visible");
      await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      expect(contadorMock).toHaveBeenCalledTimes(llamadas + 1);
      expect(pendientes()).toHaveTextContent("5");
    } finally {
      visibilidad.mockRestore();
    }
  });

  it("fuera del provider no hay número y nada pide al servidor", async () => {
    await montar(false);
    fireEvent.click(screen.getByRole("button", { name: "Descontar" }));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    expect(pendientes()).toHaveTextContent("sin dato");
    expect(contadorMock).not.toHaveBeenCalled();
  });
});
