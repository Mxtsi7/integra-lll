// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getContadorAlertas } from "@ojoalgasto/shared";
import { ContadorAlertasProvider } from "../../context/ContadorAlertasContext";
import { BarraSuperior } from "./BarraSuperior";

vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getContadorAlertas: vi.fn() };
});

function Ruta() {
  return <p data-testid="ruta">{useLocation().pathname}</p>;
}

/** Con `pendientes` null se monta sin provider, como en las pruebas de una página suelta. */
async function montar(pendientes: number | null, desde = "/home") {
  vi.mocked(getContadorAlertas).mockResolvedValue({ pendientes: pendientes ?? 0, total: 20 });
  const barra = (
    <>
      <BarraSuperior nombreUsuario="Ana" plan="Plan Gratuito" alCerrarSesion={() => {}} />
      <Ruta />
    </>
  );
  const router = createMemoryRouter(
    [
      { path: "/home", element: barra },
      { path: "/dashboard", element: barra },
      { path: "/alertas", element: barra },
    ],
    { initialEntries: [desde] },
  );
  const arbol = <RouterProvider router={router} />;
  render(pendientes === null ? arbol : <ContadorAlertasProvider>{arbol}</ContadorAlertasProvider>);
  await act(async () => {});
  return router;
}

beforeEach(() => {
  vi.mocked(getContadorAlertas).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("BarraSuperior: la campana abre el Centro de alertas (CH-31)", () => {
  it.each([
    [0, null, null],
    [3, "3", "3 alertas sin leer"],
    [1, "1", "1 alerta sin leer"],
    [12, "9+", "12 alertas sin leer"],
  ])("con %i sin leer va a /alertas y se llama «Alertas»", async (pendientes, insignia, descripcion) => {
    await montar(pendientes);
    const campana = screen.getByRole("link", { name: "Alertas" });
    expect(campana).toHaveAttribute("href", "/alertas");
    // El número no cambia el nombre: va como descripción.
    if (descripcion === null) {
      expect(campana).not.toHaveAttribute("aria-describedby");
      expect(campana).toHaveAttribute("title", "Alertas");
      expect(campana).toHaveTextContent("");
    } else {
      expect(campana).toHaveAccessibleDescription(descripcion);
      expect(campana).toHaveAttribute("title", `Alertas · ${descripcion}`);
      expect(campana).toHaveTextContent(insignia ?? "");
    }
  });

  it("sin el provider (todavía no se sabe) va sin número", async () => {
    await montar(null);
    const campana = screen.getByRole("link", { name: "Alertas" });
    expect(campana).not.toHaveAttribute("aria-describedby");
    expect(campana).toHaveTextContent("");
    expect(getContadorAlertas).not.toHaveBeenCalled();
  });

  it("si el contador falla, va sin número y sin error a la vista", async () => {
    vi.mocked(getContadorAlertas).mockRejectedValue(new TypeError("Failed to fetch"));
    const router = createMemoryRouter([{ path: "/home", element: <BarraSuperior nombreUsuario="Ana" plan="Plan Gratuito" alCerrarSesion={() => {}} /> }], {
      initialEntries: ["/home"],
    });
    render(
      <ContadorAlertasProvider>
        <RouterProvider router={router} />
      </ContadorAlertasProvider>,
    );
    await act(async () => {});
    expect(screen.getByRole("link", { name: "Alertas" })).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("al pulsarla lleva al Centro de alertas", async () => {
    const router = await montar(3, "/dashboard");
    fireEvent.click(screen.getByRole("link", { name: "Alertas" }));
    expect(screen.getByTestId("ruta")).toHaveTextContent("/alertas");
    expect(router.state.location.pathname).toBe("/alertas");
  });
});
