import { describe, expect, it } from 'vitest';
import { SECCIONES_CONFIGURACION } from './secciones';

describe('Configuración móvil (AN-04): secciones', () => {
  const items = SECCIONES_CONFIGURACION.flatMap((s) => s.items);

  it('no repite testID entre opciones', () => {
    const ids = items.map((i) => i.testID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('conserva todos los accesos que ya existían en la navegación (SE-06)', () => {
    const destinos = items.map((i) => i.destino).filter(Boolean);
    expect(destinos).toEqual(
      expect.arrayContaining([
        'Perfil',
        'CuentasConectadas',
        'Planes',
        'Alertas',
        'AutorizacionCorreo',
        'RestriccionesPremium',
        'EliminarCuenta',
      ]),
    );
  });

  it('lo que no tiene integración queda sin destino y se muestra deshabilitado', () => {
    const notificaciones = items.find((i) => i.testID === 'pref-notificaciones');
    expect(notificaciones).toBeDefined();
    expect(notificaciones?.destino).toBeUndefined();
  });
});
