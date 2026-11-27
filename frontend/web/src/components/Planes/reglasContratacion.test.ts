import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from '@ojoalgasto/shared';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';
import { crearClaveIdempotencia, esUrlCheckoutValida, mensajeDeErrorDeContratacion } from './reglasContratacion';

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('esUrlCheckoutValida', () => {
  it('acepta https sin credenciales', () => {
    expect(esUrlCheckoutValida('https://pagos.ejemplo.cl/api/pagos/mock/?token=abc')).toBe(true);
  });

  it('acepta http solo en el equipo local, como el backend', () => {
    expect(esUrlCheckoutValida('http://localhost:8000/api/pagos/mock/?token=x')).toBe(true);
    expect(esUrlCheckoutValida('http://127.0.0.1:8000/api/pagos/mock/?token=x')).toBe(true);
  });

  it('rechaza http hacia un host real', () => {
    expect(esUrlCheckoutValida('http://pagos.ejemplo.cl/api/pagos/mock/')).toBe(false);
  });

  it('rechaza usuario o contraseña incrustados, aunque el host parezca el correcto', () => {
    expect(esUrlCheckoutValida('https://usuario:clave@pagos.ejemplo.cl/')).toBe(false);
    expect(esUrlCheckoutValida('https://pagos.ejemplo.cl@sitio-ajeno.test/')).toBe(false);
  });

  it('rechaza otros esquemas y valores que no son texto', () => {
    expect(esUrlCheckoutValida('javascript:alert(1)')).toBe(false);
    expect(esUrlCheckoutValida(null)).toBe(false);
    expect(esUrlCheckoutValida(undefined)).toBe(false);
    expect(esUrlCheckoutValida(42)).toBe(false);
  });
});

describe('mensajeDeErrorDeContratacion', () => {
  it('explica cada respuesta del servidor que la persona puede resolver', () => {
    expect(mensajeDeErrorDeContratacion(new ErrorDeApi('prohibido', 403))).toMatch(/titular/);
    expect(mensajeDeErrorDeContratacion(new ErrorDeApi('conflicto', 409))).toMatch(/pendiente/);
    expect(mensajeDeErrorDeContratacion(new ErrorDeApi('no disponible', 503))).toMatch(/no está disponible/);
  });

  it('trata un fallo de red como falta de conexión', () => {
    expect(mensajeDeErrorDeContratacion(new TypeError('Failed to fetch'))).toBe(MENSAJE_SIN_RED);
  });

  it('nunca muestra un error como éxito', () => {
    expect(mensajeDeErrorDeContratacion(new Error('algo raro'))).toBe('No pudimos completar la operación. Inténtalo de nuevo.');
  });
});

describe('crearClaveIdempotencia', () => {
  it('genera un UUID v4 distinto en cada intento', () => {
    const primera = crearClaveIdempotencia();
    const segunda = crearClaveIdempotencia();
    expect(primera).toMatch(PATRON_UUID);
    expect(segunda).toMatch(PATRON_UUID);
    expect(primera).not.toBe(segunda);
  });
});
