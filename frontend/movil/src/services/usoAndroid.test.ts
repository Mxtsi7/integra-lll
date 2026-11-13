import { describe, expect, it, vi } from 'vitest';
import { crearControlPermisoUsoAndroid, crearControlUsoAndroid } from './usoAndroid';

// Dobles de IO nativo: estas pruebas no acreditan permiso ni estadísticas Android reales.
describe('control de uso Android', () => {
  function entorno() {
    let sesion: string | null = 'A';
    let consentimiento = false;
    const nativo = { tienePermiso: vi.fn(async () => true), abrirAjustes: vi.fn(async () => {}),
      leerEstadisticas: vi.fn(async (_inicioMs: number, _finMs: number, consentimientoVigente: boolean) => {
        if (!consentimientoVigente) throw new Error('Consentimiento no confirmado');
        return [{ paquete: 'app.ejemplo', duracionMs: 32 }];
      }) };
    const control = crearControlUsoAndroid(nativo, () => sesion, () => consentimiento);
    return { control, nativo, cambiar: (valor: string | null) => { sesion = valor; }, consentir: () => { consentimiento = true; } };
  }
  it('verifica permiso, abre ajustes y vuelve a comprobar sin asumir concesión', async () => {
    const e = entorno();
    const controlPermiso = crearControlPermisoUsoAndroid(e.nativo);
    e.nativo.tienePermiso.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await controlPermiso.verificar()).toBe('requerido');
    expect(await controlPermiso.abrirAjustes()).toBe(true);
    expect(await controlPermiso.verificar()).toBe('concedido');
    const sinModulo = crearControlPermisoUsoAndroid(null);
    expect(await sinModulo.verificar()).toBe('no_disponible');
    expect(await sinModulo.abrirAjustes()).toBe(false);
  });
  it('sin consentimiento no consulta estadísticas ni fabrica cero', async () => {
    const e = entorno();
    expect(await e.control.leer(1, 2)).toEqual({ estado: 'sin_consentimiento' });
    expect(e.nativo.leerEstadisticas).not.toHaveBeenCalled();
  });
  it('denegación y revocación descartan estadísticas', async () => {
    const e = entorno(); e.consentir();
    e.nativo.tienePermiso.mockResolvedValueOnce(false);
    expect(await e.control.leer(1, 2)).toEqual({ estado: 'sin_permiso' });
    e.nativo.tienePermiso.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await e.control.leer(1, 2)).toEqual({ estado: 'revocado' });
  });
  it('respuesta de A no entrega estadísticas a B', async () => {
    const e = entorno(); e.consentir();
    e.nativo.leerEstadisticas.mockImplementationOnce(async () => { e.cambiar('B'); return []; });
    expect(await e.control.leer(1, 2)).toEqual({ estado: 'sesion_cambiada' });
  });
  it('entrega estadísticas solo tras doble comprobación', async () => {
    const e = entorno(); e.consentir();
    expect(await e.control.leer(1, 2)).toEqual({ estado: 'disponible', estadisticas: [{ paquete: 'app.ejemplo', duracionMs: 32 }] });
    expect(e.nativo.tienePermiso).toHaveBeenCalledTimes(2);
    expect(e.nativo.leerEstadisticas).toHaveBeenCalledWith(1, 2, true);
  });
});
