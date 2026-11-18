import { describe, expect, it } from 'vitest';
import { formatearFecha } from '@ojoalgasto/shared';
import { candidatoDePrueba } from '../../test/candidatosDePrueba';
import {
  esFechaReal,
  FECHA_SIN_INDICAR,
  fechaLegible,
  fechaParaLeer,
  fraseDeLaFecha,
  importeDelCandidato,
  importeParaLeer,
  MONEDA_SIN_INDICAR,
  procedenciaLegible,
} from './presentacionDeCandidato';

describe('una fecha real (S3-CH-05)', () => {
  it.each(['2026-10-28', '2026-01-01', '2026-12-31', '2028-02-29'])('%s es un día del calendario', (fecha) => {
    expect(esFechaReal(fecha)).toBe(true);
  });

  it.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-10-32', '2026-10-00', '2026-1-5', '2026-10-28T10:00:00', '28/10/2026', 'ayer', ''])(
    '«%s» no lo es: no se corrige ni se completa',
    (fecha) => {
      expect(esFechaReal(fecha)).toBe(false);
    },
  );
});

describe('la fecha con formato (S3-CH-05)', () => {
  it('con un día real usa el formato de la web', () => {
    expect(fechaLegible('2026-10-28')).toBe(formatearFecha('2026-10-28'));
    expect(fechaParaLeer('2026-10-28')).toBe(formatearFecha('2026-10-28'));
  });

  it('con una fecha que no es un día real da null, y no lanza como formatearFecha', () => {
    expect(() => formatearFecha('')).toThrow();
    expect(fechaLegible('')).toBeNull();
    expect(fechaLegible('2026-02-30')).toBeNull();
  });

  it('para leerla, una fecha que no es real dice que no se indicó', () => {
    expect(fechaParaLeer('')).toBe(FECHA_SIN_INDICAR);
    expect(FECHA_SIN_INDICAR).toBe('fecha sin indicar');
  });
});

describe('lo que dice la fecha según el tipo de mensaje (S3-CH-05, contrato v1)', () => {
  const fecha = formatearFecha('2026-10-28');
  const con = (parcial: Parameters<typeof candidatoDePrueba>[0]) => fraseDeLaFecha(candidatoDePrueba({ fecha: '2026-10-28', ...parcial }));

  it('un cobro realizado dice el día en que se cobró', () => {
    expect(con({ tipo_mensaje: 'cobro_realizado' })).toBe(`el ${fecha}`);
  });

  it('un aviso de cobro dice que el cobro está previsto para ese día: no es un pago hecho', () => {
    expect(con({ tipo_mensaje: 'aviso_de_cobro' })).toBe(`previsto para el ${fecha}`);
  });

  it('un pago fallido dice que fue el día de un intento', () => {
    expect(con({ tipo_mensaje: 'pago_fallido' })).toBe(`intento el ${fecha}`);
  });

  it.each(['constructor', 'tipo_nuevo', ''])('un tipo «%s» que la web no conoce solo dice la fecha, sin suponer qué significa', (tipo) => {
    expect(con({ tipo_mensaje: tipo as never })).toBe(`fecha ${fecha}`);
  });

  it('sin una fecha real dice que no se indicó, sea cual sea el tipo', () => {
    expect(con({ fecha: '', tipo_mensaje: 'cobro_realizado' })).toBe(FECHA_SIN_INDICAR);
    expect(con({ fecha: '2026-02-30', tipo_mensaje: 'aviso_de_cobro' })).toBe(FECHA_SIN_INDICAR);
  });

  it('si el productor usó la fecha de recepción como supuesto, lo dice: no es la fecha del cobro', () => {
    expect(con({ tipo_mensaje: 'aviso_de_cobro', evidencia: { fecha_origen: 'recepcion' } })).toBe(
      `sin fecha de cobro: se usó la de recepción del correo (${fecha})`,
    );
  });

  it('otro valor en fecha_origen no cuenta como supuesto', () => {
    expect(con({ tipo_mensaje: 'cobro_realizado', evidencia: { fecha_origen: 'mensaje' } })).toBe(`el ${fecha}`);
    expect(con({ tipo_mensaje: 'cobro_realizado', evidencia: { fecha_origen: 'Recepcion' } })).toBe(`el ${fecha}`);
  });

  it('un supuesto sin fecha real sigue diciendo que no hay fecha, y no inventa una', () => {
    expect(con({ fecha: '', evidencia: { fecha_origen: 'recepcion' } })).toBe(FECHA_SIN_INDICAR);
  });
});

describe('de dónde salió el cobro (S3-CH-05)', () => {
  it('un CSV dice además la fila de la cartola', () => {
    expect(procedenciaLegible(candidatoDePrueba({ origen: 'csv', origen_legible: 'Archivo CSV o cartola', evidencia: { fila: '3' } }))).toBe(
      'Archivo CSV o cartola · fila 3',
    );
  });

  it('un CSV sin fila, o con la fila en blanco, dice solo el origen', () => {
    expect(procedenciaLegible(candidatoDePrueba({ origen_legible: 'Archivo CSV o cartola', evidencia: {} }))).toBe('Archivo CSV o cartola');
    expect(procedenciaLegible(candidatoDePrueba({ origen_legible: 'Archivo CSV o cartola', evidencia: { fila: '  ' } }))).toBe('Archivo CSV o cartola');
  });

  it('una fila que no es texto no se adivina', () => {
    expect(procedenciaLegible(candidatoDePrueba({ origen_legible: 'Archivo CSV o cartola', evidencia: { fila: 3 } }))).toBe('Archivo CSV o cartola');
  });

  it('un correo no dice fila, aunque la evidencia traiga una', () => {
    expect(procedenciaLegible(candidatoDePrueba({ origen: 'correo', origen_legible: 'Correo', evidencia: { fila: '3' } }))).toBe('Correo');
  });

  it('sin el origen legible dice solo la fila, sin separadores sueltos', () => {
    expect(procedenciaLegible(candidatoDePrueba({ origen_legible: '', evidencia: { fila: '7' } }))).toBe('fila 7');
    expect(procedenciaLegible(candidatoDePrueba({ origen_legible: '', evidencia: {} }))).toBe('');
  });
});

describe('el importe y la moneda (S3-CH-05)', () => {
  const importe = (importeTexto: string, moneda: string) => importeDelCandidato({ importe: importeTexto, moneda });

  it('un monto en pesos lleva su formato y la moneda aparte', () => {
    expect(importe('5900.00', 'CLP')).toEqual({ texto: '$5.900', moneda: 'CLP' });
    expect(importe('5990', 'CLP')).toEqual({ texto: '$5.990', moneda: 'CLP' });
  });

  it('un monto en dólares lleva los decimales de su moneda', () => {
    expect(importe('4.5', 'USD')).toEqual({ texto: 'US$4,50', moneda: 'USD' });
    expect(importe('4.50', 'USD')).toEqual({ texto: 'US$4,50', moneda: 'USD' });
  });

  it('los ceros de la derecha no cuentan como precisión', () => {
    expect(importe('4.5000', 'USD').texto).toBe('US$4,50');
    expect(importe('5900.000', 'CLP').texto).toBe('$5.900');
  });

  it('los decimales que la moneda no usa pero el importe sí traen NO se redondean', () => {
    expect(importe('5900.50', 'CLP').texto).toBe('$5.900,5');
    expect(importe('5900.50', 'CLP').texto).not.toBe('$5.901');
    expect(importe('0.0000001', 'CLP').texto).toBe('$0,0000001');
  });

  it('los decimales de más en dólares tampoco se redondean', () => {
    expect(importe('4.123', 'USD').texto).toBe('US$4,123');
  });

  it('sin moneda dice que no se indicó, en vez de suponer pesos', () => {
    expect(importe('5900.00', '')).toEqual({ texto: `5900.00 (${MONEDA_SIN_INDICAR})`, moneda: null });
    expect(importe('5900.00', '   ').texto).toBe('5900.00 (moneda sin indicar)');
    expect(importe('5900.00', '').texto).not.toContain('CLP');
    expect(importe('5900.00', '').texto).not.toContain('$');
  });

  it('sin moneda ni importe dice solo que falta la moneda', () => {
    expect(importe('', '').texto).toBe('(moneda sin indicar)');
  });

  it('un importe que no es un número se muestra tal cual, con la moneda de la API', () => {
    expect(importe('no es un número', 'CLP')).toEqual({ texto: 'no es un número CLP', moneda: null });
    expect(importe('', 'CLP')).toEqual({ texto: 'CLP', moneda: null });
  });

  it('una moneda que Intl no entiende deja el importe crudo y no rompe', () => {
    expect(importe('5900.00', 'pesos')).toEqual({ texto: '5900.00 pesos', moneda: null });
  });

  it('un importe con más dígitos que un número exacto se muestra como lo mandó la API, sin dígitos inventados', () => {
    expect(importe('12345678901234567890.00', 'CLP')).toEqual({ texto: '12345678901234567890.00 CLP', moneda: null });
    expect(importe('0.00000000000000001', 'CLP').texto).toBe('0.00000000000000001 CLP');
  });

  it('una moneda con espacios alrededor se usa sin ellos', () => {
    expect(importe('5900.00', ' CLP ')).toEqual({ texto: '$5.900', moneda: 'CLP' });
  });

  it('para leerlo en una etiqueta junta el monto y la moneda, sin repetirla cuando ya está', () => {
    expect(importeParaLeer(importe('5900.00', 'CLP'))).toBe('$5.900 CLP');
    expect(importeParaLeer(importe('no es un número', 'CLP'))).toBe('no es un número CLP');
    expect(importeParaLeer(importe('5900.00', ''))).toBe('5900.00 (moneda sin indicar)');
  });
});
