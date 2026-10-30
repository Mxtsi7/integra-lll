// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Anillo, Arco } from "./Medidores";

afterEach(cleanup);

/** El trazo del valor: el que no es la pista. */
function valorDe(etiqueta: string): SVGElement | null {
  const svg = screen.getByRole("img", { name: etiqueta });
  const trazos = svg.querySelectorAll("circle, path");
  return trazos.length > 1 ? (trazos[1] as SVGElement) : null;
}

describe("Anillo", () => {
  const largo = 2 * Math.PI * ((132 - 11) / 2);

  it.each([
    [1, 0.99],
    [50, 0.5],
    [99, 0.01],
    [100, 0],
    [140, 0], // fuera de rango: se queda en 100 %
  ])("con %i %% queda sin llenar una fracción %s del largo", (porcentaje, sinLlenar) => {
    render(<Anillo porcentaje={porcentaje} color="var(--verde)" tamano={132} etiqueta="En uso" />);
    const valor = valorDe("En uso")!;
    expect(Number(valor.getAttribute("stroke-dashoffset"))).toBeCloseTo(largo * sinLlenar, 3);
    expect(valor).toHaveAttribute("stroke-dasharray", String(largo));
  });

  it("el brillo toma el color del trazo: color y stroke son el mismo", () => {
    render(<Anillo porcentaje={60} color="var(--coral)" etiqueta="Con fuga" />);
    const valor = valorDe("Con fuga")!;
    expect(valor).toHaveAttribute("stroke", "currentColor");
    expect(valor.style.color).toBe("var(--coral)");
    // La animación se llena desde vacío (el largo del trazo), no desde un número fijo.
    expect(valor.style.getPropertyValue("--inicio")).toBe(String(2 * Math.PI * ((140 - 11) / 2)));
  });

  it.each([0, -20, Number.NaN])("con %s no dibuja el trazo del valor (sin punto suelto) y conserva la pista", (porcentaje) => {
    render(<Anillo porcentaje={porcentaje} color="var(--verde)" etiqueta="Vacío" />);
    const svg = screen.getByRole("img", { name: "Vacío" });
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
  });

  it("conserva tamaño, etiqueta y contenido central", () => {
    render(
      <Anillo porcentaje={91} color="var(--verde)" tamano={132} etiqueta="91 % del gasto en uso">
        <span>91 %</span>
      </Anillo>,
    );
    const svg = screen.getByRole("img", { name: "91 % del gasto en uso" });
    expect(svg).toHaveAttribute("width", "132");
    expect(svg).toHaveAttribute("height", "132");
    expect(svg).toHaveAttribute("viewBox", "0 0 132 132");
    expect(screen.getByText("91 %")).toBeInTheDocument();
  });
});

describe("Arco", () => {
  it.each([
    [1, 99],
    [50, 50],
    [99, 1],
    [100, 0],
    [250, 0],
  ])("con %i %% el desfase es %i (sobre pathLength 100)", (porcentaje, desfase) => {
    render(<Arco porcentaje={porcentaje} color="var(--acento)" etiqueta="Faltan días" />);
    const valor = valorDe("Faltan días")!;
    expect(valor).toHaveAttribute("pathLength", "100");
    expect(valor).toHaveAttribute("stroke-dashoffset", String(desfase));
    expect(valor).toHaveAttribute("stroke", "currentColor");
    expect(valor.style.color).toBe("var(--acento)");
    expect(valor.style.getPropertyValue("--inicio")).toBe("100");
  });

  it("en 0 % solo queda la pista", () => {
    render(<Arco porcentaje={0} color="var(--acento)" etiqueta="Lejos" />);
    expect(screen.getByRole("img", { name: "Lejos" }).querySelectorAll("path")).toHaveLength(1);
  });

  it("varias instancias no se mezclan: cada una con su color y su valor", () => {
    render(
      <>
        <Arco porcentaje={30} color="var(--acento)" etiqueta="Uno" />
        <Arco porcentaje={80} color="var(--verde)" etiqueta="Dos" />
        <Anillo porcentaje={10} color="var(--coral)" etiqueta="Tres" />
      </>,
    );
    expect(valorDe("Uno")).toHaveAttribute("stroke-dashoffset", "70");
    expect(valorDe("Dos")).toHaveAttribute("stroke-dashoffset", "20");
    expect(valorDe("Uno")!.style.color).toBe("var(--acento)");
    expect(valorDe("Dos")!.style.color).toBe("var(--verde)");
    expect(valorDe("Tres")!.style.color).toBe("var(--coral)");
  });
});
