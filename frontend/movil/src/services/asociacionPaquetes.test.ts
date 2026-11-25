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

  it('corrige paquete y destino en una sola escritura después de validar el destino', async () => {
    const sesion = 'org:usuario:sesion-a';
    const anterior = { suscripcionId: 'suscripcion-1', paquete: 'com.ejemplo.app' };
    const almacen = crearAlmacen(JSON.stringify({ [sesion]: [anterior] }));
    const obtenerSuscripcion = vi.fn(async (id: string) => {
      if (id === 'suscripcion-ajena') throw new Error('No autorizada');
      return { id };
    });
    const control = crearControlAsociacionPaquetes({ obtenerSesion: () => sesion, obtenerSuscripcion, almacen });

    await expect(control.asociar('suscripcion-ajena', 'com.ejemplo.nueva', anterior)).rejects.toThrow('No autorizada');
    await expect(control.listar()).resolves.toEqual([anterior]);
    expect(almacen.guardar).not.toHaveBeenCalled();

    await control.asociar('suscripcion-2', 'com.ejemplo.nueva', anterior);
    await expect(control.listar()).resolves.toEqual([
      { suscripcionId: 'suscripcion-2', paquete: 'com.ejemplo.nueva' },
    ]);
    await expect(control.asociar('suscripcion-1', 'com.ejemplo.app', anterior)).rejects.toThrow('original cambió');
    expect(almacen.guardar).toHaveBeenCalledOnce();
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

  it.each(['asociar', 'quitar'] as const)(
    'rechaza %s encolado por A después de cambiar a B',
    async (mutacion) => {
      const sesionA = 'org:usuario-a:sesion-a';
      const sesionB = 'org:usuario-b:sesion-b';
      let sesionActual = sesionA;
      const existente = { suscripcionId: 'suscripcion-compartida', paquete: 'com.ejemplo.app' };
      const valorInicial = JSON.stringify({ [sesionB]: [existente] });
      const almacen = crearAlmacen(valorInicial);
      let liberarValidacion!: () => void;
      const validacionPendiente = new Promise<void>((resolver) => { liberarValidacion = resolver; });
      const obtenerSuscripcion = vi.fn(async (id: string) => ({ id }))
        .mockImplementationOnce(async (id) => {
          await validacionPendiente;
          return { id };
        });
      const control = crearControlAsociacionPaquetes({
        obtenerSesion: () => sesionActual, obtenerSuscripcion, almacen,
      });

      const primera = control.asociar('suscripcion-compartida', 'com.ejemplo.primera');
      await vi.waitFor(() => expect(obtenerSuscripcion).toHaveBeenCalledOnce());
      const segunda = mutacion === 'asociar'
        ? control.asociar('suscripcion-compartida', 'com.ejemplo.segunda')
        : control.quitar(existente.paquete);
      const resultados = Promise.allSettled([primera, segunda]);
      sesionActual = sesionB;
      liberarValidacion();

      // Ninguna intención de A debe consultar ni escribir con la sesión de B.
      expect(await resultados).toEqual([
        { status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('sesión cambió') }) },
        { status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('sesión cambió') }) },
      ]);
      expect(obtenerSuscripcion).toHaveBeenCalledOnce();
      expect(almacen.leer).not.toHaveBeenCalled();
      expect(almacen.guardar).not.toHaveBeenCalled();
      await expect(control.listar()).resolves.toEqual([existente]);

      // B todavía puede actuar tras el rechazo de ambas operaciones de A.
      await expect(control.quitar(existente.paquete)).resolves.toBeUndefined();
      await expect(control.listar()).resolves.toEqual([]);
    },
  );
});
