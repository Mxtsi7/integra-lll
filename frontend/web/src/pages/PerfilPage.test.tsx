// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actualizarNombre,
  cambiarContrasena,
  ErrorDeApi,
  getUsuarioActual,
  guardarTokens,
  hayTokenGuardado,
  MENSAJE_POLITICA_PASSWORD,
  type Usuario,
} from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { RutaPrivada } from "../components/RutaPrivada";
import { PerfilPage } from "./PerfilPage";

// Solo se simulan las llamadas de red. Tokens, sesión, validaciones y el
// redirect de <RutaPrivada> son los reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getUsuarioActual: vi.fn(), actualizarNombre: vi.fn(), cambiarContrasena: vi.fn() };
});
const getUsuarioActualMock = vi.mocked(getUsuarioActual);
const actualizarNombreMock = vi.mocked(actualizarNombre);
const cambiarContrasenaMock = vi.mocked(cambiarContrasena);

const USUARIO: Usuario = {
  id: "7",
  nombre: "Ana Pérez",
  correo: "ana@ejemplo.com",
  rol: "titular",
  organizacion_id: "org-1",
  plan: "gratuito",
};

function jwt(expEnMs: number): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(expEnMs / 1000) })}.firma`;
}

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

function Ubicacion() {
  return <div data-testid="ubicacion">{useLocation().pathname}</div>;
}

async function montar() {
  // Como main.tsx: StrictMode corre los efectos dos veces en desarrollo.
  render(
    <StrictMode>
      <MemoryRouter initialEntries={["/perfil"]}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<h1>Inicia sesión</h1>} />
              <Route element={<RutaPrivada />}>
                <Route path="/perfil" element={<PerfilPage />} />
              </Route>
            </Routes>
            <Ubicacion />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  await act(async () => {}); // /usuarios/me/ del contexto y de la página
}

const ubicacion = () => screen.getByTestId("ubicacion").textContent;
const tarjetaUsuario = () => screen.getByRole("heading", { level: 2, name: /Ana|Ani/ });
const barraSuperior = () => screen.getByRole("link", { name: /Plan/ });

beforeEach(() => {
  localStorage.clear();
  guardarTokens({ access_token: jwt(Date.now() + 30 * 60_000), refresh_token: "refresh" });
  getUsuarioActualMock.mockReset().mockResolvedValue(USUARIO);
  actualizarNombreMock.mockReset();
  cambiarContrasenaMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Editar nombre desde Perfil (CH-08)", () => {
  const editar = () => fireEvent.click(screen.getByRole("button", { name: "Editar nombre" }));
  const campoNombre = () => screen.getByLabelText("Nombre") as HTMLInputElement;
  const escribir = (valor: string) => fireEvent.change(campoNombre(), { target: { value: valor } });
  const guardar = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    });
  };

  it("guarda con PATCH y muestra lo que confirmó el backend, también en la barra superior", async () => {
    // El backend recorta los espacios: lo que se muestra es su respuesta.
    actualizarNombreMock.mockResolvedValue({ ...USUARIO, nombre: "Ani Pérez" });
    await montar();
    expect(within(barraSuperior()).getByText("Ana Pérez")).toBeInTheDocument();

    editar();
    expect(campoNombre()).toHaveValue("Ana Pérez");
    expect(campoNombre()).toHaveFocus();
    escribir("  Ani Pérez  ");
    await guardar();

    expect(actualizarNombreMock).toHaveBeenCalledTimes(1);
    expect(actualizarNombreMock).toHaveBeenCalledWith("  Ani Pérez  "); // shared lo recorta
    expect(tarjetaUsuario()).toHaveTextContent("Ani Pérez");
    expect(within(barraSuperior()).getByText("Ani Pérez")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Guardamos tu nombre.");
    // Se cerró la edición y el foco volvió al botón que la abrió.
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar nombre" })).toHaveFocus();
  });

  it("Cancelar no envía nada y conserva el último nombre confirmado", async () => {
    await montar();
    editar();
    escribir("Otro nombre");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(actualizarNombreMock).not.toHaveBeenCalled();
    expect(tarjetaUsuario()).toHaveTextContent("Ana Pérez");
    expect(screen.getByRole("button", { name: "Editar nombre" })).toHaveFocus();
    // Al volver a abrir parte del nombre confirmado, no de lo que se descartó.
    editar();
    expect(campoNombre()).toHaveValue("Ana Pérez");
  });

  it("Escape también cancela", async () => {
    await montar();
    editar();
    escribir("Otro nombre");
    fireEvent.keyDown(campoNombre(), { key: "Escape" });

    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
    expect(actualizarNombreMock).not.toHaveBeenCalled();
  });

  it("si el backend rechaza el nombre, el error va bajo el campo y se sigue viendo el confirmado", async () => {
    actualizarNombreMock.mockRejectedValue(
      new ErrorDeApi("Asegúrese de que este campo no tenga más de 150 caracteres.", 400, {
        nombre: ["Asegúrese de que este campo no tenga más de 150 caracteres."],
      }),
    );
    await montar();
    editar();
    escribir("Ana con un nombre que el backend no acepta");
    await guardar();

    expect(campoNombre()).toHaveAttribute("aria-invalid", "true");
    expect(campoNombre()).toHaveAccessibleDescription("Asegúrese de que este campo no tenga más de 150 caracteres.");
    expect(campoNombre()).toHaveValue("Ana con un nombre que el backend no acepta"); // para corregir
    expect(campoNombre()).toHaveFocus();
    expect(tarjetaUsuario()).toHaveTextContent("Ana Pérez");
    expect(within(barraSuperior()).getByText("Ana Pérez")).toBeInTheDocument();
  });

  it("sin conexión avisa y no cambia el nombre", async () => {
    actualizarNombreMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await montar();
    editar();
    escribir("Ani");
    await guardar();

    expect(campoNombre()).toHaveAccessibleDescription(
      "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
    );
    expect(tarjetaUsuario()).toHaveTextContent("Ana Pérez");
  });

  it("valida antes de enviar con las reglas del backend", async () => {
    await montar();
    editar();

    escribir("   ");
    await guardar();
    expect(campoNombre()).toHaveAccessibleDescription("Ingresa tu nombre.");

    escribir("a".repeat(151));
    await guardar();
    expect(campoNombre()).toHaveAccessibleDescription("El nombre puede tener hasta 150 caracteres.");

    expect(actualizarNombreMock).not.toHaveBeenCalled();
  });

  it("sin cambios (aunque tenga espacios alrededor) cierra sin llamar a la API", async () => {
    await montar();
    editar();
    escribir("  Ana Pérez ");
    await guardar();

    expect(actualizarNombreMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("dos envíos seguidos mandan un solo PATCH", async () => {
    const respuesta = diferida<Usuario>();
    actualizarNombreMock.mockReturnValue(respuesta.promesa);
    await montar();
    editar();
    escribir("Ani");
    const formulario = screen.getByRole("form", { name: "Editar nombre" });
    fireEvent.submit(formulario);
    fireEvent.submit(formulario);

    expect(actualizarNombreMock).toHaveBeenCalledTimes(1);
    await act(async () => respuesta.resolver({ ...USUARIO, nombre: "Ani" }));
    expect(tarjetaUsuario()).toHaveTextContent("Ani");
  });
});

describe("Cambiar contraseña desde Perfil (CH-29)", () => {
  const abrir = () => fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
  const dialogo = () => screen.getByRole("dialog", { name: "Cambiar contraseña" });
  const campo = (etiqueta: string) => within(dialogo()).getByLabelText(etiqueta) as HTMLInputElement;
  const escribir = (etiqueta: string, valor: string) => fireEvent.change(campo(etiqueta), { target: { value: valor } });
  const enviar = async () => {
    await act(async () => {
      fireEvent.click(within(dialogo()).getByRole("button", { name: "Cambiar contraseña" }));
    });
  };
  function llenar(actual = "vieja1234", nueva = "nueva1234", confirmacion = nueva) {
    escribir("Contraseña actual", actual);
    escribir("Contraseña nueva", nueva);
    escribir("Repite la contraseña nueva", confirmacion);
  }

  it("si la confirmación no coincide no se envía", async () => {
    await montar();
    abrir();
    llenar("vieja1234", "nueva1234", "nueva12345");
    await enviar();

    expect(cambiarContrasenaMock).not.toHaveBeenCalled();
    expect(campo("Repite la contraseña nueva")).toHaveAccessibleDescription("Las contraseñas no coinciden.");
    expect(campo("Repite la contraseña nueva")).toHaveFocus();
  });

  it("vacío: marca cada campo y el foco va al primero", async () => {
    await montar();
    abrir();
    await enviar();

    expect(cambiarContrasenaMock).not.toHaveBeenCalled();
    expect(campo("Contraseña actual")).toHaveAccessibleDescription("Ingresa tu contraseña actual.");
    expect(campo("Contraseña nueva")).toHaveAccessibleDescription(MENSAJE_POLITICA_PASSWORD);
    expect(campo("Repite la contraseña nueva")).toHaveAccessibleDescription("Repite la contraseña nueva.");
    expect(campo("Contraseña actual")).toHaveFocus();
  });

  it("con éxito: envía con los nombres del backend, cierra la sesión local y lleva al login", async () => {
    cambiarContrasenaMock.mockResolvedValue(undefined);
    await montar();
    abrir();
    llenar(" vieja 1 ", "nueva1234");
    await enviar();

    expect(cambiarContrasenaMock).toHaveBeenCalledWith({
      password_actual: " vieja 1 ", // sin recortar, como el backend
      password: "nueva1234",
      password_confirmacion: "nueva1234",
    });
    // El backend invalidó todas las sesiones: la de este navegador también.
    expect(hayTokenGuardado()).toBe(false);
    expect(ubicacion()).toBe("/login");
    expect(screen.getByRole("status")).toHaveTextContent("Cambiaste tu contraseña. Inicia sesión con la nueva.");
  });

  it("contraseña actual incorrecta: error bajo su campo, la sesión sigue", async () => {
    cambiarContrasenaMock.mockRejectedValue(
      new ErrorDeApi("La contraseña actual no es válida.", 400, {
        password_actual: ["La contraseña actual no es válida."],
      }),
    );
    await montar();
    abrir();
    llenar();
    await enviar();

    expect(campo("Contraseña actual")).toHaveAccessibleDescription("La contraseña actual no es válida.");
    expect(campo("Contraseña actual")).toHaveFocus();
    expect(hayTokenGuardado()).toBe(true);
    expect(ubicacion()).toBe("/perfil");
  });

  it("si el servidor no pudo (503), avisa y la sesión sigue: la contraseña no cambió", async () => {
    cambiarContrasenaMock.mockRejectedValue(
      new ErrorDeApi("No se pudo cambiar la contraseña. Inténtalo nuevamente.", 503),
    );
    await montar();
    abrir();
    llenar();
    await enviar();

    expect(within(dialogo()).getByRole("alert")).toHaveTextContent(
      "No se pudo cambiar la contraseña. Inténtalo nuevamente.",
    );
    expect(hayTokenGuardado()).toBe(true);
  });

  it("Cancelar cierra sin enviar", async () => {
    await montar();
    abrir();
    llenar();
    fireEvent.click(within(dialogo()).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cambiarContrasenaMock).not.toHaveBeenCalled();
  });

  it("mientras se envía no se puede cerrar ni enviar dos veces", async () => {
    const respuesta = diferida<void>();
    cambiarContrasenaMock.mockReturnValue(respuesta.promesa);
    await montar();
    abrir();
    llenar();
    const formulario = dialogo().querySelector("form")!;
    fireEvent.submit(formulario);
    fireEvent.submit(formulario);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(cambiarContrasenaMock).toHaveBeenCalledTimes(1);
    expect(dialogo()).toBeInTheDocument();

    await act(async () => respuesta.rechazar(new TypeError("Failed to fetch")));
    expect(within(dialogo()).getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
  });
});
