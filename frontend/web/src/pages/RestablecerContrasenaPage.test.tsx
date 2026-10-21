// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthError,
  getUsuarioActual,
  guardarTokens,
  hayTokenGuardado,
  restablecerContrasena,
  type Usuario,
} from "@ojoalgasto/shared";
import { App } from "../App";

// Se monta el App real para probar también que App.tsx conecta la pantalla
// con restablecerContrasena() (CH-07). Solo se simula la red.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, restablecerContrasena: vi.fn(), getUsuarioActual: vi.fn() };
});
const restablecerMock = vi.mocked(restablecerContrasena);

const POLITICA = "La contraseña debe tener al menos 8 caracteres, una letra y un número.";
const USUARIO: Usuario = {
  id: "1",
  nombre: "Ana",
  correo: "ana@ejemplo.com",
  rol: "titular",
  organizacion_id: "org-1",
  plan: "gratuito",
};

function jwtVigente(): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 1800 })}.firma`;
}

function montar(ruta = "/restablecer-contrasena?token=MQ.abc-123") {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <App />
    </MemoryRouter>,
  );
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta) as HTMLInputElement;
const boton = () => screen.getByRole("button", { name: /Cambiar contraseña|Guardando/ });

async function cambiar(password: string, confirmacion = password) {
  fireEvent.change(campo("Nueva contraseña"), { target: { value: password } });
  fireEvent.change(campo("Repite la contraseña"), { target: { value: confirmacion } });
  await act(async () => {
    fireEvent.click(boton());
  });
}

const enlaceNuevo = () => screen.getByRole("link", { name: /Pedir un enlace nuevo|Ir a recuperación/ });

beforeEach(() => {
  localStorage.clear();
  restablecerMock.mockReset();
  restablecerMock.mockResolvedValue(undefined);
  vi.mocked(getUsuarioActual).mockReset();
  vi.mocked(getUsuarioActual).mockResolvedValue(USUARIO);
});

afterEach(() => {
  cleanup();
});

describe("Restablecer contraseña: enlace válido (CH-07)", () => {
  it("lee el token del enlace, cambia la contraseña y termina en el Login con confirmación", async () => {
    montar();
    expect(screen.queryByText("Esta función todavía no está disponible.")).not.toBeInTheDocument();

    await cambiar("nueva 1234");

    expect(restablecerMock).toHaveBeenCalledWith("MQ.abc-123", "nueva 1234");
    expect(screen.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeInTheDocument();
    expect(screen.getByText("Contraseña actualizada. Inicia sesión con tu contraseña nueva.")).toBeInTheDocument();
  });

  it("si había una sesión abierta, se borra (el backend la revocó) y aun así termina en el Login", async () => {
    guardarTokens({ access_token: jwtVigente(), refresh_token: "refresh" });
    montar();
    await cambiar("nueva 1234");

    expect(hayTokenGuardado()).toBe(false);
    expect(screen.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeInTheDocument();
  });

  it("valida con la misma política que el backend antes de enviar", async () => {
    montar();
    await cambiar("abcdefgh");

    expect(restablecerMock).not.toHaveBeenCalled();
    expect(campo("Nueva contraseña")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(POLITICA)).toBeInTheDocument();
  });

  it("contraseñas distintas: error bajo la confirmación y no se envía", async () => {
    montar();
    await cambiar("nueva 1234", "nueva 12345");

    expect(restablecerMock).not.toHaveBeenCalled();
    expect(screen.getByText("Las contraseñas no coinciden.")).toBeInTheDocument();
  });

  it("si el backend rechaza la contraseña, su mensaje sale bajo el campo y se puede corregir", async () => {
    restablecerMock.mockRejectedValueOnce(new AuthError(POLITICA, 400, { campos: { password: [POLITICA] } }));
    montar();
    await cambiar("nueva 1234");

    expect(screen.getByText(POLITICA)).toBeInTheDocument();
    expect(boton()).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Restablecer contraseña" })).toBeInTheDocument();
  });

  it("un 503 no deja la pantalla trabada: muestra el aviso y permite reintentar", async () => {
    restablecerMock.mockRejectedValueOnce(
      new AuthError("No se pudo restablecer la contraseña. Inténtalo nuevamente.", 503),
    );
    montar();
    await cambiar("nueva 1234");

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo restablecer la contraseña.");
    expect(boton()).toBeEnabled();

    await act(async () => {
      fireEvent.click(boton());
    });
    expect(restablecerMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeInTheDocument();
  });

  it("sin red avisa que no se pudo conectar", async () => {
    restablecerMock.mockRejectedValue(new TypeError("Failed to fetch"));
    montar();
    await cambiar("nueva 1234");

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor");
  });

  it("dos envíos seguidos cambian la contraseña una sola vez", async () => {
    montar();
    fireEvent.change(campo("Nueva contraseña"), { target: { value: "nueva 1234" } });
    fireEvent.change(campo("Repite la contraseña"), { target: { value: "nueva 1234" } });
    const formulario = boton().closest("form") as HTMLFormElement;
    fireEvent.submit(formulario);
    fireEvent.submit(formulario);
    await act(async () => {});

    expect(restablecerMock).toHaveBeenCalledTimes(1);
  });
});

describe("Restablecer contraseña: enlace que no sirve (CH-07)", () => {
  it.each([
    ["token_expirado", 410, "El enlace venció. Solicita uno nuevo.", "Enlace vencido"],
    ["token_usado", 410, "El enlace ya fue utilizado. Solicita uno nuevo.", "Enlace ya utilizado"],
    ["token_invalido", 400, "El enlace no es válido. Solicita uno nuevo.", "Enlace inválido"],
  ])("code=%s (%i) muestra '%s' con salida a una solicitud nueva", async (codigo, status, detalle, titulo) => {
    restablecerMock.mockRejectedValue(new AuthError(detalle, status, { codigo }));
    montar();
    await cambiar("nueva 1234");

    expect(screen.getByRole("heading", { name: titulo })).toBeInTheDocument();
    expect(enlaceNuevo()).toHaveAttribute("href", "/recuperar-contrasena");
    expect(screen.getByRole("link", { name: "Volver al inicio de sesión" })).toHaveAttribute("href", "/login");
  });

  it("sin token en la URL muestra 'Enlace inválido' de entrada y no llama al backend", () => {
    montar("/restablecer-contrasena");

    expect(screen.getByRole("heading", { name: "Enlace inválido" })).toBeInTheDocument();
    expect(enlaceNuevo()).toHaveAttribute("href", "/recuperar-contrasena");
    expect(restablecerMock).not.toHaveBeenCalled();
  });

  it("un enlace vencido no altera una sesión abierta", async () => {
    guardarTokens({ access_token: jwtVigente(), refresh_token: "refresh" });
    restablecerMock.mockRejectedValue(new AuthError("El enlace venció.", 410, { codigo: "token_expirado" }));
    montar();
    await cambiar("nueva 1234");

    expect(screen.getByRole("heading", { name: "Enlace vencido" })).toBeInTheDocument();
    expect(hayTokenGuardado()).toBe(true);
  });

  it("'Pedir un enlace nuevo' lleva a la pantalla de recuperación", async () => {
    restablecerMock.mockRejectedValue(new AuthError("El enlace venció.", 410, { codigo: "token_expirado" }));
    montar();
    await cambiar("nueva 1234");

    fireEvent.click(enlaceNuevo());
    expect(screen.getByRole("heading", { name: "Recuperar contraseña" })).toBeInTheDocument();
  });
});
