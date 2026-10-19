// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actualizarSuscripcion,
  crearSuscripcion,
  ErrorDeApi,
  getSuscripciones,
  type Suscripcion,
} from "@ojoalgasto/shared";
import { ToastProvider } from "../context/ToastContext";
import { AuthProvider } from "../context/AuthContext";
import Homepage from "./Homepage";

// Solo se simula la red; la página, los formularios y el modal son reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return {
    ...real,
    getSuscripciones: vi.fn(),
    crearSuscripcion: vi.fn(),
    actualizarSuscripcion: vi.fn(),
  };
});

const SPOTIFY: Suscripcion = {
  id: "s1",
  nombre: "Spotify",
  monto: 5990,
  moneda: "CLP",
  frecuencia: "mensual",
  fecha_proximo_cobro: "2026-11-10",
  categoria: "musica",
  estado: "activo",
};

async function montar() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <Homepage />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {}); // carga inicial de la lista
}

const dialogo = () => screen.queryByRole("dialog");
const aviso = () => screen.queryByText("Tienes cambios sin guardar. Si cierras ahora, se pierden.");
const enDialogo = () => within(screen.getByRole("dialog"));

function abrirNueva() {
  fireEvent.click(screen.getByRole("button", { name: "Agregar suscripción" }));
}

function abrirEdicion() {
  fireEvent.click(screen.getByRole("button", { name: "Editar Spotify" }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getSuscripciones).mockReset().mockResolvedValue([SPOTIFY]);
  vi.mocked(crearSuscripcion).mockReset();
  vi.mocked(actualizarSuscripcion).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Cambios sin guardar al crear (CH-16)", () => {
  it("un formulario limpio se cierra sin aviso", async () => {
    await montar();
    abrirNueva();
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));

    expect(aviso()).not.toBeInTheDocument();
    expect(dialogo()).not.toBeInTheDocument();
  });

  it("con cambios, Cancelar muestra el aviso y no cierra ni pierde lo escrito", async () => {
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));

    expect(aviso()).toBeInTheDocument();
    expect(dialogo()).toBeInTheDocument();
    expect(enDialogo().getByLabelText("Servicio")).toHaveValue("Netflix");
    // El foco va a la opción que no pierde nada.
    expect(document.activeElement).toBe(enDialogo().getByRole("button", { name: "Seguir editando" }));
  });

  it("'Seguir editando' vuelve al formulario con todo lo escrito", async () => {
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    const cancelar = enDialogo().getByRole("button", { name: "Cancelar" });
    cancelar.focus();
    fireEvent.click(cancelar);
    fireEvent.click(enDialogo().getByRole("button", { name: "Seguir editando" }));

    expect(aviso()).not.toBeInTheDocument();
    expect(dialogo()).toBeInTheDocument();
    expect(enDialogo().getByLabelText("Servicio")).toHaveValue("Netflix");
    expect(document.activeElement).toBe(cancelar); // el foco vuelve a donde estaba
  });

  it("'Descartar cambios' cierra, y al volver a abrir el formulario está vacío", async () => {
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));
    fireEvent.click(enDialogo().getByRole("button", { name: "Descartar cambios" }));

    expect(dialogo()).not.toBeInTheDocument();
    abrirNueva();
    expect(enDialogo().getByLabelText("Servicio")).toHaveValue("");
    expect(aviso()).not.toBeInTheDocument();
  });

  it.each([
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
    ["la X", () => fireEvent.click(enDialogo().getByRole("button", { name: "Cerrar" }))],
  ])("con cambios, cerrar con %s también pregunta", async (_, cerrar) => {
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "100" } });
    cerrar();

    expect(aviso()).toBeInTheDocument();
    expect(dialogo()).toBeInTheDocument();
  });

  it("volver a dejar el campo como estaba cuenta como sin cambios", async () => {
    await montar();
    abrirNueva();
    const servicio = enDialogo().getByLabelText("Servicio");
    fireEvent.change(servicio, { target: { value: "Netflix" } });
    fireEvent.change(servicio, { target: { value: "" } });
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));

    expect(aviso()).not.toBeInTheDocument();
    expect(dialogo()).not.toBeInTheDocument();
  });

  it("escribir no le quita el foco al campo (el modal no se re-enfoca)", async () => {
    await montar();
    abrirNueva();
    const monto = enDialogo().getByLabelText("Monto");
    monto.focus();
    fireEvent.change(monto, { target: { value: "1" } });
    expect(document.activeElement).toBe(monto);
  });

  it("después de guardar ya no hay aviso: el estado se limpia", async () => {
    vi.mocked(crearSuscripcion).mockResolvedValue({ ...SPOTIFY, id: "s2", nombre: "Netflix" });
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "9990" } });
    fireEvent.change(enDialogo().getByLabelText("Próximo cobro"), { target: { value: "2026-11-05" } });
    await act(async () => {
      fireEvent.click(enDialogo().getByRole("button", { name: "Guardar suscripción" }));
    });

    expect(dialogo()).not.toBeInTheDocument();
    const salir = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(salir);
    expect(salir.defaultPrevented).toBe(false);
  });

  it("con cambios, cerrar o recargar la pestaña pide confirmación; sin cambios, no", async () => {
    await montar();
    abrirNueva();
    const limpio = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(limpio);
    expect(limpio.defaultPrevented).toBe(false);

    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    const conCambios = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(conCambios);
    expect(conCambios.defaultPrevented).toBe(true);
  });
});

describe("Cambios sin guardar al editar (CH-16)", () => {
  it("sin tocar nada se cierra sin aviso", async () => {
    await montar();
    abrirEdicion();
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));
    expect(dialogo()).not.toBeInTheDocument();
  });

  it("con cambios pregunta; descartar no guarda nada", async () => {
    await montar();
    abrirEdicion();
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "6990" } });
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));

    expect(aviso()).toBeInTheDocument();
    fireEvent.click(enDialogo().getByRole("button", { name: "Descartar cambios" }));

    expect(dialogo()).not.toBeInTheDocument();
    expect(actualizarSuscripcion).not.toHaveBeenCalled();
  });
});

describe("Errores del servidor al crear llegan al formulario (CH-09)", () => {
  it("un 400 del backend se muestra junto al campo correcto", async () => {
    vi.mocked(crearSuscripcion).mockRejectedValue(
      new ErrorDeApi("El monto debe ser mayor a 0.", 400, { monto: ["El monto debe ser mayor a 0."] }),
    );
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "9990" } });
    fireEvent.change(enDialogo().getByLabelText("Próximo cobro"), { target: { value: "2026-11-05" } });
    await act(async () => {
      fireEvent.click(enDialogo().getByRole("button", { name: "Guardar suscripción" }));
    });

    expect(enDialogo().getByLabelText("Monto")).toHaveAttribute("aria-invalid", "true");
    expect(enDialogo().getByText("El monto debe ser mayor a 0.")).toBeInTheDocument();
  });
});
