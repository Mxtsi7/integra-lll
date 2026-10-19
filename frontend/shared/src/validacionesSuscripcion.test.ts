import { describe, expect, it } from "vitest";
import {
  erroresDesdeServidor,
  esFechaReal,
  hoyLocalIso,
  parsearMonto,
  validarSuscripcion,
  validarUso,
  type DatosSuscripcion,
} from "./validacionesSuscripcion";

// Resultado REAL de los serializers de services/subscriptions para cada caso
// (true = el backend lo acepta). Se obtuvo pasando estos mismos valores por
// SubscriptionSerializer y RegistrarUsoSerializer. Si el backend cambia sus
// reglas, estos casos tienen que cambiar con él.
const MONTOS: Array<[string, boolean]> = [
  ["5990", true],
  ["0.01", true],
  ["9.99", true],
  ["12.5", true],
  ["99999999.99", true],
  ["100000000", false], // 9 dígitos enteros: DecimalField(10, 2) admite 8
  ["0", false],
  ["0.00", false],
  ["-5", false],
  ["1.234", false], // 3 decimales
  ["abc", false],
  ["", false],
];

const FECHAS: Array<[string, boolean]> = [
  ["2026-11-05", true],
  ["2028-02-29", true], // bisiesto
  ["2026-02-29", false], // 2026 no es bisiesto
  ["2026-02-30", false],
  ["2026-04-31", false],
  ["2026-13-01", false],
  ["2026-00-10", false],
  ["05-11-2026", false],
  ["", false],
];

const MINUTOS: Array<[string, boolean]> = [
  ["1", true],
  ["30", true],
  ["44640", true],
  ["44641", false],
  ["0", false],
  ["-5", false],
  ["1.5", false],
  ["abc", false],
  ["", false],
];

const base: DatosSuscripcion = {
  nombre: "Netflix",
  monto: "5990",
  moneda: "CLP",
  frecuencia: "mensual",
  fechaProximoCobro: "2026-11-05",
  enPrueba: false,
  finPrueba: "",
};

describe("validarSuscripcion: mismas reglas que el backend (CH-09)", () => {
  it.each(MONTOS)("monto %j → backend acepta: %s", (monto, aceptaBackend) => {
    expect(validarSuscripcion({ ...base, monto }).monto === undefined).toBe(aceptaBackend);
  });

  it.each(FECHAS)("fecha de cobro %j → backend acepta: %s", (fecha, aceptaBackend) => {
    expect(validarSuscripcion({ ...base, fechaProximoCobro: fecha }).fechaProximoCobro === undefined).toBe(
      aceptaBackend,
    );
  });

  it("un formulario correcto no tiene errores", () => {
    expect(validarSuscripcion(base)).toEqual({});
  });

  it("marca cada campo con su propio mensaje", () => {
    expect(
      validarSuscripcion({
        nombre: " ",
        monto: "0",
        moneda: "EUR",
        frecuencia: "semanal",
        fechaProximoCobro: "2026-02-30",
        enPrueba: true,
        finPrueba: "",
      }),
    ).toEqual({
      nombre: "Ingresa el nombre del servicio.",
      monto: "El monto debe ser mayor a 0.",
      moneda: "Elige una moneda soportada (CLP o USD).",
      frecuencia: "Elige una frecuencia soportada (mensual o anual).",
      fechaProximoCobro: "Esa fecha no existe.",
      finPrueba: "Ingresa cuándo termina la prueba.",
    });
  });

  it("nombre de más de 100 caracteres (límite del modelo)", () => {
    expect(validarSuscripcion({ ...base, nombre: "a".repeat(101) }).nombre).toBe(
      "El nombre puede tener hasta 100 caracteres.",
    );
    expect(validarSuscripcion({ ...base, nombre: "a".repeat(100) })).toEqual({});
  });

  it("el fin de prueba solo se exige si está en prueba, y tiene que existir", () => {
    expect(validarSuscripcion({ ...base, enPrueba: false, finPrueba: "" }).finPrueba).toBeUndefined();
    expect(validarSuscripcion({ ...base, enPrueba: true, finPrueba: "2026-11-31" }).finPrueba).toBe(
      "Esa fecha no existe.",
    );
    expect(validarSuscripcion({ ...base, enPrueba: true, finPrueba: "2026-11-20" })).toEqual({});
  });
});

describe("parsearMonto", () => {
  it("acepta coma decimal", () => {
    expect(parsearMonto("12,50")).toEqual({ valor: 12.5 });
  });

  it("rechaza Infinity disfrazado: parseFloat('1e400') daría Infinity", () => {
    expect(parsearMonto("1e400")).toEqual({ error: "Ingresa un monto válido, solo con números." });
  });

  it("rechaza notación científica aunque el backend la aceptaría (diferencia deliberada)", () => {
    // El backend lee "1e3" como 1000. Nadie escribe así un monto, y es la
    // misma vía por la que se colaba "1e400" (= Infinity) antes.
    expect("error" in parsearMonto("1e3")).toBe(true);
  });

  it("rechaza texto sobrante que parseFloat ignoraría", () => {
    expect("error" in parsearMonto("12abc")).toBe(true);
  });

  it("explica cada problema por separado", () => {
    expect(parsearMonto("")).toEqual({ error: "Ingresa el monto." });
    expect(parsearMonto("1.234")).toEqual({ error: "Usa como máximo 2 decimales." });
    expect(parsearMonto("100000000")).toEqual({ error: "El monto no puede superar 99.999.999,99." });
  });
});

describe("validarUso: mismas reglas que RegistrarUsoSerializer (CH-14)", () => {
  const HOY = "2026-10-19";

  it.each(MINUTOS)("minutos %j → backend acepta: %s", (minutos, aceptaBackend) => {
    expect(validarUso({ minutos, fecha: "" }, HOY).minutos === undefined).toBe(aceptaBackend);
  });

  it("mensajes iguales a los del backend", () => {
    expect(validarUso({ minutos: "0", fecha: "" }, HOY).minutos).toBe(
      "Los minutos de uso no pueden ser negativos ni cero.",
    );
    expect(validarUso({ minutos: "44641", fecha: "" }, HOY).minutos).toBe(
      "Los minutos de uso no pueden superar el máximo mensual (44.640 minutos).",
    );
  });

  it("la fecha es opcional, pero si viene no puede ser futura ni imposible", () => {
    expect(validarUso({ minutos: "30", fecha: "" }, HOY)).toEqual({});
    expect(validarUso({ minutos: "30", fecha: HOY }, HOY)).toEqual({});
    expect(validarUso({ minutos: "30", fecha: "2026-10-20" }, HOY).fecha).toBe(
      "No se puede registrar uso de una fecha futura.",
    );
    expect(validarUso({ minutos: "30", fecha: "2026-02-30" }, HOY).fecha).toBe("Esa fecha no existe.");
  });
});

describe("esFechaReal y hoyLocalIso", () => {
  it.each([
    ["2024-02-29", true],
    ["1900-02-29", false], // divisible por 100 y no por 400
    ["2000-02-29", true],
    ["2026-12-31", true],
    ["2026-6-1", false],
  ])("%s → %s", (fecha, esperado) => {
    expect(esFechaReal(fecha)).toBe(esperado);
  });

  it("hoyLocalIso usa la fecha local, con ceros a la izquierda", () => {
    expect(hoyLocalIso(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("erroresDesdeServidor", () => {
  it("reparte por campo según el mapa y no pierde el resto", () => {
    expect(
      erroresDesdeServidor(
        {
          monto: ["El monto debe ser mayor a 0."],
          fecha_proximo_cobro: ["Fecha con formato erróneo."],
          proveedor: ["Clave primaria inválida."],
        },
        { monto: "monto", fecha_proximo_cobro: "fechaProximoCobro" } as const,
      ),
    ).toEqual({
      porCampo: { monto: "El monto debe ser mayor a 0.", fechaProximoCobro: "Fecha con formato erróneo." },
      general: ["Clave primaria inválida."],
    });
  });
});
