import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurarApi, ErrorDeApi } from './cliente';
import { getComparacionDePresupuesto, guardarPresupuesto, type ComparacionDePresupuesto } from './presupuesto';

const URL_BASE = 'http://api.test/api';

/** Con la forma de PresupuestoComparacionSerializer (services/subscriptions/app/serializers.py). */
const COMPARACION: ComparacionDePresupuesto = {
  mes: '2026-11',
  moneda: 'CLP',
  presupuesto: '200000.00',
  gasto_real: '120000.00',
  gasto_proyectado: '45000.00',
  total_esperado: '165000.00',
  diferencia: '35000.00',
  porcentaje_consumido: 82.5,
  alerta_superado: false,
};

let fetchFalso: ReturnType<typeof vi.fn>;

function responderCon(estado: number, cuerpo: unknown) {
  fetchFalso.mockResolvedValue({ ok: estado >= 200 && estado < 300, status: estado, json: async () => cuerpo });
}

beforeEach(() => {
  configurarApi({ urlBase: URL_BASE });
  fetchFalso = vi.fn();
  responderCon(200, COMPARACION);
  vi.stubGlobal('fetch', fetchFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getComparacionDePresupuesto (VI-05)', () => {
  it('pide el mes y la moneda por GET y devuelve la respuesta tal cual, sin recalcular nada', async () => {
    const comparacion = await getComparacionDePresupuesto('2026-11', 'CLP');

    expect(fetchFalso.mock.calls[0][0]).toBe(`${URL_BASE}/suscripciones/presupuesto/?mes=2026-11&moneda=CLP`);
    expect(fetchFalso.mock.calls[0][1].method).toBe('GET');
    expect(comparacion).toEqual(COMPARACION);
  });

  it('un mes sin presupuesto llega con presupuesto y diferencia en null: no se convierten en 0', async () => {
    const sinPresupuesto = { ...COMPARACION, presupuesto: null, diferencia: null, porcentaje_consumido: 0, alerta_superado: false };
    responderCon(200, sinPresupuesto);

    const comparacion = await getComparacionDePresupuesto('2026-11', 'CLP');

    expect(comparacion.presupuesto).toBeNull();
    expect(comparacion.diferencia).toBeNull();
  });

  it.each(['', '2026-13', '2026-1', '2026-00', '2026-11-01', 'noviembre'])('un mes mal escrito (%j) no llega al servidor', async (mes) => {
    await expect(getComparacionDePresupuesto(mes, 'CLP')).rejects.toThrow(RangeError);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it.each(['', 'clp', 'CL', 'CLPP', ' CLP', 'C1P'])(
    'una moneda mal escrita (%j) no llega al servidor: sin moneda el servidor tomaría pesos',
    async (moneda) => {
      await expect(getComparacionDePresupuesto('2026-11', moneda)).rejects.toThrow(RangeError);
      expect(fetchFalso).not.toHaveBeenCalled();
    },
  );

  it('una moneda fuera del catálogo (400) llega como ErrorDeApi con el detalle por campo', async () => {
    responderCon(400, { moneda: ['Selecciona una moneda del catálogo.'] });

    const error = await getComparacionDePresupuesto('2026-11', 'XXX').catch((falla: unknown) => falla);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ status: 400, campos: { moneda: ['Selecciona una moneda del catálogo.'] } });
  });

  it('un fallo del servidor (500) se propaga: no se convierte en una comparación vacía', async () => {
    responderCon(500, { detail: 'Error interno' });

    await expect(getComparacionDePresupuesto('2026-11', 'CLP')).rejects.toMatchObject({ status: 500 });
  });
});

describe('guardarPresupuesto (VI-05)', () => {
  const GUARDADO = {
    id: '5f0c2c2e-8d6b-4a53-9a6f-0c8d1f4c7e11',
    mes: '2026-11',
    moneda: 'CLP',
    monto: '200000.00',
    creado_en: '2026-11-18T12:00:00-03:00',
    actualizado_en: '2026-11-18T12:00:00-03:00',
  };

  it('manda mes, moneda y monto por POST, con el monto como texto, y devuelve lo guardado', async () => {
    responderCon(200, GUARDADO);

    const guardado = await guardarPresupuesto({ mes: '2026-11', moneda: 'CLP', monto: '200000.50' });

    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(url).toBe(`${URL_BASE}/suscripciones/presupuesto/`);
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body)).toEqual({ mes: '2026-11', moneda: 'CLP', monto: '200000.50' });
    expect(guardado).toEqual(GUARDADO);
  });

  it('el monto va como texto en el cuerpo: un número perdería exactitud', async () => {
    responderCon(200, GUARDADO);

    await guardarPresupuesto({ mes: '2026-11', moneda: 'CLP', monto: '0.10' });

    expect(typeof JSON.parse(fetchFalso.mock.calls[0][1].body).monto).toBe('string');
  });

  it.each(['', '2026-13', '2026-1', 'noviembre'])('un mes mal escrito (%j) no se guarda', async (mes) => {
    await expect(guardarPresupuesto({ mes, moneda: 'CLP', monto: '1000' })).rejects.toThrow(RangeError);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it.each(['', 'clp', 'CL', 'CLPP'])('una moneda mal escrita (%j) no se guarda: sin moneda el servidor guardaría en pesos', async (moneda) => {
    await expect(guardarPresupuesto({ mes: '2026-11', moneda, monto: '1000' })).rejects.toThrow(RangeError);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('un monto rechazado (400) llega como ErrorDeApi con el mensaje del servidor en el campo monto', async () => {
    responderCon(400, { monto: ['El monto presupuestado debe ser mayor a 0.'] });

    const error = await guardarPresupuesto({ mes: '2026-11', moneda: 'CLP', monto: '0' }).catch((falla: unknown) => falla);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ status: 400, campos: { monto: ['El monto presupuestado debe ser mayor a 0.'] } });
  });

  it('sin organización activa (403) llega como ErrorDeApi con su estado', async () => {
    responderCon(403, { detail: 'La cabecera X-Organizacion-Id es obligatoria.' });

    const error = await guardarPresupuesto({ mes: '2026-11', moneda: 'CLP', monto: '1000' }).catch((falla: unknown) => falla);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({ status: 403, message: 'La cabecera X-Organizacion-Id es obligatoria.' });
  });
});
