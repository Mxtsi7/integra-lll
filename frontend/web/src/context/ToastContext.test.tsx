// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastContext";

// Botones que disparan cada tipo de toast, para probar el provider de punta a punta.
function Disparador() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.error("Falló algo")}>error</button>
      <button onClick={() => toast.exito("Listo")}>exito</button>
      <button onClick={() => toast.info("Para tu información")}>info</button>
    </>
  );
}

function montar() {
  return render(
    <ToastProvider>
      <Disparador />
    </ToastProvider>,
  );
}

const clic = (nombre: string) => fireEvent.click(screen.getByRole("button", { name: nombre }));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("un error se anuncia con role=alert", () => {
    montar();
    clic("error");
    expect(screen.getByRole("alert")).toHaveTextContent("Falló algo");
  });

  it("éxito e info usan role=status (no interrumpen al lector de pantalla)", () => {
    montar();
    clic("exito");
    clic("info");
    const avisos = screen.getAllByRole("status");
    expect(avisos.map((a) => a.textContent)).toEqual(["Listo", "Para tu información"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("se cierra solo a los 5 segundos", () => {
    montar();
    clic("info");
    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.getByText("Para tu información")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Para tu información")).not.toBeInTheDocument();
  });

  it("se puede cerrar a mano antes de tiempo", () => {
    montar();
    clic("error");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificación" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("muestra como máximo 4 a la vez (se van los más viejos)", () => {
    montar();
    for (let i = 0; i < 6; i++) clic("error");
    expect(screen.getAllByRole("alert")).toHaveLength(4);
  });

  it("useToast() fuera del provider avisa con un error claro", () => {
    // React loguea el error del render; se silencia para no ensuciar la salida.
    const silenciar = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Disparador />)).toThrow("useToast debe usarse dentro de <ToastProvider>");
    silenciar.mockRestore();
  });
});
