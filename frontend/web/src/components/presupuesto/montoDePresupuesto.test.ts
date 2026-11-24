import { describe, expect, it } from 'vitest';
import {
  leerMontoEscrito,
  MENSAJE_MONTO_CON_DEMASIADOS_DECIMALES,
  MENSAJE_MONTO_CON_FORMATO_INVALIDO,
  MENSAJE_MONTO_DEMASIADO_GRANDE,
  MENSAJE_MONTO_NO_POSITIVO,
  MENSAJE_MONTO_VACIO,
  montoParaEditar,
} from './montoDePresupuesto';

const valido = (monto: string) => ({ valido: true, monto });
const noValido = (mensaje: string) => ({ valido: false, mensaje });

describe('el monto que se escribe para el presupuesto (S3-CH-27)', () => {
  it.each([
    ['200000', '200000'],
    ['5900', '5900'],
    ['1', '1'],
    ['99999999', '99999999'],
    ['  200000  ', '200000'],
  ])('«%s» es un monto de enteros', (escrito, esperado) => {
    expect(leerMontoEscrito(escrito)).toEqual(valido(esperado));
  });

  it.each([
    ['200000,50', '200000.50'],
    ['200000.50', '200000.50'],
    ['4,5', '4.5'],
    ['4.5', '4.5'],
    ['0,05', '0.05'],
    ['99999999,99', '99999999.99'],
  ])('«%s» lleva decimales: coma o punto, siempre sale con punto', (escrito, esperado) => {
    expect(leerMontoEscrito(escrito)).toEqual(valido(esperado));
  });

  it('los ceros a la izquierda se quitan, y los decimales se conservan tal cual', () => {
    expect(leerMontoEscrito('007')).toEqual(valido('7'));
    expect(leerMontoEscrito('0,50')).toEqual(valido('0.50'));
    expect(leerMontoEscrito('5900,00')).toEqual(valido('5900.00'));
  });

  it.each(['', '   '])('«%s» está vacío', (escrito) => {
    expect(leerMontoEscrito(escrito)).toEqual(noValido(MENSAJE_MONTO_VACIO));
  });

  it.each(['abc', '$5900', '5900 CLP', '5 900', '-5900', '+5900', '1e5', '5900,', ',50', '.5', '5,9,0', '1.234.567', '5900,5a', '٣٣'])(
    '«%s» no es solo números con un decimal: no se interpreta',
    (escrito) => {
      expect(leerMontoEscrito(escrito)).toEqual(noValido(MENSAJE_MONTO_CON_FORMATO_INVALIDO));
    },
  );

  it.each(['5.900', '5,900', '200.000', '0,001'])(
    '«%s» puede ser un miles o un decimal: se pide reescribirlo en vez de adivinar',
    (escrito) => {
      expect(leerMontoEscrito(escrito)).toEqual(noValido(MENSAJE_MONTO_CON_FORMATO_INVALIDO));
    },
  );

  it.each(['5900,5000', '5900.1234', '1,00001'])('«%s» tiene más de 2 decimales', (escrito) => {
    expect(leerMontoEscrito(escrito)).toEqual(noValido(MENSAJE_MONTO_CON_DEMASIADOS_DECIMALES));
  });

  it.each(['100000000', '123456789', '100000000,50'])('«%s» pasa de 8 dígitos enteros: no cabe en el servidor', (escrito) => {
    expect(leerMontoEscrito(escrito)).toEqual(noValido(MENSAJE_MONTO_DEMASIADO_GRANDE));
  });

  it('los ceros a la izquierda no cuentan para el máximo de dígitos', () => {
    expect(leerMontoEscrito('000000001')).toEqual(valido('1'));
  });

  it.each(['0', '00', '0,00', '0.0', '000,00'])('«%s» es cero: el presupuesto debe ser mayor a 0', (escrito) => {
    expect(leerMontoEscrito(escrito)).toEqual(noValido(MENSAJE_MONTO_NO_POSITIVO));
  });

  it('el monto más chico posible es válido', () => {
    expect(leerMontoEscrito('0,01')).toEqual(valido('0.01'));
  });
});

describe('el monto guardado, para editarlo (S3-CH-27)', () => {
  it.each([
    ['200000.00', '200000'],
    ['5900.50', '5900.5'],
    ['4.05', '4.05'],
    ['0.10', '0.1'],
    ['200000', '200000'],
    ['1000.00', '1000'],
  ])('«%s» se escribe «%s»', (guardado, esperado) => {
    expect(montoParaEditar(guardado)).toBe(esperado);
  });

  it('lo que se muestra para editar se vuelve a leer como el mismo monto', () => {
    for (const guardado of ['200000.00', '5900.50', '0.10', '12.34']) {
      const lectura = leerMontoEscrito(montoParaEditar(guardado));
      expect(lectura.valido && Number(lectura.monto)).toBe(Number(guardado));
    }
  });
});
