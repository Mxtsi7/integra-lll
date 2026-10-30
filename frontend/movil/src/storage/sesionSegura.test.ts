import { beforeEach, describe, expect, it } from 'vitest';
import {
  guardarTokens,
  logout,
  obtenerAccessToken,
  obtenerRefreshToken,
} from '@ojoalgasto/shared';
import {
  confirmarCierrePersistente,
  esperarAlmacenSeguroParaPruebas,
  hayCierrePendiente,
  hidratarSesion,
  instalarAlmacenSeguro,
  reiniciarAlmacenSeguroParaPruebas,
  reintentarCierrePersistente,
} from './sesionSegura';
import {
  __fallarBorrados,
  __limpiar,
  __liberar,
  __retenerSiguienteEscritura,
  __retenerSiguienteLectura,
} from '../../test/expo-secure-store-shim';

/** Simula un arranque nuevo: espejo vacío e hidratación desde el almacén. */
async function reabrirApp(): Promise<void> {
  reiniciarAlmacenSeguroParaPruebas();
  instalarAlmacenSeguro();
  await hidratarSesion();
}

describe('almacén seguro de sesión (VI-16)', () => {
  beforeEach(() => {
    __limpiar();
    reiniciarAlmacenSeguroParaPruebas();
    instalarAlmacenSeguro();
  });

  it('persiste los tokens cifrados y los recupera al reabrir la app', async () => {
    guardarTokens({ access_token: 'acceso-1', refresh_token: 'refresco-1' });
    await esperarAlmacenSeguroParaPruebas();

    reiniciarAlmacenSeguroParaPruebas();
    instalarAlmacenSeguro();
    expect(obtenerAccessToken()).toBeNull();

    await hidratarSesion();

    expect(obtenerAccessToken()).toBe('acceso-1');
    expect(obtenerRefreshToken()).toBe('refresco-1');
  });

  it('logout borra también lo persistido', async () => {
    guardarTokens({ access_token: 'acceso-1', refresh_token: 'refresco-1' });
    await esperarAlmacenSeguroParaPruebas();

    logout();
    await esperarAlmacenSeguroParaPruebas();

    await reabrirApp();

    expect(obtenerAccessToken()).toBeNull();
    expect(obtenerRefreshToken()).toBeNull();
  });

  it('un logout no se pierde aunque una escritura anterior tarde', async () => {
    // La escritura del access token queda retenida; el logout llega antes de
    // que SecureStore la complete. Si no se serializa, al liberar la escritura
    // el token "resucita" después del borrado.
    __retenerSiguienteEscritura();
    guardarTokens({ access_token: 'acceso-1', refresh_token: 'refresco-1' });
    logout();

    __liberar();
    await esperarAlmacenSeguroParaPruebas();

    await reabrirApp();

    expect(obtenerAccessToken()).toBeNull();
    expect(obtenerRefreshToken()).toBeNull();
  });

  it('no reinyecta una sesión cerrada mientras se hidrata', async () => {
    guardarTokens({ access_token: 'acceso-1', refresh_token: 'refresco-1' });
    await esperarAlmacenSeguroParaPruebas();

    reiniciarAlmacenSeguroParaPruebas();
    instalarAlmacenSeguro();

    // La lectura del almacén queda retenida con el valor viejo ya capturado.
    __retenerSiguienteLectura();
    const hidratacion = hidratarSesion();
    logout();

    __liberar();
    await hidratacion;

    expect(obtenerAccessToken()).toBeNull();
    expect(obtenerRefreshToken()).toBeNull();
  });

  it('un borrado rechazado deja el cierre pendiente y no se declara exitoso [P1]', async () => {
    guardarTokens({ access_token: 'acceso-1', refresh_token: 'refresco-1' });
    await esperarAlmacenSeguroParaPruebas();

    __fallarBorrados();
    logout();
    const resultado = await confirmarCierrePersistente();

    expect(resultado.ok).toBe(false);
    expect(resultado.pendiente).toBe(true);
    expect(hayCierrePendiente()).toBe(true);
    expect(obtenerAccessToken()).toBeNull();
    expect(obtenerRefreshToken()).toBeNull();
  });

  it('un reinicio no recupera la sesión mientras el cierre siga pendiente [P1]', async () => {
    guardarTokens({ access_token: 'acceso-1', refresh_token: 'refresco-1' });
    await esperarAlmacenSeguroParaPruebas();

    __fallarBorrados();
    logout();
    expect((await confirmarCierrePersistente()).ok).toBe(false);

    // Se reinicia la app con el keystore todavía fallando: la marca durable
    // impide que la hidratación acepte los tokens viejos.
    await reabrirApp();

    expect(obtenerAccessToken()).toBeNull();
    expect(obtenerRefreshToken()).toBeNull();
    expect(hayCierrePendiente()).toBe(true);
  });

  it('reintentar el cierre después de recuperar el keystore lo confirma y limpia la marca [P1]', async () => {
    guardarTokens({ access_token: 'acceso-1', refresh_token: 'refresco-1' });
    await esperarAlmacenSeguroParaPruebas();

    __fallarBorrados();
    logout();
    expect((await confirmarCierrePersistente()).ok).toBe(false);

    __fallarBorrados(false);
    const resultado = await reintentarCierrePersistente();

    expect(resultado.ok).toBe(true);
    expect(resultado.pendiente).toBe(false);
    expect(hayCierrePendiente()).toBe(false);

    await reabrirApp();
    expect(obtenerAccessToken()).toBeNull();
    expect(obtenerRefreshToken()).toBeNull();
  });
});
