// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecolectoresDeUso } from "./RecolectoresDeUso";

afterEach(cleanup);

describe("recolectores de uso: cómo activarlos y en qué estado están (S3-CH-21)", () => {
  it("muestra cómo activar Android y la extensión, con los permisos que piden", () => {
    render(<RecolectoresDeUso />);

    expect(screen.getByText("Recolectores de uso")).toBeInTheDocument();
    const android = screen.getByRole("region", { name: "Android" });
    expect(within(android).getByText("Permisos requeridos: Acceso de uso (estadísticas de uso de aplicaciones).")).toBeInTheDocument();
    expect(within(android).getAllByRole("listitem")).toHaveLength(3);
    const extension = screen.getByRole("region", { name: "Extensión del navegador" });
    expect(within(extension).getAllByRole("listitem")).toHaveLength(3);
  });

  it("sin evidencia de estado no muestra ningún recolector como activo", () => {
    render(<RecolectoresDeUso />);

    expect(screen.getAllByText("Todavía no recibimos su estado")).toHaveLength(2);
    expect(screen.queryByText("Activo")).not.toBeInTheDocument();
  });
});
