// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecolectoresDeUso } from "./RecolectoresDeUso";

afterEach(cleanup);

describe("recolectores de uso: cómo activarlos y en qué estado están (S3-CH-21)", () => {
  it("muestra cómo activar Android con los controles reales de la app", () => {
    render(<RecolectoresDeUso />);

    expect(screen.getByText("Recolectores de uso")).toBeInTheDocument();
    const android = screen.getByRole("region", { name: "Android" });
    expect(within(android).getByText("Permisos requeridos: Acceso de uso (estadísticas de uso de aplicaciones).")).toBeInTheDocument();
    expect(within(android).getAllByRole("listitem")).toHaveLength(3);
    expect(within(android).getByText(/«Abrir ajustes de acceso al uso»/)).toBeInTheDocument();
    expect(within(android).getByText(/«Consultar intervalos»/)).toBeInTheDocument();
    expect(within(android).getByText(/no se envía al servidor/)).toBeInTheDocument();
  });

  it("la extensión no queda autorizada al instalarla: los sitios se autorizan desde su panel", () => {
    render(<RecolectoresDeUso />);

    const extension = screen.getByRole("region", { name: "Extensión del navegador" });
    expect(within(extension).getAllByRole("listitem")).toHaveLength(3);
    expect(within(extension).getByText(/Instalarla no autoriza ningún sitio/)).toBeInTheDocument();
    expect(within(extension).getByText(/«Autorizar dominios»/)).toBeInTheDocument();
    expect(within(extension).getByText(/Si no lo aceptas, no se observa ningún sitio/)).toBeInTheDocument();
    expect(within(extension).getByText(/panel de la extensión/)).toBeInTheDocument();
    expect(within(extension).queryByText(/Vuelve a esta página/)).not.toBeInTheDocument();
  });

  it("sin evidencia de estado no muestra ningún recolector como activo", () => {
    render(<RecolectoresDeUso />);

    expect(screen.getAllByText("Todavía no recibimos su estado")).toHaveLength(2);
    expect(screen.queryByText("Activo")).not.toBeInTheDocument();
  });
});
