// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalogosSuscripciones, type Suscripcion } from "@ojoalgasto/shared";
import { CatalogosProvider } from "../../context/CatalogosContext";
import TarjetaSuscripcion from "./TarjetaSuscripcion";

vi.mock("@ojoalgasto/shared", async (original) => ({
  ...(await original<typeof import("@ojoalgasto/shared")>()),
  getCatalogosSuscripciones: vi.fn(),
}));

const sus = (estado: Suscripcion["estado"]): Suscripcion => ({
  id: "s1",
  nombre: "Chatgpt",
  monto: 16990,
  moneda: "CLP",
  frecuencia: "mensual",
  categoria: "ia",
  estado,
  fecha_proximo_cobro: "2026-11-09",
});

function montar(props: Partial<React.ComponentProps<typeof TarjetaSuscripcion>> = {}) {
  const acciones = {
    onClick: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onCambiarSeguimiento: vi.fn(),
  };
  render(
    <MemoryRouter>
      <CatalogosProvider>
        <ul>
          <TarjetaSuscripcion suscripcion={sus("activo")} {...acciones} {...props} />
        </ul>
      </CatalogosProvider>
    </MemoryRouter>,
  );
  return acciones;
}

const interruptor = () => screen.getByRole("switch", { name: "Seguimiento de cobros de Chatgpt" });

beforeEach(() => {
  vi.mocked(getCatalogosSuscripciones).mockReset().mockReturnValue(new Promise(() => {}));
});
afterEach(cleanup);

describe("TarjetaSuscripcion: el interruptor de seguimiento", () => {
  // Encendido = la seguimos contando. Solo una cancelada está apagada; los
  // otros estados conservan su etiqueta y no se igualan a "Activa".
  it.each([
    ["activo", "true", "Activa"],
    ["fantasma", "true", "Sin uso"],
    ["prueba", "true", "Prueba gratis"],
    ["por_confirmar", "true", "Por confirmar"],
    ["cancelado", "false", "Cancelada"],
  ] as const)("%s: aria-checked=%s y la etiqueta «%s»", (estado, encendido, etiqueta) => {
    montar({ suscripcion: sus(estado) });
    const control = interruptor();
    expect(control.tagName).toBe("BUTTON");
    expect(control).toHaveAttribute("type", "button");
    expect(control).toHaveAttribute("aria-checked", encendido);
    // El nombre no cambia con el estado; la etiqueta exacta se ve y se anuncia aparte.
    expect(control).toHaveAccessibleDescription(etiqueta);
    expect(screen.getByText(etiqueta)).toBeVisible();
  });

  it("pulsarlo solo pide cambiar el seguimiento: no abre el detalle", () => {
    const acciones = montar();
    fireEvent.click(interruptor());
    expect(acciones.onCambiarSeguimiento).toHaveBeenCalledTimes(1);
    expect(acciones.onCambiarSeguimiento).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
    expect(acciones.onClick).not.toHaveBeenCalled();
    expect(acciones.onEdit).not.toHaveBeenCalled();
    expect(acciones.onDelete).not.toHaveBeenCalled();
  });

  it("abrir, editar y eliminar siguen siendo acciones aparte", () => {
    const acciones = montar();
    fireEvent.click(screen.getByRole("button", { name: "Ver Chatgpt" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Chatgpt" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Chatgpt" }));
    expect(acciones.onClick).toHaveBeenCalledTimes(1);
    expect(acciones.onEdit).toHaveBeenCalledTimes(1);
    expect(acciones.onDelete).toHaveBeenCalledTimes(1);
    expect(acciones.onCambiarSeguimiento).not.toHaveBeenCalled();
  });

  it("no hay controles anidados: el interruptor no vive dentro del botón que abre el detalle", () => {
    montar();
    const controles = [...screen.getAllByRole("button"), interruptor()];
    for (const control of controles) {
      for (const otro of controles) {
        if (otro !== control) expect(control.contains(otro)).toBe(false);
      }
    }
  });

  it("mientras se guarda dice «Guardando…» y bloquea interruptor, editar y eliminar de esa tarjeta", () => {
    const acciones = montar({ isChangingState: true });
    const control = interruptor();
    // aria-disabled y no disabled: el foco se queda en el interruptor.
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("aria-busy", "true");
    expect(control).toHaveAccessibleDescription("Guardando…");
    fireEvent.click(control);
    expect(acciones.onCambiarSeguimiento).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Editar Chatgpt" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar Chatgpt" })).toBeDisabled();
    // Ver el detalle sigue disponible.
    fireEvent.click(screen.getByRole("button", { name: "Ver Chatgpt" }));
    expect(acciones.onClick).toHaveBeenCalledTimes(1);
  });

  it("sin la acción, muestra el estado como insignia, sin aspecto de interruptor", () => {
    render(
      <MemoryRouter>
        <CatalogosProvider>
          <ul>
            <TarjetaSuscripcion suscripcion={sus("fantasma")} />
          </ul>
        </CatalogosProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("Sin uso")).toBeInTheDocument();
    expect(document.querySelector("[class*=interruptor]")).toBeNull();
  });
});
