import { expect, it } from 'vitest';
import { crearAlmacenUsoSegmentado } from './almacenUsoSegmentado';

it('una escritura interrumpida conserva el cursor y la cola anteriores', async () => {
  const disco = new Map<string, string>();
  let restantes = Infinity;
  const almacen = crearAlmacenUsoSegmentado({ leer: async k => disco.get(k) ?? null,
    guardar: async (k, v) => { if (--restantes < 0) throw new Error('sin espacio'); disco.set(k, v); } }, 'cola');
  await almacen.guardar('original'.repeat(100));
  restantes = 1;
  await expect(almacen.guardar('nuevo'.repeat(200))).rejects.toThrow('sin espacio');
  expect(await almacen.leer()).toBe('original'.repeat(100));
});

it('un cambio de sesión entre fragmentos impide guardar datos con la identidad nueva', async () => {
  const disco = new Map<string, string>();
  let sesion = 'A'; let cambiar = false;
  const almacen = crearAlmacenUsoSegmentado({ identidad: () => sesion,
    leer: async k => disco.get(k) ?? null,
    guardar: async (k, v) => { disco.set(k, v); if (cambiar && k.endsWith('_0')) sesion = 'B'; } }, 'cola');
  await almacen.guardar('anterior');
  cambiar = true;
  await expect(almacen.guardar('nuevo'.repeat(200))).rejects.toThrow('sesión');
  expect(await almacen.leer()).toBe('anterior');
});
