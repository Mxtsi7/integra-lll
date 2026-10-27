import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { totalesPorMoneda } from '../calculos';
import { configurarApi } from './cliente';
import { esMesValido, getCobrosDelMes } from './calendario';

const URL_BASE = 'http://api.test/api';

/** Copiado de lo que devuelve VI-07 (services/subscriptions/tests/test_calendario.py). */
const RESPUESTA_API = [
  {
    id: '0d4a1f3e-1111-2222-3333-444455556666',
    suscripcion_id: '6b112d20-c2be-4337-80c3-f2023eb44a3b',
    fecha: '2026-10-05',
    servicio: 'Netflix',
    importe: '14990.00',
    moneda: 'CLP',
    tipo: 'confirmado',
  },
  {
    id: '6b112d20-c2be-4337-80c3-f2023eb44a3b',
    suscripcion_id: '6b112d20-c2be-4337-80c3-f2023eb44a3b',
    fecha: '2026-10-24',
    servicio: 'iCloud',
    importe: '4.99',
    moneda: 'USD',
    tipo: 'proyectado',
  },
];

let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  configurarApi({ urlBase: URL_BASE });
  fetchFalso = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => RESPUESTA_API });
  vi.stubGlobal('fetch', fetchFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCobrosDelMes (VI-07)', () => {
  it('pide el mes con ?mes=YYYY-MM y convierte el importe a número', async () => {
    const cobros = await getCobrosDelMes('2026-10');

    expect(fetchFalso.mock.calls[0][0]).toBe(`${URL_BASE}/suscripciones/calendario-cobros/?mes=2026-10`);
    expect(cobros).toEqual([
      { ...RESPUESTA_API[0], importe: 14990 },
      { ...RESPUESTA_API[1], importe: 4.99 },
    ]);
  });

  it.each(['2026-13', '2026-1', '26-10', '2026-10-01', '', '2026-00'])(
    'un mes mal escrito (%j) no llega al backend',
    async (mes) => {
      await expect(getCobrosDelMes(mes)).rejects.toThrow(RangeError);
      expect(fetchFalso).not.toHaveBeenCalled();
    },
  );

  it('esMesValido acepta enero y diciembre', () => {
    expect(esMesValido('2026-01')).toBe(true);
    expect(esMesValido('2026-12')).toBe(true);
  });
});

describe('totalesPorMoneda', () => {
  it('no suma pesos con dólares', () => {
    expect(
      totalesPorMoneda([
        { importe: 9990, moneda: 'CLP' },
        { importe: 4.99, moneda: 'USD' },
        { importe: 5990, moneda: 'CLP' },
      ]),
    ).toEqual([
      { moneda: 'CLP', total: 15980 },
      { moneda: 'USD', total: 4.99 },
    ]);
  });

  it('suma en centavos: 1,1 + 2,2 da 3,3 exacto (en decimales daría 3,3000000000000003)', () => {
    expect(totalesPorMoneda([{ importe: 1.1, moneda: 'USD' }, { importe: 2.2, moneda: 'USD' }])).toEqual([
      { moneda: 'USD', total: 3.3 },
    ]);
  });

  it('sin montos no hay totales', () => {
    expect(totalesPorMoneda([])).toEqual([]);
  });
});
