// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalogosSuscripciones, type CatalogosSuscripciones } from "@ojoalgasto/shared";
import { CatalogosProvider } from "../../context/CatalogosContext";
import { NuevaSuscripcionForm } from "./NuevaSuscripcionForm";

// Las opciones salen del catálogo del backend; acá se simula solo esa llamada.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getCatalogosSuscripciones: vi.fn() };
});

const opcion = (codigo: string, nombre: string, activo = true) => ({ codigo, nombre, activo, orden: 1 });
const CATALOGO: CatalogosSuscripciones = {
  monedas: [opcion("CLP", "Peso chileno"), opcion("USD", "Dólar")],
  categorias: [opcion("otro", "Otro"), opcion("streaming", "Streaming"), opcion("vieja", "Histórica", false)],
  frecuencias: [{ codigo: "mensual", nombre: "Mensual" }, { codigo: "anual", nombre: "Anual" }],
  predeterminados: { moneda: "CLP", categoria: "otro", frecuencia: "mensual" },
};

type Props = Parameters<typeof NuevaSuscripcionForm>[0];

/** Monta el formulario como en la app (dentro del catálogo) y espera a que cargue. */
async function montar(props: Partial<Props> = {}) {
  const onAdd = vi.fn().mockResolvedValue(true);
  const dibujar = (extra: Partial<Props> = {}) => (
    <CatalogosProvider>
      <NuevaSuscripcionForm onAdd={onAdd} {...props} {...extra} />
    </CatalogosProvider>
  );
  const utils = render(dibujar());
  await act(async () => {});
  return { onAdd, ...utils, recibir: (extra: Partial<Props>) => utils.rerender(dibujar(extra)) };
}

beforeEach(() => {
  vi.mocked(getCatalogosSuscripciones).mockReset().mockResolvedValue(structuredClone(CATALOGO));
});

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
    const { onAdd } = await montar();
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
    const { onAdd } = await montar();
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
    const { onAdd } = await montar();
    llenarValido();
    escribir("Próximo cobro", "2026-02-30");
    await guardar();

    expect(onAdd).not.toHaveBeenCalled();
    expect(campo("Próximo cobro")).toHaveAttribute("aria-invalid", "true");
  });

  it("con todo válido envía la suscripción con el monto convertido", async () => {
    const { onAdd } = await montar();
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
    const { onAdd } = await montar();
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
    await montar();
    await guardar();
    escribir("Servicio", "Netflix");
    expect(screen.queryByText("Ingresa el nombre del servicio.")).not.toBeInTheDocument();
    expect(screen.getByText("Ingresa el monto.")).toBeInTheDocument();
  });

  it("si el guardado falla, no se pierde lo escrito", async () => {
    const { onAdd } = await montar();
    onAdd.mockResolvedValue(false);
    llenarValido();
    await guardar();

    expect(campo("Servicio")).toHaveValue("  Netflix ");
    expect(campo("Monto")).toHaveValue("12,5");
  });
});

describe("Formulario de nueva suscripción: errores del servidor (CH-09)", () => {
  it("cada error del backend aparece junto a su campo y el foco va al primero", async () => {
    // Llegan después de guardar, cuando el catálogo ya cargó (antes los
    // campos están deshabilitados y no pueden recibir el foco).
    const { recibir } = await montar();
    recibir({
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

  it("un error del backend que no es de ningún campo se muestra arriba, sin perderse", async () => {
    await montar({ erroresCampos: { proveedor: ["Clave primaria inválida."] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Clave primaria inválida.");
  });

  it("el error general (sin red, 500) se muestra arriba", async () => {
    await montar({ error: "No pudimos crear la suscripción. Intenta de nuevo." });
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos crear la suscripción.");
  });
});

describe("Formulario de nueva suscripción: opciones del catálogo", () => {
  it("la categoría se valida contra el catálogo, no contra una lista escrita en el código", async () => {
    const { onAdd } = await montar();
    llenarValido();
    fireEvent.change(campo("Categoría"), { target: { value: "streaming" } });
    await guardar();
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ categoria: "streaming", moneda: "CLP" }));
    // Las inactivas no se ofrecen.
    expect(screen.queryByRole("option", { name: "Histórica" })).not.toBeInTheDocument();
  });

  it("que el catálogo complete moneda, categoría y frecuencia no cuenta como cambio sin guardar (CH-16)", async () => {
    const onCambiosSinGuardar = vi.fn();
    await montar({ onCambiosSinGuardar });

    expect(campo("Moneda")).toHaveValue("CLP");
    expect(onCambiosSinGuardar).not.toHaveBeenCalledWith(true);

    escribir("Servicio", "Netflix");
    expect(onCambiosSinGuardar).toHaveBeenLastCalledWith(true);
    escribir("Servicio", "");
    expect(onCambiosSinGuardar).toHaveBeenLastCalledWith(false);
  });

  it("después de guardar queda limpio con los valores por defecto, listo para otra", async () => {
    const onCambiosSinGuardar = vi.fn();
    const { onAdd } = await montar({ onCambiosSinGuardar });
    llenarValido();
    fireEvent.change(campo("Moneda"), { target: { value: "USD" } });
    await guardar();

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(campo("Servicio")).toHaveValue("");
    expect(campo("Moneda")).toHaveValue("CLP");
    expect(campo("Categoría")).toHaveValue("otro");
    expect(campo("Se cobra")).toHaveValue("mensual");
    expect(onCambiosSinGuardar).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Guardar suscripción" })).toBeEnabled();
  });

  it("mientras el catálogo no carga no se puede guardar", async () => {
    vi.mocked(getCatalogosSuscripciones).mockReturnValue(new Promise(() => {}));
    await montar();
    expect(screen.getByRole("button", { name: "Guardar suscripción" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando opciones");
  });
});
