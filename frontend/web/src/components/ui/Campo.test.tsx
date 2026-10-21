// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampoContrasena } from "./Campo";

function Formulario({ alEnviar }: { alEnviar: () => void }) {
  const [clave, setClave] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        alEnviar();
      }}
    >
      <CampoContrasena id="clave" etiqueta="Contraseña" value={clave} onChange={(e) => setClave(e.target.value)} />
      <CampoContrasena
        id="confirmacion"
        etiqueta="Repite la contraseña"
        value={confirmacion}
        onChange={(e) => setConfirmacion(e.target.value)}
      />
      <button type="submit">Enviar</button>
    </form>
  );
}

function montar() {
  const alEnviar = vi.fn();
  render(<Formulario alEnviar={alEnviar} />);
  const campo = screen.getByLabelText("Contraseña") as HTMLInputElement;
  // El botón de ver/ocultar del primer campo (cada campo tiene el suyo).
  const boton = within(campo.parentElement as HTMLElement).getByRole("button", { name: "Mostrar contraseña" });
  return { alEnviar, campo, boton };
}

afterEach(() => {
  cleanup();
});

describe("CampoContrasena (CH-05)", () => {
  it("empieza siempre oculta", () => {
    const { campo, boton } = montar();
    expect(campo).toHaveAttribute("type", "password");
    expect(boton).toHaveAttribute("aria-pressed", "false");
  });

  it("alternar muestra y oculta conservando el valor", () => {
    const { campo, boton } = montar();
    fireEvent.change(campo, { target: { value: "clave1234" } });

    fireEvent.click(boton);
    expect(campo).toHaveAttribute("type", "text");
    expect(boton).toHaveAttribute("aria-pressed", "true");
    expect(campo).toHaveValue("clave1234");

    fireEvent.click(boton);
    expect(campo).toHaveAttribute("type", "password");
    expect(boton).toHaveAttribute("aria-pressed", "false");
    expect(campo).toHaveValue("clave1234");
  });

  it("alternar no envía el formulario", () => {
    const { alEnviar, boton } = montar();
    fireEvent.click(boton);
    fireEvent.click(boton);
    expect(alEnviar).not.toHaveBeenCalled();
    expect(boton).toHaveAttribute("type", "button");
  });

  it("al hacer clic con el mouse el foco se queda en el campo", () => {
    const { campo, boton } = montar();
    campo.focus();
    // fireEvent devuelve false si el handler llamó preventDefault(): así el
    // navegador no le quita el foco al input al presionar el botón.
    expect(fireEvent.mouseDown(boton)).toBe(false);
    fireEvent.click(boton);
    expect(document.activeElement).toBe(campo);
  });

  it("tiene nombre accesible y se puede usar con teclado (botón nativo enfocable)", () => {
    const { campo, boton } = montar();
    expect(boton.tagName).toBe("BUTTON");
    expect(boton).not.toHaveAttribute("tabindex", "-1");
    expect(boton).toHaveAttribute("aria-controls", campo.id);
    boton.focus();
    expect(document.activeElement).toBe(boton);
    // Enter/Espacio sobre un <button> nativo disparan click en el navegador.
    fireEvent.click(boton);
    expect(campo).toHaveAttribute("type", "text");
  });

  it("cada campo se alterna por separado", () => {
    montar();
    const confirmacion = screen.getByLabelText("Repite la contraseña");
    const [primero] = screen.getAllByRole("button", { name: "Mostrar contraseña" });
    fireEvent.click(primero);
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    expect(confirmacion).toHaveAttribute("type", "password");
  });

  it("si el campo está deshabilitado, el botón también", () => {
    render(<CampoContrasena etiqueta="Contraseña" disabled value="" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toBeDisabled();
  });
});
