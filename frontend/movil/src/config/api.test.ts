import { describe, expect, it } from 'vitest';
import { resolverUrlApi, urlApiValida } from './api';

const OPCIONES = { plataforma: 'ios', produccion: false };

describe('resolverUrlApi (VI-14)', () => {
  it('exige EXPO_PUBLIC_API_URL: no hay localhost por defecto', () => {
    expect(() => resolverUrlApi('', OPCIONES)).toThrow(
      /Falta EXPO_PUBLIC_API_URL/,
    );
    expect(() => resolverUrlApi('   ', OPCIONES)).toThrow(
      /Falta EXPO_PUBLIC_API_URL/,
    );
  });

  it('rechaza localhost en un teléfono y explica qué usar', () => {
    for (const host of ['localhost', '127.0.0.1', '0.0.0.0']) {
      expect(() =>
        resolverUrlApi(`http://${host}:8000/api`, OPCIONES),
      ).toThrow(/propio teléfono/);
      expect(() =>
        resolverUrlApi(`http://${host}:8000/api`, { ...OPCIONES, plataforma: 'android' }),
      ).toThrow(/IP LAN|10\.0\.2\.2/);
    }
  });

  it('en web sí acepta localhost (el navegador corre en el mismo equipo)', () => {
    expect(
      resolverUrlApi('http://localhost:8000/api', {
        plataforma: 'web',
        produccion: false,
      }),
    ).toBe('http://localhost:8000/api');
  });

  it('acepta la IP LAN y 10.0.2.2 en Android', () => {
    expect(resolverUrlApi('http://192.168.1.20:8000/api', OPCIONES)).toBe(
      'http://192.168.1.20:8000/api',
    );
    expect(
      resolverUrlApi('http://10.0.2.2:8000/api', {
        plataforma: 'android',
        produccion: false,
      }),
    ).toBe('http://10.0.2.2:8000/api');
  });

  it('normaliza la barra final y exige que la base termine en /api', () => {
    expect(resolverUrlApi('http://192.168.1.20:8000/api/', OPCIONES)).toBe(
      'http://192.168.1.20:8000/api',
    );
    expect(() =>
      resolverUrlApi('http://192.168.1.20:8000', OPCIONES),
    ).toThrow(/terminar en \/api/);
    expect(() =>
      resolverUrlApi('http://192.168.1.20:8000/api/v1', OPCIONES),
    ).toThrow(/terminar en \/api/);
  });

  it('en producción exige https', () => {
    expect(() =>
      resolverUrlApi('http://192.168.1.20:8000/api', {
        ...OPCIONES,
        produccion: true,
      }),
    ).toThrow(/https/);
    expect(
      resolverUrlApi('https://api.ejemplo.cl/api', {
        ...OPCIONES,
        produccion: true,
      }),
    ).toBe('https://api.ejemplo.cl/api');
  });

  it('rechaza credenciales embebidas, query y esquemas raros', () => {
    expect(() =>
      resolverUrlApi('http://ana:clave@192.168.1.20:8000/api', OPCIONES),
    ).toThrow(/usuario o contraseña/);
    expect(() =>
      resolverUrlApi('http://192.168.1.20:8000/api?token=x', OPCIONES),
    ).toThrow(/query string/);
    expect(() =>
      resolverUrlApi('ftp://192.168.1.20:8000/api', OPCIONES),
    ).toThrow(/http:\/\//);
    expect(() => resolverUrlApi('no-es-una-url', OPCIONES)).toThrow(
      /no es una URL válida/,
    );
  });

  it('urlApiValida resume el resultado sin lanzar', () => {
    expect(urlApiValida('http://192.168.1.20:8000/api', OPCIONES)).toBe(true);
    expect(urlApiValida('', OPCIONES)).toBe(false);
    expect(urlApiValida('http://localhost:8000/api', OPCIONES)).toBe(false);
  });
});
