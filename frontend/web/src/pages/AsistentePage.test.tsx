// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consultarAsistente, ErrorDeApi, type RespuestaAsistente } from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { AsistentePage } from "./AsistentePage";

// Solo se simula la red; la página, el hook y el componente del chat son reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, consultarAsistente: vi.fn() };
});
const consultarAsistenteMock = vi.mocked(consultarAsistente);

const RESPUESTA_DEL_ASISTENTE: RespuestaAsistente = {
  estado: "ok",
  motivo: null,
  respuesta: "Tu gasto en streaming es el más alto: revisa Netflix primero.",
};
const RESPUESTA_DE_RESPALDO: RespuestaAsistente = {
  estado: "degradado",
  motivo: "cuota_agotada",
  respuesta: "Registramos 120 minutos de uso en 2 registro(s) mensuales.",
};

/** Promesa que el test resuelve o rechaza cuando quiere. */
function diferida<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((alResolver, alRechazar) => {
    resolver = alResolver;
    rechazar = alRechazar;
  });
  return { promesa, resolver, rechazar };
}

async function montar() {
  render(
    <MemoryRouter initialEntries={["/asistente"]}>
      <ToastProvider>
        <AuthProvider>
          <AsistentePage />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

const cuadroDeLaPregunta = () => screen.getByRole("textbox", { name: "Tu pregunta" });
const conversacion = () => within(screen.getByRole("log", { name: "Conversación" }));
const escribir = (texto: string) => fireEvent.change(cuadroDeLaPregunta(), { target: { value: texto } });
const enviarConEnter = () => act(async () => fireEvent.keyDown(cuadroDeLaPregunta(), { key: "Enter" }));

beforeEach(() => {
  localStorage.clear();
  consultarAsistenteMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Página del asistente (S3-CH-14 y S3-CH-15)", () => {
  it("muestra el título, el chat vacío y el destino 'Asistente' en el menú", async () => {
    await montar();

    expect(screen.getByRole("heading", { name: "Asistente financiero" })).toBeInTheDocument();
    expect(screen.getByText(/Todavía no hay mensajes/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Asistente" })).toHaveAttribute("href", "/asistente");
    // Abrir la página no consulta nada: el asistente solo responde a una pregunta.
    expect(consultarAsistenteMock).not.toHaveBeenCalled();
  });

  it("con el teclado: se escribe, Enter envía y la respuesta del asistente aparece en la conversación", async () => {
    consultarAsistenteMock.mockResolvedValue(RESPUESTA_DEL_ASISTENTE);
    await montar();
    cuadroDeLaPregunta().focus();
    escribir("¿Qué reviso primero?");

    await enviarConEnter();

    expect(consultarAsistenteMock).toHaveBeenCalledTimes(1);
    expect(consultarAsistenteMock).toHaveBeenCalledWith("¿Qué reviso primero?");
    const mensajes = conversacion().getAllByRole("listitem");
    expect(mensajes).toHaveLength(2);
    expect(mensajes[0]).toHaveTextContent("Tú¿Qué reviso primero?");
    expect(mensajes[1]).toHaveTextContent("Asistente");
    expect(mensajes[1]).toHaveTextContent(RESPUESTA_DEL_ASISTENTE.respuesta);
    expect(mensajes[1]).not.toHaveTextContent("Resumen automático");
    // Quien escribe no pierde el foco: puede seguir con la siguiente pregunta.
    expect(cuadroDeLaPregunta()).toHaveFocus();
    expect(cuadroDeLaPregunta()).toHaveValue("");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("con Tab hasta «Enviar» y Enter se envía, y el foco vuelve al cuadro", async () => {
    consultarAsistenteMock.mockResolvedValue(RESPUESTA_DEL_ASISTENTE);
    await montar();
    escribir("¿Qué reviso primero?");
    const botonEnviar = screen.getByRole("button", { name: "Enviar" });
    botonEnviar.focus();

    // Enter sobre un botón enfocado lo activa con un clic.
    await act(async () => fireEvent.click(botonEnviar));

    expect(consultarAsistenteMock).toHaveBeenCalledWith("¿Qué reviso primero?");
    expect(conversacion().getAllByRole("listitem")).toHaveLength(2);
    expect(cuadroDeLaPregunta()).toHaveFocus();
  });

  it("mientras llega la respuesta la pregunta ya está en pantalla, se avisa la espera y no se puede enviar otra", async () => {
    const respuestaPendiente = diferida<RespuestaAsistente>();
    consultarAsistenteMock.mockReturnValue(respuestaPendiente.promesa);
    await montar();
    escribir("Primera");
    await enviarConEnter();

    expect(conversacion().getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("El asistente está respondiendo…");
    escribir("Segunda");
    await enviarConEnter();
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(consultarAsistenteMock).toHaveBeenCalledTimes(1);

    await act(async () => respuestaPendiente.resolver(RESPUESTA_DEL_ASISTENTE));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(conversacion().getAllByRole("listitem")).toHaveLength(2);
  });

  it("varias preguntas seguidas quedan en orden en la misma conversación", async () => {
    consultarAsistenteMock.mockResolvedValueOnce(RESPUESTA_DEL_ASISTENTE).mockResolvedValueOnce(RESPUESTA_DE_RESPALDO);
    await montar();

    escribir("Primera");
    await enviarConEnter();
    escribir("Segunda");
    await enviarConEnter();

    const mensajes = conversacion().getAllByRole("listitem");
    expect(mensajes.map((mensaje) => mensaje.querySelector("p")?.textContent)).toEqual([
      "Primera",
      RESPUESTA_DEL_ASISTENTE.respuesta,
      "Segunda",
      RESPUESTA_DE_RESPALDO.respuesta,
    ]);
  });

  it("una respuesta de respaldo se muestra, con el aviso de que no es del asistente con IA", async () => {
    consultarAsistenteMock.mockResolvedValue(RESPUESTA_DE_RESPALDO);
    await montar();
    escribir("Resumen");

    await enviarConEnter();

    const respuesta = conversacion().getAllByRole("listitem")[1];
    expect(respuesta).toHaveTextContent(RESPUESTA_DE_RESPALDO.respuesta);
    expect(respuesta).toHaveTextContent("Resumen automático con tus datos: el asistente con IA no estuvo disponible.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sin red avisa con una alerta, conserva la pregunta y Reintentar la vuelve a mandar sin duplicarla", async () => {
    consultarAsistenteMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(RESPUESTA_DEL_ASISTENTE);
    await montar();
    escribir("¿Qué reviso primero?");
    await enviarConEnter();

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor");
    expect(conversacion().getAllByRole("listitem")).toHaveLength(1);

    const botonReintentar = screen.getByRole("button", { name: "Reintentar" });
    botonReintentar.focus();
    await act(async () => fireEvent.click(botonReintentar));

    expect(consultarAsistenteMock).toHaveBeenCalledTimes(2);
    // El botón ya no está: el foco volvió al cuadro en vez de quedar en la página.
    expect(cuadroDeLaPregunta()).toHaveFocus();
    expect(consultarAsistenteMock).toHaveBeenLastCalledWith("¿Qué reviso primero?");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const mensajes = conversacion().getAllByRole("listitem");
    expect(mensajes).toHaveLength(2);
    expect(mensajes[1]).toHaveTextContent(RESPUESTA_DEL_ASISTENTE.respuesta);
  });

  it("un 403 del servidor se dice sin mostrar el texto técnico y sin dar respuesta", async () => {
    consultarAsistenteMock.mockRejectedValue(new ErrorDeApi("Esta función requiere Premium vigente", 403));
    await montar();
    escribir("Hola");

    await enviarConEnter();

    expect(screen.getByRole("alert")).toHaveTextContent("No tienes acceso al asistente financiero con tu cuenta.");
    expect(conversacion().getAllByRole("listitem")).toHaveLength(1);
  });

  it("al volver a escribir tras un error, la alerta se va en cuanto sale la nueva pregunta", async () => {
    consultarAsistenteMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(RESPUESTA_DEL_ASISTENTE);
    await montar();
    escribir("Primera");
    await enviarConEnter();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    escribir("Segunda");
    await enviarConEnter();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(conversacion().getAllByRole("listitem")).toHaveLength(3);
  });
});
