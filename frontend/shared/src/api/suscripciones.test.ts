import { describe, it, expect, vi, beforeEach } from "vitest";
import { configurarApi } from "./cliente";
import { getSuscripciones } from "./suscripciones";
import { gastoProyectado } from "../calculos";

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
