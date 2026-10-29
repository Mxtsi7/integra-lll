// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OjoMarca } from "./Marca";

afterEach(() => {
  cleanup();
});

it("cada ojo usa su propio degradado: no se repiten ids en la página (CH-25)", () => {
  const { container } = render(
    <>
      <OjoMarca />
      <OjoMarca tamano={56} />
    </>,
  );
  const degradados = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
  expect(degradados).toHaveLength(2);
  expect(new Set(degradados).size).toBe(2);
  // Y cada uno pinta con el suyo.
  const rellenos = [...container.querySelectorAll("rect")].map((r) => r.getAttribute("fill"));
  expect(rellenos).toEqual(degradados.map((id) => `url(#${id})`));
  expect(degradados.every((id) => !id.includes(":"))).toBe(true);
});
