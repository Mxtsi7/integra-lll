// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BarraSuperior } from "./BarraSuperior";

function Ruta() {
  return <p data-testid="ruta">{useLocation().pathname}</p>;
}

function montar(avisos: number, desde = "/home") {
  const barra = (
    <>
      <BarraSuperior nombreUsuario="Ana" plan="Plan Gratuito" avisos={avisos} alCerrarSesion={() => {}} />
      <Ruta />
    </>
  );
  const router = createMemoryRouter(
    [
      { path: "/home", element: barra },
      { path: "/dashboard", element: barra },
      { path: "/configuracion", element: barra },
    ],
    { initialEntries: [desde] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  cleanup();
});

describe("BarraSuperior: la campana abre los ajustes de avisos", () => {
  it.each([
    [0, null, null],
    [3, "3", "3 cosas piden atención"],
    [1, "1", "1 cosa pide atención"],
    [12, "9+", "12 cosas piden atención"],
  ])("con %i avisos va a /configuracion y se llama «Configurar notificaciones»", (avisos, insignia, descripcion) => {
    montar(avisos);
    const campana = screen.getByRole("link", { name: "Configurar notificaciones" });
    expect(campana).toHaveAttribute("href", "/configuracion");
    // El número es información aparte: no se anuncia como notificaciones sin leer.
    if (descripcion === null) {
      expect(campana).not.toHaveAttribute("aria-describedby");
      expect(campana).toHaveAttribute("title", "Configurar notificaciones");
    } else {
      expect(campana).toHaveAccessibleDescription(descripcion);
      expect(campana).toHaveAttribute("title", `Configurar notificaciones · ${descripcion}`);
      expect(campana).toHaveTextContent(insignia ?? "");
    }
    expect(screen.queryByRole("link", { name: /Panel/ })).not.toBeInTheDocument();
  });

  it("al pulsarla deja de llevar al Panel", () => {
    const router = montar(3, "/dashboard");
    fireEvent.click(screen.getByRole("link", { name: "Configurar notificaciones" }));
    expect(screen.getByTestId("ruta")).toHaveTextContent("/configuracion");
    expect(router.state.location.pathname).toBe("/configuracion");
  });
});
