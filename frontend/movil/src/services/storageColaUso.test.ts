import { afterEach, expect, it } from 'vitest';
import { crearAlmacenUsoSegmentado } from './almacenUsoSegmentado';
import { CLAVES_SEGURAS, guardarDatoSeguro, inicializarStorageSeguro, leerDatoSeguro, limpiarSesionSegura, __reiniciarEstadoParaPruebas } from './storageSeguro';

afterEach(() => __reiniciarEstadoParaPruebas());

it('si falla la purga conserva el índice y el siguiente cierre elimina también los fragmentos restantes', async () => {
  const disco = new Map<string, string>();
  let fallar = true;
  inicializarStorageSeguro({ getItemAsync: async k => disco.get(k) ?? null,
    setItemAsync: async (k, v) => { disco.set(k, v); }, deleteItemAsync: async k => {
      if (fallar && k === `${CLAVES_SEGURAS.COLA_USO}_0_0`) throw new Error('Keystore ocupado');
      disco.delete(k);
    } });
  const almacen = crearAlmacenUsoSegmentado({ leer: leerDatoSeguro, guardar: guardarDatoSeguro }, CLAVES_SEGURAS.COLA_USO);
  await almacen.guardar('eventos'.repeat(100));
  await expect(limpiarSesionSegura()).rejects.toThrow();
  expect(disco.get(CLAVES_SEGURAS.COLA_USO)).toContain('reservas');
  fallar = false;
  await limpiarSesionSegura();
  expect([...disco.keys()].filter(k => k.startsWith(CLAVES_SEGURAS.COLA_USO))).toEqual([]);
});
