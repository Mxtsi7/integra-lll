// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarArchivo } from './descargas';

describe('guardar un archivo desde el navegador (S3-CH-25)', () => {
  const crearDireccion = vi.fn();
  const revocarDireccion = vi.fn();
  let enlacesPulsados: HTMLAnchorElement[];

  beforeEach(() => {
    vi.useFakeTimers();
    enlacesPulsados = [];
    crearDireccion.mockReset().mockReturnValue('blob:descarga-de-prueba');
    revocarDireccion.mockReset();
    // jsdom no trae estas dos: es lo único que se agrega para poder probar.
    URL.createObjectURL = crearDireccion;
    URL.revokeObjectURL = revocarDireccion;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      enlacesPulsados.push(this);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('pulsa un enlace de descarga con el nombre y la dirección del archivo', () => {
    guardarArchivo('cobros.csv', 'a,b\r\n', 'text/csv;charset=utf-8');

    expect(enlacesPulsados).toHaveLength(1);
    expect(enlacesPulsados[0].download).toBe('cobros.csv');
    expect(enlacesPulsados[0].href).toBe('blob:descarga-de-prueba');
  });

  it('el archivo lleva el tipo pedido y todo el contenido, con las tildes', () => {
    const contenido = 'servicio\r\nMúsica ñandú\r\n';

    guardarArchivo('cobros.csv', contenido, 'text/csv;charset=utf-8');

    const archivo = crearDireccion.mock.calls[0][0] as Blob;
    expect(archivo.type).toBe('text/csv;charset=utf-8');
    expect(archivo.size).toBe(new TextEncoder().encode(contenido).length);
  });

  it('no deja el enlace puesto en la página', () => {
    guardarArchivo('cobros.csv', 'a', 'text/csv');

    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('suelta la dirección del archivo después, no antes de pulsar el enlace', () => {
    guardarArchivo('cobros.csv', 'a', 'text/csv');

    expect(revocarDireccion).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revocarDireccion).toHaveBeenCalledWith('blob:descarga-de-prueba');
  });
});
