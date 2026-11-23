// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ErrorDeApi,
  getPreferenciasAlertas,
  guardarPreferenciasAlertas,
  type PreferenciasAlertas,
} from '@ojoalgasto/shared';
import { PreferenciasNotificacionesContenido } from './PreferenciasNotificacionesContenido';
import {
  canalPushHabilitadoEnDispositivo,
  type ControlPermisosNotificaciones,
  type EstadoPermisoDispositivo,
} from '../../../services/permisosNotificaciones';

// Mock de las funciones de red de @ojoalgasto/shared
vi.mock('@ojoalgasto/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ojoalgasto/shared')>();
  return {
    ...real,
    getPreferenciasAlertas: vi.fn(),
    guardarPreferenciasAlertas: vi.fn(),
  };
});

const getMock = vi.mocked(getPreferenciasAlertas);
const guardarMock = vi.mocked(guardarPreferenciasAlertas);

const PREFERENCIAS_BASE: PreferenciasAlertas = {
  por_email: true,
  por_push: false,
  en_la_app: true,
  avisar_proximo_cobro: true,
  avisar_fin_prueba: true,
  avisar_alza_tarifa: true,
  avisar_doble_cobro: true,
  avisar_presupuesto_excedido: true,
  dias_anticipacion: 5,
  canales_disponibles: ['email', 'in_app'],
  canales_elegidos: ['email', 'in_app'],
  actualizado_en: '2026-11-20T12:00:00Z',
};

function crearControlPermisosMock(
  estadoInicial: EstadoPermisoDispositivo = 'concedido',
  respuestaSolicitud: EstadoPermisoDispositivo = 'concedido'
): ControlPermisosNotificaciones {
  let estado = estadoInicial;
  return {
    obtenerEstado: vi.fn(async () => estado),
    solicitarPermiso: vi.fn(async () => {
      estado = respuestaSolicitud;
      return respuestaSolicitud;
    }),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Preferencias de Notificación Móvil (SE-32)', () => {
  it('muestra estado de carga mientras consulta el backend', () => {
    getMock.mockReturnValue(new Promise(() => {}));
    render(<PreferenciasNotificacionesContenido />);
    expect(screen.getByTestId('loading-preferencias')).toBeDefined();
    expect(screen.getByText('Cargando tus preferencias…')).toBeDefined();
  });

  it('los valores iniciales y textos coinciden con backend y web (sin hardcodear días)', async () => {
    getMock.mockResolvedValueOnce(PREFERENCIAS_BASE);
    render(<PreferenciasNotificacionesContenido />);

    await waitFor(() => {
      expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
    });

    // Switches reflejan los valores del backend
    expect((screen.getByTestId('switch-por_email') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('switch-por_push') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('switch-en_la_app') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('switch-avisar_proximo_cobro') as HTMLInputElement).checked).toBe(true);

    // Texto de días dinámico: 5 días antes del cobro (no 3 hardcodeado)
    expect(screen.getByText('5 días antes del cobro.')).toBeDefined();

    // Fecha de guardado formateada
    expect(screen.getByTestId('estado-cambios').textContent).toContain('Guardado ·');
  });

  it('dias_anticipacion = 1 muestra singular "1 día antes del cobro."', async () => {
    getMock.mockResolvedValueOnce({
      ...PREFERENCIAS_BASE,
      dias_anticipacion: 1,
    });
    render(<PreferenciasNotificacionesContenido />);

    await waitFor(() => {
      expect(screen.getByText('1 día antes del cobro.')).toBeDefined();
    });
  });

  it('canal no disponible en backend muestra advertencia coincidente con web', async () => {
    getMock.mockResolvedValueOnce({
      ...PREFERENCIAS_BASE,
      canales_disponibles: ['email'], // push e in_app no disponibles
    });
    render(<PreferenciasNotificacionesContenido />);

    await waitFor(() => {
      expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
    });

    const notas = screen.getAllByText(
      'Todavía no lo enviamos. Si lo activas, queda guardado para cuando esté listo.'
    );
    expect(notas.length).toBeGreaterThanOrEqual(1);
  });

  it('al apagar los 3 canales muestra alerta de que no llegará ningún aviso', async () => {
    getMock.mockResolvedValueOnce({
      ...PREFERENCIAS_BASE,
      por_email: true,
      por_push: false,
      en_la_app: false,
    });
    render(<PreferenciasNotificacionesContenido />);

    await waitFor(() => {
      expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
    });

    expect(screen.queryByTestId('aviso-canales-apagados')).toBeNull();

    // Apagar el único canal activo (por_email)
    fireEvent.click(screen.getByTestId('switch-por_email'));

    expect(screen.getByTestId('aviso-canales-apagados')).toBeDefined();
    expect(
      screen.getByText('Con todos los canales apagados no te llega ningún aviso.')
    ).toBeDefined();
  });

  describe('Criterio de Aceptación: Permisos del dispositivo vs preferencia persistida', () => {
    it('función canalPushHabilitadoEnDispositivo rechaza push si el permiso está denegado', () => {
      expect(canalPushHabilitadoEnDispositivo(true, 'denegado')).toBe(false);
      expect(canalPushHabilitadoEnDispositivo(false, 'denegado')).toBe(false);
      expect(canalPushHabilitadoEnDispositivo(true, 'no_disponible')).toBe(false);
      expect(canalPushHabilitadoEnDispositivo(true, 'no_determinado')).toBe(false);
      expect(canalPushHabilitadoEnDispositivo(true, 'concedido')).toBe(true);
      expect(canalPushHabilitadoEnDispositivo(false, 'concedido')).toBe(false);
    });

    it('denegar permiso push NO se presenta como canal habilitado en dispositivo aun con preferencia activa en servidor', async () => {
      // Backend tiene por_push = true
      getMock.mockResolvedValueOnce({
        ...PREFERENCIAS_BASE,
        por_push: true,
      });

      // Pero el dispositivo tiene permiso DENEGADO
      const control = crearControlPermisosMock('denegado');
      render(<PreferenciasNotificacionesContenido controlPermisos={control} />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      // El estado del canal en el dispositivo NO se presenta como habilitado
      const estadoDispositivo = screen.getByTestId('estado-push-dispositivo');
      expect(estadoDispositivo.textContent).toBe('Inhabilitado (permiso denegado en dispositivo)');
      expect(estadoDispositivo.textContent).not.toBe('Habilitado');

      // Se muestra badge y alerta explícita de permiso denegado
      expect(screen.getByTestId('badge-push-dispositivo').textContent).toBe(
        'Canal no habilitado en dispositivo'
      );
      expect(screen.getByTestId('alerta-push-dispositivo')).toBeDefined();
    });

    it('solicita permisos al activar push si está indeterminado y no habilita en dispositivo si el usuario deniega', async () => {
      getMock.mockResolvedValueOnce({
        ...PREFERENCIAS_BASE,
        por_push: false,
      });

      // Inicialmente indeterminado, y el usuario deniega al ser consultado
      const control = crearControlPermisosMock('no_determinado', 'denegado');
      render(<PreferenciasNotificacionesContenido controlPermisos={control} />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      // Activar push
      await act(async () => {
        fireEvent.click(screen.getByTestId('switch-por_push'));
      });

      expect(control.solicitarPermiso).toHaveBeenCalled();

      // No debe presentarse como habilitado en el dispositivo
      const estadoDispositivo = screen.getByTestId('estado-push-dispositivo');
      expect(estadoDispositivo.textContent).toContain('Inhabilitado');
      expect(screen.getByTestId('alerta-push-dispositivo')).toBeDefined();
    });

    it('presenta push como habilitado en dispositivo cuando hay permiso concedido y preferencia activa', async () => {
      getMock.mockResolvedValueOnce({
        ...PREFERENCIAS_BASE,
        por_push: false,
      });

      const control = crearControlPermisosMock('concedido');
      render(<PreferenciasNotificacionesContenido controlPermisos={control} />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      // Activar push con permiso ya concedido
      await act(async () => {
        fireEvent.click(screen.getByTestId('switch-por_push'));
      });

      const estadoDispositivo = screen.getByTestId('estado-push-dispositivo');
      expect(estadoDispositivo.textContent).toBe('Habilitado');
    });
  });

  describe('Edición, borrador, descarte y guardado selectivo (PATCH)', () => {
    it('editar activa "Tienes cambios sin guardar." y habilita botones', async () => {
      getMock.mockResolvedValueOnce(PREFERENCIAS_BASE);
      render(<PreferenciasNotificacionesContenido />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      expect(screen.getByTestId('btn-guardar').getAttribute('disabled')).toBeDefined();
      expect(screen.getByTestId('btn-descartar').getAttribute('disabled')).toBeDefined();

      fireEvent.click(screen.getByTestId('switch-avisar_alza_tarifa'));

      expect(screen.getByTestId('estado-cambios').textContent).toBe('Tienes cambios sin guardar.');
      expect(screen.getByTestId('btn-guardar').getAttribute('disabled')).toBeNull();
      expect(screen.getByTestId('btn-descartar').getAttribute('disabled')).toBeNull();
    });

    it('descartar restaura el valor original sin llamar al servidor', async () => {
      getMock.mockResolvedValueOnce(PREFERENCIAS_BASE);
      render(<PreferenciasNotificacionesContenido />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('switch-avisar_alza_tarifa'));
      expect((screen.getByTestId('switch-avisar_alza_tarifa') as HTMLInputElement).checked).toBe(false);

      fireEvent.click(screen.getByTestId('btn-descartar'));

      expect((screen.getByTestId('switch-avisar_alza_tarifa') as HTMLInputElement).checked).toBe(true);
      expect(screen.getByTestId('estado-cambios').textContent).toContain('Guardado ·');
      expect(guardarMock).not.toHaveBeenCalled();
    });

    it('guardar envía PATCH únicamente con los campos modificados (cambiosDePreferencias)', async () => {
      getMock.mockResolvedValueOnce(PREFERENCIAS_BASE);
      const respuestaPatch: PreferenciasAlertas = {
        ...PREFERENCIAS_BASE,
        avisar_alza_tarifa: false,
        actualizado_en: '2026-11-20T12:05:00Z',
      };
      guardarMock.mockResolvedValueOnce(respuestaPatch);

      const onExito = vi.fn();
      render(<PreferenciasNotificacionesContenido onExitoGuardar={onExito} />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('switch-avisar_alza_tarifa'));

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar'));
      });

      // Solo viaja el campo modificado
      expect(guardarMock).toHaveBeenCalledWith({ avisar_alza_tarifa: false });
      expect(onExito).toHaveBeenCalled();
      expect(screen.getByTestId('estado-cambios').textContent).toContain('Guardado ·');
    });

    it('error en PATCH muestra mensaje sin perder los cambios editados para permitir reintento', async () => {
      getMock.mockResolvedValueOnce(PREFERENCIAS_BASE);
      guardarMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      render(<PreferenciasNotificacionesContenido />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('switch-avisar_fin_prueba'));

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar'));
      });

      expect(screen.getByTestId('error-guardado')).toBeDefined();
      expect(screen.getByText(/No se pudo conectar con el servidor/i)).toBeDefined();

      // El interruptor sigue en el valor editado
      expect((screen.getByTestId('switch-avisar_fin_prueba') as HTMLInputElement).checked).toBe(false);
      expect(screen.getByTestId('btn-guardar').getAttribute('disabled')).toBeNull();
    });

    it('error 400 del backend en PATCH muestra mensaje devuelto por la API', async () => {
      getMock.mockResolvedValueOnce(PREFERENCIAS_BASE);
      guardarMock.mockRejectedValueOnce(new ErrorDeApi('Valor no permitido', 400));

      render(<PreferenciasNotificacionesContenido />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('switch-avisar_fin_prueba'));

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar'));
      });

      expect(screen.getByText('No se guardó: Valor no permitido')).toBeDefined();
    });
  });

  describe('Manejo de errores de carga inicial y aislamiento de sesión', () => {
    it('muestra error de red con opción de reintentar si el GET inicial falla', async () => {
      getMock.mockRejectedValueOnce(new TypeError('Network error'));
      render(<PreferenciasNotificacionesContenido />);

      await waitFor(() => {
        expect(screen.getByTestId('error-carga')).toBeDefined();
      });

      // Reintentar con éxito
      getMock.mockResolvedValueOnce(PREFERENCIAS_BASE);
      fireEvent.click(screen.getByText('Reintentar'));

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });
    });

    it('cambio de usuario reinicia borrador y vuelve a consultar el backend', async () => {
      getMock.mockResolvedValue(PREFERENCIAS_BASE);
      const { rerender } = render(<PreferenciasNotificacionesContenido usuarioId="usr-1" />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      // Modificar
      fireEvent.click(screen.getByTestId('switch-avisar_doble_cobro'));
      expect(screen.getByTestId('estado-cambios').textContent).toBe('Tienes cambios sin guardar.');

      // Cambia de usuario
      rerender(<PreferenciasNotificacionesContenido usuarioId="usr-2" />);

      await waitFor(() => {
        expect(getMock).toHaveBeenCalledTimes(2);
      });
    });
  });
});
