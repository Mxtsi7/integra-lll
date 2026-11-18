// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITE_PREGUNTA_ASISTENTE } from "@ojoalgasto/shared";
import { ChatAsistente } from "./ChatAsistente";
import type { MensajeChat } from "./mensajesChat";

// S3-CH-14: el componente solo dibuja. Las funciones "Falso" son de maquetación:
// registran con qué se las llamó y no consultan ningún servicio.
function montar(propiedades: Partial<ComponentProps<typeof ChatAsistente>> = {}) {
  const alEnviarFalso = vi.fn();
  const alReintentarFalso = vi.fn();
  render(
    <ChatAsistente
      mensajes={[]}
      estaEnviando={false}
      errorDeEnvio={null}
      alEnviar={alEnviarFalso}
      alReintentar={alReintentarFalso}
      {...propiedades}
    />,
  );
  return { alEnviarFalso, alReintentarFalso };
}

const cuadroDeLaPregunta = () => screen.getByRole("textbox", { name: "Tu pregunta" });
const botonEnviar = () => screen.getByRole("button", { name: "Enviar" });
const escribir = (texto: string) => fireEvent.change(cuadroDeLaPregunta(), { target: { value: texto } });

const PREGUNTA_DE_LA_PERSONA: MensajeChat = { id: 1, autor: "persona", texto: "¿Qué suscripción reviso primero?" };
const RESPUESTA_DEL_ASISTENTE: MensajeChat = { id: 2, autor: "asistente", texto: "Revisa el streaming.", respaldo: null };
const respuestaDeRespaldo = (motivo: string | null): MensajeChat => ({
  id: 3,
  autor: "asistente",
  texto: "Registramos 120 minutos de uso.",
  respaldo: { motivo },
});

afterEach(() => {
  cleanup();
});

describe("Estructura y teclado (S3-CH-14)", () => {
  it("sin mensajes explica qué hacer, tiene la región de la conversación y no deja enviar nada", () => {
    montar();

    expect(screen.getByText(/Todavía no hay mensajes/)).toBeInTheDocument();
    expect(screen.getByRole("log", { name: "Conversación" })).toBeInTheDocument();
    expect(botonEnviar()).toBeDisabled();
  });

  it("el cuadro y el botón son controles nativos y ninguno queda fuera del orden de Tab", () => {
    montar();

    expect(cuadroDeLaPregunta().tagName).toBe("TEXTAREA");
    expect(cuadroDeLaPregunta()).not.toHaveAttribute("tabindex", "-1");
    expect(botonEnviar()).toHaveAttribute("type", "submit");
    expect(botonEnviar()).not.toHaveAttribute("tabindex", "-1");
  });

  it("el cuadro dice el máximo y cuántos caracteres lleva, y lo enlaza como su descripción", () => {
    montar();
    expect(cuadroDeLaPregunta()).toHaveAttribute("maxlength", String(LIMITE_PREGUNTA_ASISTENTE));
    expect(cuadroDeLaPregunta()).toHaveAccessibleDescription(`Enter envía; Mayús + Enter agrega una línea. 0/${LIMITE_PREGUNTA_ASISTENTE}`);

    escribir("Hola");
    expect(cuadroDeLaPregunta()).toHaveAccessibleDescription(`Enter envía; Mayús + Enter agrega una línea. 4/${LIMITE_PREGUNTA_ASISTENTE}`);
  });

  it("al escribir se habilita Enviar; al enviarlo manda la pregunta sin espacios sobrantes y vacía el cuadro", () => {
    const { alEnviarFalso } = montar();
    escribir("  ¿Cuánto gasto en streaming?  ");
    expect(botonEnviar()).toBeEnabled();

    fireEvent.click(botonEnviar());

    expect(alEnviarFalso).toHaveBeenCalledTimes(1);
    expect(alEnviarFalso).toHaveBeenCalledWith("¿Cuánto gasto en streaming?");
    expect(cuadroDeLaPregunta()).toHaveValue("");
    expect(botonEnviar()).toBeDisabled();
  });

  it("Enter envía la pregunta", () => {
    const { alEnviarFalso } = montar();
    escribir("¿Qué reviso primero?");

    fireEvent.keyDown(cuadroDeLaPregunta(), { key: "Enter" });

    expect(alEnviarFalso).toHaveBeenCalledWith("¿Qué reviso primero?");
    expect(cuadroDeLaPregunta()).toHaveValue("");
  });

  it("al enviar con el botón, el foco vuelve al cuadro: el botón se deshabilita y lo perdería", () => {
    montar();
    escribir("¿Qué reviso primero?");
    botonEnviar().focus();

    fireEvent.click(botonEnviar());

    expect(cuadroDeLaPregunta()).toHaveFocus();
  });

  it("Mayús + Enter no envía: es para bajar de línea", () => {
    const { alEnviarFalso } = montar();
    escribir("Primera línea");

    fireEvent.keyDown(cuadroDeLaPregunta(), { key: "Enter", shiftKey: true });

    expect(alEnviarFalso).not.toHaveBeenCalled();
    expect(cuadroDeLaPregunta()).toHaveValue("Primera línea");
  });

  it("Enter mientras un método de entrada compone la palabra no envía", () => {
    const { alEnviarFalso } = montar();
    escribir("こんにちは");

    fireEvent.keyDown(cuadroDeLaPregunta(), { key: "Enter", isComposing: true });

    expect(alEnviarFalso).not.toHaveBeenCalled();
  });

  it("una pregunta en blanco no se envía ni con el botón ni con Enter", () => {
    const { alEnviarFalso } = montar();
    escribir("    ");

    expect(botonEnviar()).toBeDisabled();
    fireEvent.keyDown(cuadroDeLaPregunta(), { key: "Enter" });
    fireEvent.submit(cuadroDeLaPregunta().closest("form")!);

    expect(alEnviarFalso).not.toHaveBeenCalled();
  });
});

describe("Mensajes y estados (S3-CH-14)", () => {
  it("cada mensaje dice quién lo escribió y se lista en orden", () => {
    montar({ mensajes: [PREGUNTA_DE_LA_PERSONA, RESPUESTA_DEL_ASISTENTE] });

    const conversacion = within(screen.getByRole("log", { name: "Conversación" }));
    const mensajes = conversacion.getAllByRole("listitem");
    expect(mensajes).toHaveLength(2);
    expect(mensajes[0]).toHaveTextContent("Tú");
    expect(mensajes[0]).toHaveTextContent("¿Qué suscripción reviso primero?");
    expect(mensajes[1]).toHaveTextContent("Asistente");
    expect(mensajes[1]).toHaveTextContent("Revisa el streaming.");
    expect(screen.queryByText(/Todavía no hay mensajes/)).not.toBeInTheDocument();
  });

  it("la región de la conversación es un registro educado: anuncia lo que se agrega, sin interrumpir", () => {
    montar({ mensajes: [PREGUNTA_DE_LA_PERSONA] });

    const registro = screen.getByRole("log", { name: "Conversación" });
    expect(registro).toHaveAttribute("aria-live", "polite");
    expect(registro).toHaveAttribute("aria-relevant", "additions");
  });

  it("una respuesta de respaldo lo dice; la del asistente no lleva ese aviso", () => {
    montar({ mensajes: [RESPUESTA_DEL_ASISTENTE, respuestaDeRespaldo("timeout")] });

    const [delAsistente, deRespaldo] = screen.getAllByRole("listitem");
    expect(delAsistente).not.toHaveTextContent("Resumen automático");
    expect(deRespaldo).toHaveTextContent("Registramos 120 minutos de uso.");
    expect(deRespaldo).toHaveTextContent(
      "Resumen automático. El asistente con IA tardó demasiado en responder. Puedes volver a preguntar.",
    );
  });

  describe("el aviso de respaldo dice el motivo y qué hacer (S3-CH-17)", () => {
    it.each([
      ["cuota_agotada", "Ya usaste tus consultas con IA de este mes. Hasta el próximo mes recibirás este resumen automático."],
      ["capacidad", "El asistente con IA está atendiendo muchas consultas. Vuelve a preguntar en unos minutos."],
      ["no_configurado", "El asistente con IA no está activado en este momento. Por ahora recibirás este resumen automático."],
    ])("con el motivo %s", (motivo, textoEsperado) => {
      montar({ mensajes: [respuestaDeRespaldo(motivo)] });

      expect(screen.getByRole("listitem")).toHaveTextContent(`Resumen automático. ${textoEsperado}`);
    });

    it.each([
      ["sin motivo", null],
      ["con un motivo que la web no conoce", "motivo_nuevo_del_backend"],
    ])("%s da el aviso general, sin dejar la respuesta sin explicación", (_descripcion, motivo) => {
      montar({ mensajes: [respuestaDeRespaldo(motivo)] });

      expect(screen.getByRole("listitem")).toHaveTextContent(
        "Resumen automático. El asistente con IA no estuvo disponible. Puedes volver a preguntar.",
      );
    });

    it("la respuesta de respaldo no se muestra como un error: no hay alerta ni Reintentar", () => {
      montar({ mensajes: [respuestaDeRespaldo("timeout")] });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    });
  });

  it("mientras espera la respuesta lo anuncia, bloquea otro envío y deja seguir escribiendo", () => {
    const { alEnviarFalso } = montar({ mensajes: [PREGUNTA_DE_LA_PERSONA], estaEnviando: true });

    expect(screen.getByRole("status")).toHaveTextContent("El asistente está respondiendo…");
    expect(botonEnviar()).toBeDisabled();

    // El cuadro sigue activo: deshabilitarlo le quitaría el foco a quien escribe.
    expect(cuadroDeLaPregunta()).toBeEnabled();
    escribir("Otra pregunta");
    fireEvent.keyDown(cuadroDeLaPregunta(), { key: "Enter" });
    expect(alEnviarFalso).not.toHaveBeenCalled();
    expect(cuadroDeLaPregunta()).toHaveValue("Otra pregunta");
  });

  it("sin envío en curso no hay aviso de espera", () => {
    montar({ mensajes: [PREGUNTA_DE_LA_PERSONA, RESPUESTA_DEL_ASISTENTE] });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("un error se anuncia como alerta y Reintentar avisa al padre", () => {
    const { alReintentarFalso } = montar({ mensajes: [PREGUNTA_DE_LA_PERSONA], errorDeEnvio: "No pudimos conectar con el servidor." });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(alReintentarFalso).toHaveBeenCalledTimes(1);
  });

  it("Reintentar devuelve el foco al cuadro: el botón desaparece mientras se espera", () => {
    montar({ mensajes: [PREGUNTA_DE_LA_PERSONA], errorDeEnvio: "No pudimos conectar con el servidor." });
    const botonReintentar = screen.getByRole("button", { name: "Reintentar" });
    botonReintentar.focus();

    fireEvent.click(botonReintentar);

    expect(cuadroDeLaPregunta()).toHaveFocus();
  });

  it("sin error no hay alerta ni Reintentar", () => {
    montar({ mensajes: [PREGUNTA_DE_LA_PERSONA] });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("conserva los saltos de línea y no interpreta el texto como HTML", () => {
    montar({ mensajes: [{ id: 4, autor: "asistente", texto: "Línea uno\nLínea dos <b>no es negrita</b>", respaldo: null }] });

    const texto = screen.getByText(/Línea uno/);
    expect(texto.textContent).toBe("Línea uno\nLínea dos <b>no es negrita</b>");
    expect(texto.querySelector("b")).toBeNull();
  });
});
