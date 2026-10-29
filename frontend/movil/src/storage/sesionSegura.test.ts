import { beforeEach, describe, expect, it } from 'vitest';
import {
  guardarTokens,
  obtenerAccessToken,
  obtenerRefreshToken,
} from '@ojoalgasto/shared';
import {
  hidratarSesion,
  instalarAlmacenSeguro,
  reiniciarAlmacenSeguroParaPruebas,
} from './sesionSegura';
import { __limpiar } from '../../test/expo-secure-store-shim';

describe('almacén seguro de sesión (VI-16)', () => {
  beforeEach(() => {
    __limpiar();
    reiniciarAlmacenSeguroParaPruebas();
    instalarAlmacenSeguro();
  });

  it('persiste los tokens cifrados y los recupera al reabrir la app', async () => {
    guardarTokens({ access_token: 'acceso-1', refresh_token: 'refresco-1' });
    await new Promise((resolver) => setTimeout(resolver, 0));

    // Simula un arranque nuevo: el espejo en memoria se vacía.
    reiniciarAlmacenSeguroParaPruebas();
    instalarAlmacenSeguro();
    expect(obtenerAccessToken()).toBeNull();

    await hidratarSesion();

    expect(obtenerAccessToken()).toBe('acceso-1');
    expect(obtenerRefreshToken()).toBe('refresco-1');
  });

  it('logout borra también lo persistido', async () => {
    guardarTokens({ access_token: 'acceso-1', refresh_token: 'refresco-1' });
    await new Promise((resolver) => setTimeout(resolver, 0));

    const { logout } = await import('@ojoalgasto/shared');
    logout();
    await new Promise((resolver) => setTimeout(resolver, 0));

    reiniciarAlmacenSeguroParaPruebas();
    instalarAlmacenSeguro();
    await hidratarSesion();

    expect(obtenerAccessToken()).toBeNull();
    expect(obtenerRefreshToken()).toBeNull();
  });
});
