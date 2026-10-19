// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NuevaSuscripcionForm } from "./NuevaSuscripcionForm";

type Props = Parameters<typeof NuevaSuscripcionForm>[0];

function montar(props: Partial<Props> = {}) {
  const onAdd = vi.fn().mockResolvedValue(true);
  const utils = render(<NuevaSuscripcionForm onAdd={onAdd} {...props} />);
  return { onAdd, ...utils };
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta) as HTMLInputElement;
const escribir = (etiqueta: string, valor: string) => fireEvent.change(campo(etiqueta), { target: { value: valor } });
const guardar = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar suscripción" })));

function llenarValido() {
  escribir("Servicio", "  Netflix ");
  escribir("Monto", "12,5");
  escribir("Próximo cobro", "2026-11-05");
}

afterEach(() => {
  cleanup();
});

describe("Formulario de nueva suscripción: validaciones (CH-09)", () => {
  it("vacío no se envía y marca cada campo, con el foco en el primero", async () => {
    const { onAdd } = montar();
    await guardar();

    expect(onAdd).not.toHaveBeenCalled();
    expect(campo("Servicio")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Ingresa el nombre del servicio.")).toBeInTheDocument();
    expect(screen.getByText("Ingresa el monto.")).toBeInTheDocument();
    expect(screen.getByText("Ingresa la fecha del próximo cobro.")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo("Servicio"));
  });

  it.each([
    ["0", "El monto debe ser mayor a 0."],
    ["-5", "El monto debe ser mayor a 0."],
    ["0,00", "El monto debe ser mayor a 0."],
    ["1e400", "Ingresa un monto válido, solo con números."],
    ["12abc", "Ingresa un monto válido, solo con números."],
    ["1,234", "Usa como máximo 2 decimales."],
    ["100000000", "El monto no puede superar 99.999.999,99."],
  ])("monto %j no se envía: %s", async (monto, mensaje) => {
    const { onAdd } = montar();
    llenarValido();
    escribir("Monto", monto);
    await guardar();

    expect(onAdd).not.toHaveBeenCalled();
    expect(campo("Monto")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(mensaje)).toBeInTheDocument();
    expect(document.activeElement).toBe(campo("Monto"));
  });

  it("una fecha imposible no se envía", async () => {
    // Un <input type="date"> descarta las fechas que no existen (queda vacío);
    // la validación de shared además rechaza "2026-02-30" si llegara por otra vía.
    const { onAdd } = montar();
    llenarValido();
    escribir("Próximo cobro", "2026-02-30");
    await guardar();

    expect(onAdd).not.toHaveBeenCalled();
    expect(campo("Próximo cobro")).toHaveAttribute("aria-invalid", "true");
  });

  it("con todo válido envía la suscripción con el monto convertido", async () => {
    const { onAdd } = montar();
    llenarValido();
    await guardar();

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({
      nombre: "Netflix",
      monto: 12.5,
      moneda: "CLP",
      frecuencia: "mensual",
      fecha_proximo_cobro: "2026-11-05",
      categoria: "otro",
      estado: "activo",
    });
  });

  it("en período de prueba exige la fecha de fin y la manda con estado 'prueba'", async () => {
    const { onAdd } = montar();
    llenarValido();
    fireEvent.click(screen.getByLabelText("Está en período de prueba gratis"));
    await guardar();

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText("Ingresa cuándo termina la prueba.")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo("Termina la prueba"));

    escribir("Termina la prueba", "2026-10-30");
    await guardar();

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "prueba", fin_prueba: "2026-10-30" }),
    );
  });

  it("al corregir un campo se borra su error", async () => {
    montar();
    await guardar();
    escribir("Servicio", "Netflix");
    expect(screen.queryByText("Ingresa el nombre del servicio.")).not.toBeInTheDocument();
    expect(screen.getByText("Ingresa el monto.")).toBeInTheDocument();
  });

  it("si el guardado falla, no se pierde lo escrito", async () => {
    const { onAdd } = montar();
    onAdd.mockResolvedValue(false);
    llenarValido();
    await guardar();

    expect(campo("Servicio")).toHaveValue("  Netflix ");
    expect(campo("Monto")).toHaveValue("12,5");
  });
});

describe("Formulario de nueva suscripción: errores del servidor (CH-09)", () => {
  it("cada error del backend aparece junto a su campo y el foco va al primero", () => {
    montar({
      erroresCampos: {
        monto: ["El monto debe ser mayor a 0."],
        fecha_proximo_cobro: ["Fecha con formato erróneo."],
      },
    });

    expect(campo("Monto")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("El monto debe ser mayor a 0.")).toBeInTheDocument();
    expect(campo("Próximo cobro")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Fecha con formato erróneo.")).toBeInTheDocument();
    expect(document.activeElement).toBe(campo("Monto"));
  });

  it("un error del backend que no es de ningún campo se muestra arriba, sin perderse", () => {
    montar({ erroresCampos: { proveedor: ["Clave primaria inválida."] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Clave primaria inválida.");
  });

  it("el error general (sin red, 500) se muestra arriba", () => {
    montar({ error: "No pudimos crear la suscripción. Intenta de nuevo." });
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos crear la suscripción.");
  });
});
