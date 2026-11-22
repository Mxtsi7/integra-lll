import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, pedir } from './cliente';
import { exportarCobrosCsv, getResumenDelMes, rangoDelMes } from './informes';

// Solo se simula pedir: ErrorDeApi es el real.
vi.mock('./cliente', async (importarOriginal) => ({ ...(await importarOriginal<typeof import('./cliente')>()), pedir: vi.fn() }));

describe('resumen de un mes (S3-CH-25, VI-06)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset().mockResolvedValue({ periodo: '2026-10', moneda: 'CLP' });
  });

  it('pide el mes y la moneda', async () => {
    await getResumenDelMes('2026-10', 'CLP');

    expect(pedir).toHaveBeenCalledWith('/suscripciones/resumen/?mes=2026-10&moneda=CLP');
  });

  it('manda la moneda como está: el servidor valida contra su catálogo', async () => {
    await getResumenDelMes('2026-10', 'usd');

    expect(pedir).toHaveBeenCalledWith('/suscripciones/resumen/?mes=2026-10&moneda=usd');
  });

  it('devuelve el resumen tal cual lo mandó el servidor', async () => {
    const resumen = { periodo: '2026-10', moneda: 'CLP', gasto_real: '5900.00', gasto_proyectado: '0.00', total_estimado: '5900.00' };
    vi.mocked(pedir).mockResolvedValue(resumen);

    await expect(getResumenDelMes('2026-10', 'CLP')).resolves.toEqual(resumen);
  });

  it('no atrapa los errores: quien llama decide qué decir de cada uno', async () => {
    vi.mocked(pedir).mockRejectedValue(new ErrorDeApi('Debe tener el formato YYYY-MM.', 400));

    await expect(getResumenDelMes('2026-13', 'CLP')).rejects.toBeInstanceOf(ErrorDeApi);
  });
});

describe('rango de un mes (S3-CH-25)', () => {
  it.each([
    ['2026-10', '2026-10-01', '2026-10-31'],
    ['2026-11', '2026-11-01', '2026-11-30'],
    ['2026-02', '2026-02-01', '2026-02-28'],
    ['2028-02', '2028-02-01', '2028-02-29'],
    ['2026-12', '2026-12-01', '2026-12-31'],
    ['2026-01', '2026-01-01', '2026-01-31'],
  ])('%s va del %s al %s', (mes, desde, hasta) => {
    expect(rangoDelMes(mes)).toEqual({ desde, hasta });
  });
});

describe('exportar los cobros en CSV (S3-CH-25, VI-25)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset().mockResolvedValue('servicio,categoria,monto,moneda,fecha,origen,estado\r\n');
  });

  it('pide el rango y la moneda, y lee la respuesta como texto', async () => {
    await exportarCobrosCsv({ desde: '2026-10-01', hasta: '2026-10-31', moneda: 'CLP' });

    expect(pedir).toHaveBeenCalledWith('/suscripciones/exportar-csv/?desde=2026-10-01&hasta=2026-10-31&moneda=CLP', { respuesta: 'texto' });
  });

  it('devuelve el texto del archivo tal cual', async () => {
    const csv = 'servicio,categoria,monto,moneda,fecha,origen,estado\r\nSpotify,musica,5900.00,CLP,2026-10-05,manual,activo\r\n';
    vi.mocked(pedir).mockResolvedValue(csv);

    await expect(exportarCobrosCsv({ desde: '2026-10-01', hasta: '2026-10-31', moneda: 'CLP' })).resolves.toBe(csv);
  });

  it('no atrapa los errores: quien llama decide qué decir de cada uno', async () => {
    vi.mocked(pedir).mockRejectedValue(new ErrorDeApi('Debe ser igual o posterior a la fecha desde.', 400));

    await expect(exportarCobrosCsv({ desde: '2026-10-31', hasta: '2026-10-01', moneda: 'CLP' })).rejects.toBeInstanceOf(ErrorDeApi);
  });
});
