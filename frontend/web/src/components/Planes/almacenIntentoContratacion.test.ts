import { describe, expect, it } from 'vitest';
import { crearAlmacenIntento } from './almacenIntentoContratacion';

/** Almacenamiento en memoria con la misma forma que localStorage. */
function almacenFalso(): Storage {
  const datos = new Map<string, string>();
  return {
    getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => void datos.set(clave, valor),
    removeItem: (clave: string) => void datos.delete(clave),
    clear: () => datos.clear(),
    key: () => null,
    get length() {
      return datos.size;
    },
  } as Storage;
}

describe('almacén del intento de contratación', () => {
  it('guarda la clave y el id, y los vuelve a leer para el mismo alcance', () => {
    const storage = almacenFalso();
    const almacen = crearAlmacenIntento('7:org-a', () => storage);
    almacen.guardar({ clave: 'clave-1', contratoId: 'c-1' });
    expect(almacen.leer()).toEqual({ clave: 'clave-1', contratoId: 'c-1' });
  });

  it('ignora un intento cuyo alcance no coincide con quien lo pide', () => {
    const storage = almacenFalso();
    storage.setItem('contratacion_pendiente_7:org-a', JSON.stringify({ alcance: '8:org-b', clave: 'ajena', contratoId: 'c-9' }));
    const almacen = crearAlmacenIntento('7:org-a', () => storage);
    expect(almacen.leer()).toBeNull();
  });

  it('si el navegador no deja guardar, no rompe la pantalla', () => {
    const almacenRoto = crearAlmacenIntento('7:org-a', () => {
      throw new Error('storage bloqueado');
    });
    expect(() => almacenRoto.guardar({ clave: 'k', contratoId: null })).not.toThrow();
    expect(almacenRoto.leer()).toBeNull();
    expect(() => almacenRoto.borrar()).not.toThrow();
  });

  it('borrar elimina el intento guardado', () => {
    const storage = almacenFalso();
    const almacen = crearAlmacenIntento('7:org-a', () => storage);
    almacen.guardar({ clave: 'clave-1', contratoId: null });
    expect(almacen.leer()).not.toBeNull();
    almacen.borrar();
    expect(almacen.leer()).toBeNull();
  });
});
