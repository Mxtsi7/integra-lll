import { describe, expect, it, vi } from 'vitest';
import { crearControlAsociacionPaquetes } from './asociacionPaquetes';

function crearAlmacen(valor: string | null = null) {
  let valorActual = valor;
  return {
    leer: vi.fn(async () => valorActual),
    guardar: vi.fn(async (valorGuardado: string) => { valorActual = valorGuardado; }),
  };
}

describe('asociación explícita de paquete Android y suscripción', () => {
  it('valida la pertenencia en backend y persiste el paquete solo para la sesión actual', async () => {
    const almacen = crearAlmacen();
    const control = crearControlAsociacionPaquetes({
      obtenerSesion: () => 'org:usuario:sesion-a',
      obtenerSuscripcion: async (id) => ({ id }),
      almacen,
    });

    await control.asociar('suscripcion-propia', 'com.ejemplo.musica');

    expect(almacen.guardar).toHaveBeenCalledWith(JSON.stringify({
      'org:usuario:sesion-a': [{ suscripcionId: 'suscripcion-propia', paquete: 'com.ejemplo.musica' }],
    }));
  });

  it('rechaza nombres de paquete inválidos y referencias ajenas sin persistir', async () => {
    const almacen = crearAlmacen();
    const obtenerSuscripcion = vi.fn(async () => { throw new Error('No autorizada'); });
    const control = crearControlAsociacionPaquetes({
      obtenerSesion: () => 'org:usuario:sesion-a', obtenerSuscripcion, almacen,
    });

    await expect(control.asociar('suscripcion-ajena', 'com.ejemplo/../privada')).rejects.toThrow('paquete Android');
    await expect(control.asociar('suscripcion-ajena', 'com.ejemplo.privada')).rejects.toThrow('No autorizada');
    expect(obtenerSuscripcion).toHaveBeenCalledOnce();
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('no expone asociaciones de otra sesión', async () => {
    const almacen = crearAlmacen(JSON.stringify({
      'org:usuario-a:sesion-a': [{ suscripcionId: 'sus-a', paquete: 'com.ejemplo.a' }],
      'org:usuario-b:sesion-b': [{ suscripcionId: 'sus-b', paquete: 'com.ejemplo.b' }],
    }));
    const control = crearControlAsociacionPaquetes({
      obtenerSesion: () => 'org:usuario-b:sesion-b', obtenerSuscripcion: async (id) => ({ id }), almacen,
    });

    await expect(control.listar()).resolves.toEqual([
      { suscripcionId: 'sus-b', paquete: 'com.ejemplo.b' },
    ]);
  });

  it('no asigna un mismo paquete a suscripciones distintas', async () => {
    const almacen = crearAlmacen(JSON.stringify({
      'org:usuario:sesion-a': [{ suscripcionId: 'suscripcion-1', paquete: 'com.ejemplo.app' }],
    }));
    const control = crearControlAsociacionPaquetes({
      obtenerSesion: () => 'org:usuario:sesion-a', obtenerSuscripcion: async (id) => ({ id }), almacen,
    });

    await expect(control.asociar('suscripcion-2', 'com.ejemplo.app')).rejects.toThrow('ya está asociado');
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('serializa asociaciones simultáneas para no perder una escritura', async () => {
    const almacen = crearAlmacen();
    const control = crearControlAsociacionPaquetes({
      obtenerSesion: () => 'org:usuario:sesion-a', obtenerSuscripcion: async (id) => ({ id }), almacen,
    });

    await Promise.all([
      control.asociar('suscripcion-1', 'com.ejemplo.uno'),
      control.asociar('suscripcion-2', 'com.ejemplo.dos'),
    ]);

    expect(almacen.guardar).toHaveBeenCalledTimes(2);
    expect(JSON.parse(almacen.guardar.mock.calls[1][0])).toEqual({
      'org:usuario:sesion-a': [
        { suscripcionId: 'suscripcion-1', paquete: 'com.ejemplo.uno' },
        { suscripcionId: 'suscripcion-2', paquete: 'com.ejemplo.dos' },
      ],
    });
  });

  it('descarta una validación tardía si cambió la sesión', async () => {
    let sesionActual: string | null = 'org:usuario-a:sesion-a';
    let resolverSuscripcion: ((valor: { id: string }) => void) | undefined;
    const obtenerSuscripcion = vi.fn(() => new Promise<{ id: string }>((resolver) => { resolverSuscripcion = resolver; }));
    const almacen = crearAlmacen();
    const control = crearControlAsociacionPaquetes({
      obtenerSesion: () => sesionActual, obtenerSuscripcion, almacen,
    });

    const asociacionPendiente = control.asociar('suscripcion-a', 'com.ejemplo.app');
    await vi.waitFor(() => expect(obtenerSuscripcion).toHaveBeenCalledOnce());
    sesionActual = 'org:usuario-b:sesion-b';
    resolverSuscripcion?.({ id: 'suscripcion-a' });

    await expect(asociacionPendiente).rejects.toThrow('sesión cambió');
    expect(almacen.guardar).not.toHaveBeenCalled();
  });
});
