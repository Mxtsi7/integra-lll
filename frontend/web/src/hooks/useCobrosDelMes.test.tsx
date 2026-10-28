// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getCobrosDelMes, type CobroCalendario } from "@ojoalgasto/shared";
import { useCobrosDelMes, type EstadoCobros } from "./useCobrosDelMes";

vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getCobrosDelMes: vi.fn() };
});

const OCTUBRE: CobroCalendario[] = [
  { id: "c1", suscripcion_id: "s1", fecha: "2026-10-24", servicio: "Netflix", importe: 9990, moneda: "CLP", tipo: "proyectado" },
];

afterEach(() => {
  cleanup();
});

it("al cambiar de mes ningún render muestra los cobros del mes anterior, ni por un instante", async () => {
  vi.mocked(getCobrosDelMes).mockImplementation(async (mes) => (mes === "2026-10" ? OCTUBRE : []));
  // Se anota lo que devuelve el hook en CADA render, no solo el último: un
  // render intermedio con datos viejos se vería como un parpadeo en pantalla.
  const renders: { mes: string; estado: EstadoCobros }[] = [];
  function Sonda({ mes }: { mes: string }) {
    renders.push({ mes, estado: useCobrosDelMes(mes).estado });
    return null;
  }

  const { rerender } = render(<Sonda mes="2026-10" />);
  await act(async () => {});
  expect(renders.at(-1)?.estado).toEqual({ tipo: "listo", cobros: OCTUBRE });

  renders.length = 0;
  rerender(<Sonda mes="2026-11" />);
  await act(async () => {});

  const conDatosViejos = renders.filter(
    ({ mes, estado }) => mes === "2026-11" && estado.tipo === "listo" && estado.cobros.some((c) => c.fecha.startsWith("2026-10")),
  );
  expect(conDatosViejos).toEqual([]);
  expect(renders[0]).toEqual({ mes: "2026-11", estado: { tipo: "cargando" } });
  expect(renders.at(-1)).toEqual({ mes: "2026-11", estado: { tipo: "listo", cobros: [] } });
});
