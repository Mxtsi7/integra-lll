// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, solicitarRecuperacion } from "@ojoalgasto/shared";
import { App } from "../App";

// Se monta el App real: así también se prueba que App.tsx conecta la
// pantalla con solicitarRecuperacion() (CH-06). Solo se simula la red.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, solicitarRecuperacion: vi.fn(), getUsuarioActual: vi.fn() };
});
const solicitarMock = vi.mocked(solicitarRecuperacion);

const NEUTRO = { detail: "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña." };

function montar() {
  render(
    <MemoryRouter initialEntries={["/recuperar-contrasena"]}>
      <App />
    </MemoryRouter>,
  );
}

const correo = () => screen.getByLabelText("Correo electrónico") as HTMLInputElement;
const boton = () => screen.getByRole("button", { name: /Enviar enlace|Enviando/ });

async function pedir(email: string) {
  fireEvent.change(correo(), { target: { value: email } });
  await act(async () => {
    fireEvent.click(boton());
  });
}

/** Texto de la confirmación con el correo reemplazado, para compararlas. */
const confirmacionSinCorreo = (email: string) =>
  (screen.getByRole("status").textContent ?? "").replace(email, "<correo>");

beforeEach(() => {
  localStorage.clear();
  solicitarMock.mockReset();
  solicitarMock.mockResolvedValue(NEUTRO);
});

afterEach(() => {
  cleanup();
});

describe("Solicitar recuperación de contraseña (CH-06)", () => {
  it("está conectada al backend: no muestra 'no disponible'", () => {
    montar();
    expect(screen.queryByText("Esta función todavía no está disponible.")).not.toBeInTheDocument();
    expect(boton()).toBeEnabled();
  });

  it("un correo con cuenta y uno sin cuenta muestran la misma confirmación", async () => {
    // El backend responde igual en ambos casos; la pantalla no puede distinguir.
    montar();
    await pedir("existe@ejemplo.com");
    const conCuenta = confirmacionSinCorreo("existe@ejemplo.com");
    cleanup();

    montar();
    await pedir("noexiste@ejemplo.com");
    const sinCuenta = confirmacionSinCorreo("noexiste@ejemplo.com");

    expect(conCuenta).toBe(sinCuenta);
    expect(conCuenta).toContain("Si hay una cuenta con <correo>");
  });

  it("envía una sola vez el correo sin espacios, aunque se envíe dos veces seguidas", async () => {
    montar();
    fireEvent.change(correo(), { target: { value: "ana@ejemplo.com" } });
    const formulario = boton().closest("form") as HTMLFormElement;
    // Dos eventos separados, como un doble clic o Enter repetido en el navegador.
    fireEvent.submit(formulario);
    fireEvent.submit(formulario);
    await act(async () => {});

    expect(solicitarMock).toHaveBeenCalledTimes(1);
    expect(solicitarMock).toHaveBeenCalledWith("ana@ejemplo.com");
  });

  it("mientras espera muestra 'Enviando…' con el botón deshabilitado", async () => {
    let responder: () => void = () => {};
    solicitarMock.mockReturnValue(new Promise((r) => (responder = () => r(NEUTRO))));
    montar();
    fireEvent.change(correo(), { target: { value: "ana@ejemplo.com" } });
    fireEvent.click(boton());

    expect(boton()).toHaveTextContent("Enviando…");
    expect(boton()).toBeDisabled();

    await act(async () => responder());
    expect(screen.getByRole("heading", { name: "Revisa tu correo" })).toBeInTheDocument();
  });

  it("sin red avisa en español, deja el formulario usable y permite reintentar", async () => {
    solicitarMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    montar();
    await pedir("ana@ejemplo.com");

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor");
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(correo()).toBeEnabled();
    expect(correo()).toHaveValue("ana@ejemplo.com");
    expect(boton()).toBeEnabled();

    await act(async () => {
      fireEvent.click(boton());
    });
    expect(solicitarMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Revisa tu correo" })).toBeInTheDocument();
  });

  it("un 400 del backend muestra su mensaje del campo email", async () => {
    solicitarMock.mockRejectedValue(
      new AuthError("Introduzca una dirección de correo electrónico válida.", 400, {
        campos: { email: ["Introduzca una dirección de correo electrónico válida."] },
      }),
    );
    montar();
    await pedir("ana@ejemplo.com");

    // Es un error del campo: queda asociado a él y el foco vuelve ahí (CH-25).
    expect(correo()).toHaveAttribute("aria-invalid", "true");
    expect(correo()).toHaveAccessibleDescription("Introduzca una dirección de correo electrónico válida.");
    await waitFor(() => expect(correo()).toHaveFocus());
    expect(boton()).toBeEnabled();
  });

  it("un correo mal formado no se envía", async () => {
    montar();
    await pedir("ana@");

    expect(solicitarMock).not.toHaveBeenCalled();
    expect(correo()).toHaveAttribute("aria-invalid", "true");
    expect(correo()).toHaveAccessibleDescription("Ingresa un correo electrónico válido.");
    await waitFor(() => expect(correo()).toHaveFocus());
    // Al corregirlo, el error se va.
    fireEvent.change(correo(), { target: { value: "ana@ejemplo.com" } });
    expect(correo()).not.toHaveAttribute("aria-invalid");
  });

  it("vacío dice que falta el correo, en el campo (CH-25)", async () => {
    montar();
    await pedir("");
    expect(correo()).toHaveAccessibleDescription("Ingresa tu correo electrónico.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("'Usar otro correo' vuelve al formulario", async () => {
    montar();
    await pedir("ana@ejemplo.com");
    fireEvent.click(screen.getByRole("button", { name: "Usar otro correo" }));
    expect(screen.getByRole("heading", { name: "Recuperar contraseña" })).toBeInTheDocument();
  });
});
