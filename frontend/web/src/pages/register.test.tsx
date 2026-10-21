// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, register } from "@ojoalgasto/shared";
import { ToastProvider } from "../context/ToastContext";
import Register from "./register";

// Solo se simula la llamada de red; la validación es la real de shared.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, register: vi.fn() };
});
const registerMock = vi.mocked(register);

const POLITICA = "La contraseña debe tener al menos 8 caracteres, una letra y un número.";

function montar() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <Register />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta) as HTMLInputElement;
const escribir = (etiqueta: string, valor: string) => fireEvent.change(campo(etiqueta), { target: { value: valor } });
const enviar = () => fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

function llenarValido() {
  escribir("Nombre", "  Ana  ");
  escribir("Correo electrónico", " ana@ejemplo.com ");
  escribir("Contraseña", "clave 1234");
  escribir("Repite la contraseña", "clave 1234");
  fireEvent.click(screen.getByRole("checkbox"));
}

beforeEach(() => {
  registerMock.mockReset();
  registerMock.mockResolvedValue({ id: 1, email: "ana@ejemplo.com", nombre: "Ana" });
});

afterEach(() => {
  cleanup();
});

describe("Registro: validación antes de enviar (CH-04)", () => {
  it("con el formulario vacío no envía y marca cada campo", () => {
    montar();
    enviar();

    expect(registerMock).not.toHaveBeenCalled();
    expect(campo("Nombre")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Ingresa tu nombre.")).toBeInTheDocument();
    expect(screen.getByText("Ingresa tu correo electrónico.")).toBeInTheDocument();
    expect(screen.getByText(POLITICA)).toBeInTheDocument();
    expect(screen.getByText("Repite la contraseña.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Debes aceptar el tratamiento de tus datos.")).toBeInTheDocument();
    // El foco va al primer campo con error.
    expect(document.activeElement).toBe(campo("Nombre"));
  });

  it.each([
    ["abcdefgh", "sin número"],
    ["12345678", "sin letra"],
    ["abc1234", "7 caracteres"],
    ["😀😀😀a1", "5 caracteres aunque .length de JS diga 8"],
  ])("contraseña %j (%s) se rechaza igual que en el backend", (password) => {
    montar();
    llenarValido();
    escribir("Contraseña", password);
    escribir("Repite la contraseña", password);
    enviar();

    expect(registerMock).not.toHaveBeenCalled();
    expect(campo("Contraseña")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(POLITICA)).toBeInTheDocument();
  });

  it("correo mal formado y contraseñas distintas, cada uno bajo su campo", () => {
    montar();
    llenarValido();
    escribir("Correo electrónico", "ana@ejemplo");
    escribir("Repite la contraseña", "otra 1234");
    enviar();

    expect(registerMock).not.toHaveBeenCalled();
    expect(screen.getByText("Ingresa un correo electrónico válido.")).toBeInTheDocument();
    expect(screen.getByText("Las contraseñas no coinciden.")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo("Correo electrónico"));
  });

  it("al corregir un campo se borra su error", () => {
    montar();
    enviar();
    escribir("Nombre", "Ana");
    expect(screen.queryByText("Ingresa tu nombre.")).not.toBeInTheDocument();
    expect(screen.getByText("Ingresa tu correo electrónico.")).toBeInTheDocument();
  });

  it("con todo válido envía una vez, sin recortar la contraseña", async () => {
    montar();
    llenarValido();
    // Dos envíos seguidos (doble clic o Enter repetido): solo uno llega a la API.
    const formulario = screen.getByRole("button", { name: "Crear cuenta" }).closest("form") as HTMLFormElement;
    fireEvent.submit(formulario);
    fireEvent.submit(formulario);

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith({
      nombre: "Ana",
      correo: "ana@ejemplo.com",
      password: "clave 1234",
      aceptaDatos: true,
    });
    expect(await screen.findByRole("heading", { name: "Cuenta creada" })).toBeInTheDocument();
  });
});

describe("Registro: errores del servidor (el backend es la validación definitiva)", () => {
  it("un error por campo del backend aparece bajo ese campo y no se pierde lo escrito", async () => {
    registerMock.mockRejectedValue(
      new AuthError("user with this email already exists.", 400, {
        campos: { email: ["user with this email already exists."] },
      }),
    );
    montar();
    llenarValido();
    await act(async () => enviar());

    expect(screen.getByText("user with this email already exists.")).toBeInTheDocument();
    expect(campo("Correo electrónico")).toHaveAttribute("aria-invalid", "true");
    // (un input type="email" recorta los espacios por especificación HTML)
    expect(campo("Correo electrónico")).toHaveValue("ana@ejemplo.com");
    expect(document.activeElement).toBe(campo("Correo electrónico"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // no hace falta toast
  });

  it("si el backend rechaza la contraseña, su mensaje sale bajo el campo", async () => {
    registerMock.mockRejectedValue(new AuthError(POLITICA, 400, { campos: { password: [POLITICA] } }));
    montar();
    llenarValido();
    await act(async () => enviar());

    expect(campo("Contraseña")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(POLITICA)).toBeInTheDocument();
  });

  it("un error que no es de ningún campo del formulario sale en un toast", async () => {
    registerMock.mockRejectedValue(
      new AuthError("El código de organización no es válido.", 400, {
        campos: { codigo_organizacion: ["El código de organización no es válido."] },
      }),
    );
    montar();
    llenarValido();
    await act(async () => enviar());

    expect(screen.getByRole("alert")).toHaveTextContent("El código de organización no es válido.");
  });

  it("un error del servidor sin campos (500) sale en un toast y se puede reintentar", async () => {
    registerMock.mockRejectedValueOnce(new AuthError("Error interno", 500));
    montar();
    llenarValido();
    await act(async () => enviar());

    expect(screen.getByRole("alert")).toHaveTextContent("Error interno");
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeEnabled();

    await act(async () => enviar());
    expect(registerMock).toHaveBeenCalledTimes(2);
  });

  it("sin red avisa que no se pudo conectar", async () => {
    registerMock.mockRejectedValue(new TypeError("Failed to fetch"));
    montar();
    llenarValido();
    await act(async () => enviar());

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo conectar con el servidor");
  });
});

describe("Registro: ver/ocultar contraseña (CH-05)", () => {
  it("cada campo de contraseña tiene su botón y alternarlo no envía el formulario", () => {
    montar();
    const botonClave = within(campo("Contraseña").parentElement as HTMLElement).getByRole("button", {
      name: "Mostrar contraseña",
    });
    const botonConfirmacion = within(campo("Repite la contraseña").parentElement as HTMLElement).getByRole(
      "button",
      { name: "Mostrar contraseña" },
    );

    fireEvent.click(botonClave);
    expect(campo("Contraseña")).toHaveAttribute("type", "text");
    expect(campo("Repite la contraseña")).toHaveAttribute("type", "password");
    fireEvent.click(botonConfirmacion);
    expect(campo("Repite la contraseña")).toHaveAttribute("type", "text");

    expect(registerMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Ingresa tu nombre.")).not.toBeInTheDocument(); // no hubo submit
  });
});
