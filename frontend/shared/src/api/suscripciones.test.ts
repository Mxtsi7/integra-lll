import { describe, it, expect, vi, beforeEach } from "vitest";
import { configurarApi, ErrorDeApi } from "./cliente";
import { crearSuscripcion, getSuscripcion, getSuscripciones, getUsos, registrarUso } from "./suscripciones";
import { gastoProyectado } from "../calculos";
import { validarUso } from "../validacionesSuscripcion";

beforeEach(() => {
  configurarApi({ urlBase: "http://api.test/api" });
});

/** Copiado tal cual de lo que devuelve el servicio subscriptions en el cluster. */
const RESPUESTA_REAL = {
  count: 2,
  next: null,
  previous: null,
  results: [
    {
      id: "6b112d20-c2be-4337-80c3-f2023eb44a3b",
      creado_en: "2026-09-25T20:16:31.168470-03:00",
      actualizado_en: "2026-09-25T20:16:31.168493-03:00",
      organizacion_id: "bdd59df8-04fc-4e29-9f12-dc4eb5d4e30d",
      nombre: "Spotify",
      monto: "5990.00",
      moneda: "CLP",
      frecuencia: "mensual",
      fecha_proximo_cobro: "2026-10-10",
      categoria: "musica",
      estado: "activo",
      fin_prueba: null,
      horas_uso_mes: null,
    },
    {
      id: "0d4a1f3e-1111-2222-3333-444455556666",
      nombre: "Netflix",
      monto: "59880.00",
      moneda: "CLP",
      frecuencia: "anual",
      fecha_proximo_cobro: "2027-01-10",
      categoria: "streaming",
      estado: "activo",
      fin_prueba: null,
      horas_uso_mes: null,
    },
  ],
};

function responder(cuerpo: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => cuerpo }),
  );
}

describe("getSuscripciones", () => {
  it("convierte el monto de texto a numero", async () => {
    responder(RESPUESTA_REAL);

    const [spotify] = await getSuscripciones();

    expect(spotify.monto).toBe(5990);
    expect(typeof spotify.monto).toBe("number");
  });

  it("el gasto proyectado suma en vez de concatenar", async () => {
    // Sin la conversion esto da la cadena "05990.004990" y la pantalla
    // termina mostrando $NaN.
    responder(RESPUESTA_REAL);

    const total = gastoProyectado(await getSuscripciones());

    expect(total).toBe(5990 + 59880 / 12);
    expect(Number.isNaN(total)).toBe(false);
  });

  it("horas_uso_mes llega como texto (VI-10) y queda como número; \"0.00\" es cero, no 'hay uso'", async () => {
    responder({
      ...RESPUESTA_REAL,
      results: [
        { ...RESPUESTA_REAL.results[0], horas_uso_mes: "0.00" },
        { ...RESPUESTA_REAL.results[1], horas_uso_mes: "12.50" },
      ],
    });

    const [sinUso, conUso] = await getSuscripciones();

    expect(sinUso.horas_uso_mes).toBe(0);
    expect(conUso.horas_uso_mes).toBe(12.5);
  });

  it("los nulos de la API quedan como undefined", async () => {
    responder(RESPUESTA_REAL);

    const [spotify] = await getSuscripciones();

    expect(spotify.fin_prueba).toBeUndefined();
    expect(spotify.horas_uso_mes).toBeUndefined();
  });

  it("devuelve results y no la pagina completa", async () => {
    responder(RESPUESTA_REAL);

    const suscripciones = await getSuscripciones();

    expect(Array.isArray(suscripciones)).toBe(true);
    expect(suscripciones).toHaveLength(2);
    expect(suscripciones[1].nombre).toBe("Netflix");
  });

  it("una pagina vacia devuelve una lista vacia", async () => {
    responder({ count: 0, next: null, previous: null, results: [] });

    expect(await getSuscripciones()).toEqual([]);
  });
});

describe("getSuscripciones y la paginacion", () => {
  /** Arma una respuesta paginada como la que devuelve DRF. */
  function pagina(nombres: string[], hayOtra: boolean) {
    return {
      count: 0,
      // El `next` real trae el host INTERNO del servicio, inalcanzable desde el
      // navegador. Se replica tal cual para que la prueba refleje la realidad.
      next: hayOtra ? "http://subscriptions:8002/api/suscripciones/?page=2" : null,
      previous: null,
      results: nombres.map((nombre, i) => ({
        id: `${nombre}-${i}`,
        nombre,
        monto: "1000.00",
        moneda: "CLP",
        frecuencia: "mensual",
        fecha_proximo_cobro: "2026-10-10",
        categoria: "otro",
        estado: "activo",
        fin_prueba: null,
        horas_uso_mes: null,
      })),
    };
  }

  it("junta todas las paginas, no solo la primera", async () => {
    const respuestas = [pagina(["A", "B"], true), pagina(["C"], false)];
    let llamada = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => respuestas[llamada++],
      })),
    );

    const suscripciones = await getSuscripciones();

    expect(suscripciones.map((s) => s.nombre)).toEqual(["A", "B", "C"]);
  });

  it("pide las paginas por numero, sin seguir el next del servidor", async () => {
    const respuestas = [pagina(["A"], true), pagina(["B"], false)];
    let llamada = 0;
    const fetchFalso = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => respuestas[llamada++],
    }));
    vi.stubGlobal("fetch", fetchFalso);

    await getSuscripciones();

    const urls = fetchFalso.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toContain("/suscripciones/?page=1");
    expect(urls[1]).toContain("/suscripciones/?page=2");
    // Nunca se le pega al host interno que viene en el `next`.
    expect(urls.some((u) => u.includes("subscriptions:8002"))).toBe(false);
  });

  it("para cuando no hay siguiente, sin pedir de mas", async () => {
    const fetchFalso = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => pagina(["unica"], false),
    });
    vi.stubGlobal("fetch", fetchFalso);

    await getSuscripciones();

    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});

describe("uso de una suscripción (CH-14 / CH-15)", () => {
  const json = (status: number, cuerpo: unknown) =>
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => cuerpo });

  it("getUsos pide el historial de ESA suscripción y lo devuelve en el orden del backend", async () => {
    const historial = [
      { fecha: "2026-10-18", minutos: 45 },
      { fecha: "2026-10-12", minutos: 30 },
    ];
    const fetchFalso = json(200, historial);
    vi.stubGlobal("fetch", fetchFalso);

    const usos = await getUsos("abc-123");

    expect(fetchFalso.mock.calls[0][0]).toBe("http://api.test/api/suscripciones/abc-123/uso/");
    expect(usos).toEqual(historial);
  });

  it("registrarUso manda minutos y fecha, y devuelve la suscripción actualizada", async () => {
    // Desde VI-10 horas_uso_mes llega como texto (Decimal), igual que monto.
    const fetchFalso = json(200, { ...RESPUESTA_REAL.results[0], horas_uso_mes: "0.75" });
    vi.stubGlobal("fetch", fetchFalso);

    const actualizada = await registrarUso("abc-123", { minutos: 45, fecha: "2026-10-18" });

    const [url, init] = fetchFalso.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("http://api.test/api/suscripciones/abc-123/uso/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ minutos: 45, fecha: "2026-10-18" });
    expect(actualizada.horas_uso_mes).toBe(0.75);
    expect(actualizada.monto).toBe(5990);
  });
});

describe("registrarUso con la fecha vacía (revisión PR #80)", () => {
  it("una fecha vacía no viaja en el body: { minutos } es lo que acepta la API", async () => {
    const fetchFalso = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => RESPUESTA_REAL.results[0] });
    vi.stubGlobal("fetch", fetchFalso);

    await registrarUso("abc-123", { minutos: 30, fecha: "" });

    const [, init] = fetchFalso.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ minutos: 30 });
    expect(init.body).not.toContain("fecha");
  });
});

describe("ErrorDeApi conserva los errores por campo (CH-09)", () => {
  it("un 400 de validación trae todos los campos, no solo el primero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          monto: ["El monto debe ser mayor a 0."],
          fecha_proximo_cobro: ["Fecha con formato erróneo. Use uno de los siguientes formatos en su lugar: YYYY-MM-DD."],
        }),
      }),
    );

    const error = (await crearSuscripcion({
      nombre: "X",
      monto: 0,
      moneda: "CLP",
      frecuencia: "mensual",
      fecha_proximo_cobro: "x",
      categoria: "otro",
      estado: "activo",
    }).catch((e: unknown) => e)) as ErrorDeApi;

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error.message).toBe("El monto debe ser mayor a 0.");
    expect(error.campos).toEqual({
      monto: ["El monto debe ser mayor a 0."],
      fecha_proximo_cobro: ["Fecha con formato erróneo. Use uno de los siguientes formatos en su lugar: YYYY-MM-DD."],
    });
  });

  it("un error sin campos (detail) no inventa campos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: "No encontrado." }) }),
    );

    const error = (await getUsos("no-existe").catch((e: unknown) => e)) as ErrorDeApi;

    expect(error.status).toBe(404);
    expect(error.message).toBe("No encontrado.");
    expect(error.campos).toBeUndefined();
  });
});

// ── Contrato real de VI-10 (revisión PR #80) ───────────────────────────
// Respuestas GRABADAS de la API real (services/subscriptions, vistas y
// serializers de main) haciendo exactamente lo que manda la web, con el reloj
// fijo el 15 de octubre de 2026 y después el 2 de noviembre (cambio de mes).
// Solo se quitaron los UUID y las marcas de creación. Si el backend cambia su
// forma de responder, estos tests lo detectan.
const VI10 = {
  detalleOctubre: {
    "id": "sus-1",
    "horas_uso_mes": "0.00",
    "nombre": "Netflix",
    "monto": "9990.00",
    "moneda": "CLP",
    "frecuencia": "mensual",
    "fecha_proximo_cobro": "2026-11-05",
    "categoria": "streaming",
    "estado": "activo",
    "activo": true,
    "fin_prueba": null,
    "ultima_actividad": null,
    "proveedor": null
  },
  trasRegistrar30SinFecha: {
    "id": "sus-1",
    "horas_uso_mes": "0.50",
    "nombre": "Netflix",
    "monto": "9990.00",
    "moneda": "CLP",
    "frecuencia": "mensual",
    "fecha_proximo_cobro": "2026-11-05",
    "categoria": "streaming",
    "estado": "activo",
    "activo": true,
    "fin_prueba": null,
    "ultima_actividad": "2026-10-15T12:00:00-03:00",
    "proveedor": null
  },
  trasRegistrarDiaDelMesAnterior: {
    "id": "sus-1",
    "horas_uso_mes": "1.50",
    "nombre": "Netflix",
    "monto": "9990.00",
    "moneda": "CLP",
    "frecuencia": "mensual",
    "fecha_proximo_cobro": "2026-11-05",
    "categoria": "streaming",
    "estado": "activo",
    "activo": true,
    "fin_prueba": null,
    "ultima_actividad": "2026-10-15T12:00:00-03:00",
    "proveedor": null
  },
  detalleNoviembre: {
    "id": "sus-1",
    "horas_uso_mes": "0.00",
    "nombre": "Netflix",
    "monto": "9990.00",
    "moneda": "CLP",
    "frecuencia": "mensual",
    "fecha_proximo_cobro": "2026-11-05",
    "categoria": "streaming",
    "estado": "activo",
    "activo": true,
    "fin_prueba": null,
    "ultima_actividad": "2026-10-15T12:00:00-03:00",
    "proveedor": null
  },
  historialOctubre: [
    {
      "fecha": "2026-10-15",
      "minutos": 30
    },
    {
      "fecha": "2026-10-01",
      "minutos": 60
    },
    {
      "fecha": "2026-09-30",
      "minutos": 90
    }
  ],
  errores: {
    "fechaVacia": {
      "fecha": [
        "Fecha con formato erróneo. Use uno de los siguientes formatos en su lugar: YYYY-MM-DD."
      ]
    },
    "fechaFutura": {
      "fecha": [
        "No se puede registrar uso de una fecha futura."
      ]
    },
    "minutosCero": {
      "minutos": [
        "Los minutos de uso no pueden ser negativos ni cero."
      ]
    },
    "minutosMaximo": {
      "minutos": [
        "Los minutos de uso no pueden superar el máximo mensual (44.640 minutos)."
      ]
    }
  },
};

describe("contrato real de VI-10: lo que devuelve la API y lo que entiende la web", () => {
  it("horas_uso_mes llega como texto y la web lo usa como número", async () => {
    responder(VI10.detalleOctubre);
    expect((await getSuscripcion("sus-1")).horas_uso_mes).toBe(0);

    responder(VI10.trasRegistrar30SinFecha);
    expect((await registrarUso("sus-1", { minutos: 30 })).horas_uso_mes).toBe(0.5);
  });

  it("un día de otro mes no cambia las horas del mes actual", async () => {
    responder(VI10.trasRegistrarDiaDelMesAnterior);
    expect((await registrarUso("sus-1", { minutos: 90, fecha: "2026-09-30" })).horas_uso_mes).toBe(1.5);
  });

  it("al cambiar de mes las horas vuelven a cero", async () => {
    responder(VI10.detalleNoviembre);
    expect((await getSuscripcion("sus-1")).horas_uso_mes).toBe(0);
  });

  it("el historial llega del más reciente al más antiguo, también con días de otro mes", async () => {
    responder(VI10.historialOctubre);
    expect((await getUsos("sus-1")).map((u) => u.fecha)).toEqual(["2026-10-15", "2026-10-01", "2026-09-30"]);
  });

  it("los mensajes de la web antes de enviar son los mismos que responde la API", () => {
    const hoy = "2026-10-15";
    expect(validarUso({ minutos: "30", fecha: "2026-10-16" }, hoy).fecha).toBe(VI10.errores.fechaFutura.fecha[0]);
    expect(validarUso({ minutos: "0", fecha: "" }, hoy).minutos).toBe(VI10.errores.minutosCero.minutos[0]);
    expect(validarUso({ minutos: "44641", fecha: "" }, hoy).minutos).toBe(VI10.errores.minutosMaximo.minutos[0]);
    // Una fecha "" la API la rechaza: por eso registrarUso no la manda.
    expect(VI10.errores.fechaVacia).toHaveProperty("fecha");
  });
});
