// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SECCIONES_TERMINOS, VERSION_TERMINOS } from "../contenido/terminos";
import { TerminosPage } from "./TerminosPage";

afterEach(() => {
  cleanup();
});

describe("Términos y condiciones (S3-AN-08)", () => {
  it("muestra el título, la versión y todas las secciones del contenido", () => {
    render(
      <MemoryRouter>
        <TerminosPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Términos y condiciones" })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Versión ${VERSION_TERMINOS.replace(/[()]/g, "\\$&")}`))).toBeInTheDocument();
    for (const seccion of SECCIONES_TERMINOS) {
      expect(screen.getByRole("heading", { level: 2, name: seccion.titulo })).toBeInTheDocument();
    }
  });

  it("explica la eliminación de cuenta y la limitación de Outlook", () => {
    render(
      <MemoryRouter>
        <TerminosPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/última persona titular de tu organización/)).toBeInTheDocument();
    expect(screen.getByText(/no puede revocarlo por ti/)).toBeInTheDocument();
  });

  it("ofrece volver a la aplicación", () => {
    render(
      <MemoryRouter>
        <TerminosPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Volver a Ojo al Gasto" })).toHaveAttribute("href", "/");
  });
});
