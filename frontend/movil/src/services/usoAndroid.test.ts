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


describe('rechazos del puente durante la lectura', () => {
  it.each([false, true])('revocación sin ocultar fallos generales (permiso final %s)', async (permisoFinal) => {
    const fallo = new Error('Fallo nativo');
    const nativo = { tienePermiso: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(permisoFinal),
      abrirAjustes: vi.fn(), leerEstadisticas: vi.fn().mockRejectedValue(fallo) };
    const control = crearControlUsoAndroid(nativo, () => 'A', () => true);
    if (permisoFinal) await expect(control.leer(1, 2)).rejects.toBe(fallo);
    else expect(await control.leer(1, 2)).toEqual({ estado: 'revocado' });
  });
  it('una sesión cambiada tiene prioridad aunque el puente rechace', async () => {
    let sesion = 'A';
    const nativo = { tienePermiso: vi.fn(async () => true), abrirAjustes: vi.fn(),
      leerEstadisticas: vi.fn(async () => { sesion = 'B'; throw new Error('Acceso revocado'); }) };
    expect(await crearControlUsoAndroid(nativo, () => sesion, () => true).leer(1, 2))
      .toEqual({ estado: 'sesion_cambiada' });
  });
});

describe('lectura de tramos Android con alcance de consentimiento', () => {
  const autorizado = { paquete: 'com.ejemplo.app', inicioMs: 2000, finMs: 3000 };

  function entornoTramos() {
    let alcance = { id: 'aceptacion-1', desdeMs: 2000, paquetes: [autorizado.paquete] };
    let consentimiento = true;
    const nativo = {
      tienePermiso: vi.fn(async () => true),
      abrirAjustes: vi.fn(async () => {}),
      leerEstadisticas: vi.fn(async () => []),
      leerTramos: vi.fn(async () => [
        autorizado,
        { ...autorizado, paquete: 'com.ejemplo.otra' },
        { ...autorizado, inicioMs: 1999 },
        { ...autorizado, finMs: 4001 },
      ]),
    };
    return {
      control: crearControlUsoAndroid(nativo, () => 'sesion', () => consentimiento, () => alcance),
      nativo,
      retirar: () => { consentimiento = false; },
      cambiarAlcance: () => { alcance = { ...alcance, id: 'aceptacion-2' }; },
    };
  }

  it('consulta solo desde la aceptación y excluye paquetes y tramos fuera del alcance', async () => {
    const { control, nativo } = entornoTramos();
    await expect(control.leerTramos(1000, 4000)).resolves.toEqual({
      estado: 'disponible', tramos: [autorizado],
    });
    expect(nativo.leerTramos).toHaveBeenCalledTimes(1);
    expect(nativo.leerTramos).toHaveBeenCalledWith(2000, 4000, ['com.ejemplo.app'], true);
    expect(nativo.leerEstadisticas).not.toHaveBeenCalled();
  });

  it('no lee tramos sin consentimiento ni con el permiso denegado', async () => {
    const sinConsentimiento = entornoTramos();
    sinConsentimiento.retirar();
    await expect(sinConsentimiento.control.leerTramos(1000, 4000)).resolves.toEqual({ estado: 'sin_consentimiento' });
    expect(sinConsentimiento.nativo.leerTramos).not.toHaveBeenCalled();

    const sinPermiso = entornoTramos();
    sinPermiso.nativo.tienePermiso.mockResolvedValue(false);
    await expect(sinPermiso.control.leerTramos(1000, 4000)).resolves.toEqual({ estado: 'sin_permiso' });
    expect(sinPermiso.nativo.leerTramos).not.toHaveBeenCalled();
  });

  it('descarta la lectura si cambia la aceptación mientras responde el puente', async () => {
    const { control, nativo, cambiarAlcance } = entornoTramos();
    nativo.leerTramos.mockImplementationOnce(async () => {
      cambiarAlcance();
      return [autorizado];
    });
    await expect(control.leerTramos(1000, 4000)).resolves.toEqual({ estado: 'sin_consentimiento' });
  });

  it('rechaza ventanas mayores a un día antes de tocar Android', async () => {
    const { control, nativo } = entornoTramos();
    await expect(control.leerTramos(0, 86_400_001)).rejects.toThrow(RangeError);
    expect(nativo.leerTramos).not.toHaveBeenCalled();
  });
});
