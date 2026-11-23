import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCatalogosSuscripciones } from './catalogos';
import { pedir } from './cliente';
import {
  desplazarMes,
  etiquetaDelPeriodo,
  getResumenDelPeriodo,
  gastosConMovimiento,
  textoDelResumen,
  type ResumenDelPeriodo,
} from './resumenPanel';

vi.mock('./cliente', () => ({ pedir: vi.fn() }));
vi.mock('./catalogos', () => ({ getCatalogosSuscripciones: vi.fn() }));

const CONTEO = { activo: 2, prueba: 0, por_confirmar: 1, cancelado: 1, fantasma: 0, total: 4 };

function respuesta(moneda: string, extra: Record<string, unknown> = {}) {
  return {
    periodo: '2026-11',
    moneda,
    gasto_real: '25000.00',
    gasto_proyectado: '12990.00',
    total_estimado: '37990.00',
    conteo_estados: CONTEO,
    ...extra,
  };
}

function catalogoCon(...monedas: { codigo: string; activo: boolean }[]) {
  vi.mocked(getCatalogosSuscripciones).mockResolvedValue({
    monedas: monedas.map((moneda, orden) => ({ ...moneda, nombre: moneda.codigo, orden })),
  } as Awaited<ReturnType<typeof getCatalogosSuscripciones>>);
}

beforeEach(() => {
  vi.mocked(pedir).mockReset();
  vi.mocked(getCatalogosSuscripciones).mockReset();
});

describe('resumen del panel (VI-06)', () => {
  it('pide una vez por cada moneda activa del catálogo y no mezcla importes', async () => {
    catalogoCon({ codigo: 'CLP', activo: true }, { codigo: 'USD', activo: true }, { codigo: 'EUR', activo: false });
    vi.mocked(pedir).mockImplementation(async (ruta: string) =>
      ruta.includes('moneda=USD') ? respuesta('USD', { gasto_real: '10.50', gasto_proyectado: '0.00', total_estimado: '10.50' }) : respuesta('CLP'),
    );

    const resumen = await getResumenDelPeriodo('2026-11');

    expect(pedir).toHaveBeenCalledTimes(2);
    expect(pedir).toHaveBeenCalledWith('/suscripciones/resumen/?mes=2026-11&moneda=CLP');
    expect(pedir).toHaveBeenCalledWith('/suscripciones/resumen/?mes=2026-11&moneda=USD');
    expect(resumen.gastos).toEqual([
      { moneda: 'CLP', gastoReal: 25000, gastoProyectado: 12990, totalEstimado: 37990 },
      { moneda: 'USD', gastoReal: 10.5, gastoProyectado: 0, totalEstimado: 10.5 },
    ]);
    expect(resumen.conteo).toEqual(CONTEO);
    expect(resumen.periodo).toBe('2026-11');
  });

  it('un mes mal escrito no se manda al backend', async () => {
    await expect(getResumenDelPeriodo('2026-13')).rejects.toThrow(RangeError);
    expect(getCatalogosSuscripciones).not.toHaveBeenCalled();
    expect(pedir).not.toHaveBeenCalled();
  });

  it('sin monedas activas en el catálogo falla en vez de mostrar un resumen vacío', async () => {
    catalogoCon({ codigo: 'CLP', activo: false });
    await expect(getResumenDelPeriodo('2026-11')).rejects.toThrow(RangeError);
  });

  it('si falla la consulta de una moneda, falla todo el resumen', async () => {
    catalogoCon({ codigo: 'CLP', activo: true }, { codigo: 'USD', activo: true });
    vi.mocked(pedir).mockImplementation(async (ruta: string) => {
      if (ruta.includes('moneda=USD')) throw new TypeError('Failed to fetch');
      return respuesta('CLP');
    });
    await expect(getResumenDelPeriodo('2026-11')).rejects.toThrow(TypeError);
  });

  it.each([
    ['un importe que no es número', { gasto_real: 'abc' }],
    ['un importe vacío', { gasto_proyectado: '' }],
    ['un importe ausente', { total_estimado: undefined }],
    ['un periodo distinto al pedido', { periodo: '2026-10' }],
    ['una moneda distinta a la pedida', { moneda: 'USD' }],
    ['un conteo con un estado que falta', { conteo_estados: { activo: 1 } }],
    ['un conteo negativo', { conteo_estados: { ...CONTEO, activo: -1 } }],
  ])('rechaza una respuesta con %s', async (_caso, cambio) => {
    catalogoCon({ codigo: 'CLP', activo: true });
    vi.mocked(pedir).mockResolvedValue(respuesta('CLP', cambio));
    await expect(getResumenDelPeriodo('2026-11')).rejects.toThrow(RangeError);
  });

  it('un backend que responde otra cosa (no un objeto) es un error', async () => {
    catalogoCon({ codigo: 'CLP', activo: true });
    vi.mocked(pedir).mockResolvedValue(null);
    await expect(getResumenDelPeriodo('2026-11')).rejects.toThrow(RangeError);
  });
});

describe('ayudas del resumen', () => {
  const vacio: ResumenDelPeriodo = {
    periodo: '2026-11',
    conteo: { activo: 0, prueba: 0, por_confirmar: 0, cancelado: 0, fantasma: 0, total: 0 },
    gastos: [{ moneda: 'CLP', gastoReal: 0, gastoProyectado: 0, totalEstimado: 0 }],
  };

  it('omite las monedas sin movimiento', () => {
    const resumen = { ...vacio, gastos: [...vacio.gastos, { moneda: 'USD', gastoReal: 5, gastoProyectado: 0, totalEstimado: 5 }] };
    expect(gastosConMovimiento(resumen).map((gasto) => gasto.moneda)).toEqual(['USD']);
    expect(gastosConMovimiento(vacio)).toEqual([]);
  });

  it('desplaza meses cruzando el año', () => {
    expect(desplazarMes('2026-12', 1)).toBe('2027-01');
    expect(desplazarMes('2026-01', -1)).toBe('2025-12');
    expect(desplazarMes('2026-11', 0)).toBe('2026-11');
    expect(desplazarMes('2026-03', -15)).toBe('2024-12');
  });

  it('da el nombre del periodo con mayúscula', () => {
    expect(etiquetaDelPeriodo('2026-11')).toBe('Noviembre de 2026');
  });

  it('el texto del resumen dice el periodo, la moneda de cada importe y el conteo', () => {
    const resumen: ResumenDelPeriodo = {
      periodo: '2026-11',
      conteo: CONTEO,
      gastos: [{ moneda: 'CLP', gastoReal: 25000, gastoProyectado: 12990, totalEstimado: 37990 }],
    };
    const texto = textoDelResumen(resumen);
    expect(texto).toContain('Resumen de Noviembre de 2026.');
    expect(texto).toContain('En CLP: gastado $25.000, por cobrar $12.990, total estimado $37.990.');
    expect(texto).toContain('4 en total');
    expect(texto).toContain('2 activas');
  });

  it('un periodo sin movimiento no produce NaN ni inventa cifras', () => {
    const texto = textoDelResumen(vacio);
    expect(texto).toContain('Sin gastos registrados ni proyectados.');
    expect(texto).not.toMatch(/NaN|undefined/);
  });
});
