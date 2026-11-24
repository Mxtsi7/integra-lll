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
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import {
  AdaptadorNativoExpo,
  canalPushHabilitadoEnDispositivo,
  crearControlPermisosNotificaciones,
  mapearEstadoPermisoExpo,
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
    abrirAjustes: vi.fn(async () => true),
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

    it('pantalla productiva con adaptador por defecto sin módulo nativo informa no_disponible y NO presenta push como habilitado', async () => {
      getMock.mockResolvedValueOnce({
        ...PREFERENCIAS_BASE,
        por_push: false,
      });

      // No inyectamos controlPermisos; usa el crearControlPermisosNotificaciones() predeterminado
      render(<PreferenciasNotificacionesContenido />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      // Activar el switch de push
      await act(async () => {
        fireEvent.click(screen.getByTestId('switch-por_push'));
      });

      // El estado debe reflejar verazmente que no está disponible, jamás "Habilitado"
      const estadoDispositivo = screen.getByTestId('estado-push-dispositivo');
      expect(estadoDispositivo.textContent).toBe('No disponible en este dispositivo');
      expect(estadoDispositivo.textContent).not.toBe('Habilitado');

      // Se muestra la alerta correspondiente y el badge
      expect(screen.getByTestId('alerta-push-dispositivo').textContent).toContain(
        'Las notificaciones push no están disponibles'
      );
      expect(screen.getByTestId('badge-push-dispositivo').textContent).toBe(
        'No disponible en este dispositivo'
      );
    });

    it('cuando el permiso está denegado muestra botón para abrir ajustes del dispositivo y permite pulsarlo', async () => {
      getMock.mockResolvedValueOnce({
        ...PREFERENCIAS_BASE,
        por_push: true,
      });

      const control = crearControlPermisosMock('denegado');
      render(<PreferenciasNotificacionesContenido controlPermisos={control} />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      const btnAjustes = screen.getByTestId('btn-abrir-ajustes');
      expect(btnAjustes).toBeDefined();
      expect(btnAjustes.textContent).toBe('Abrir ajustes del dispositivo');

      await act(async () => {
        fireEvent.click(btnAjustes);
      });

      expect(control.abrirAjustes).toHaveBeenCalledTimes(1);
    });

    it('reevalúa el permiso verazmente al regresar de ajustes del sistema (evento AppState active)', async () => {
      getMock.mockResolvedValueOnce({
        ...PREFERENCIAS_BASE,
        por_push: true,
      });

      let estadoActual: EstadoPermisoDispositivo = 'denegado';
      const control: ControlPermisosNotificaciones = {
        obtenerEstado: vi.fn(async () => estadoActual),
        solicitarPermiso: vi.fn(async () => estadoActual),
        abrirAjustes: vi.fn(async () => true),
      };

      render(<PreferenciasNotificacionesContenido controlPermisos={control} />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      expect(screen.getByTestId('estado-push-dispositivo').textContent).toBe(
        'Inhabilitado (permiso denegado en dispositivo)'
      );
      expect(screen.getByTestId('btn-abrir-ajustes')).toBeDefined();

      // El usuario va a ajustes del sistema y concede el permiso
      estadoActual = 'concedido';

      // La app vuelve al primer plano
      await act(async () => {
        (AppState as any)._simulateStateChange('active');
      });

      await waitFor(() => {
        expect(screen.getByTestId('estado-push-dispositivo').textContent).toBe('Habilitado');
      });
      expect(screen.queryByTestId('btn-abrir-ajustes')).toBeNull();
    });

    it('cuando el permiso es no_determinado muestra botón para solicitar permiso al sistema y permite pulsarlo', async () => {
      getMock.mockResolvedValueOnce({
        ...PREFERENCIAS_BASE,
        por_push: false,
      });

      const control = crearControlPermisosMock('no_determinado', 'concedido');
      render(<PreferenciasNotificacionesContenido controlPermisos={control} />);

      await waitFor(() => {
        expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
      });

      const btnSolicitar = screen.getByTestId('btn-solicitar-permiso');
      expect(btnSolicitar).toBeDefined();
      expect(btnSolicitar.textContent).toBe('Permitir notificaciones en este dispositivo');

      await act(async () => {
        fireEvent.click(btnSolicitar);
      });

      expect(control.solicitarPermiso).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(screen.queryByTestId('btn-solicitar-permiso')).toBeNull();
      });
    });

    it('en Android 11/12 (API < 33) con notificaciones bloqueadas en Ajustes, cargar y volver desde Ajustes nunca muestra Habilitado hasta que se activan', async () => {
      const origOS = Platform.OS;
      const origVersion = Platform.Version;
      (Platform as any).OS = 'android';
      (Platform as any).Version = 30; // Android 11

      try {
        getMock.mockResolvedValueOnce({
          ...PREFERENCIAS_BASE,
          por_push: true,
        });

        // Notificaciones bloqueadas en Ajustes del SO
        let notificacionesHabilitadas = false;
        const puenteAndroid = {
          areNotificationsEnabled: vi.fn(async () => notificacionesHabilitadas),
        };

        const adaptador = new AdaptadorNativoExpo(null, puenteAndroid);
        const control = crearControlPermisosNotificaciones(adaptador);

        render(<PreferenciasNotificacionesContenido controlPermisos={control} />);

        await waitFor(() => {
          expect(screen.getByTestId('preferencias-notificaciones-contenido')).toBeDefined();
        });

        // 1. Estado en dispositivo NUNCA debe ser Habilitado
        const estadoDispositivo = screen.getByTestId('estado-push-dispositivo');
        expect(estadoDispositivo.textContent).toBe('Inhabilitado (permiso denegado en dispositivo)');
        expect(estadoDispositivo.textContent).not.toBe('Habilitado');
        expect(screen.getByTestId('badge-push-dispositivo').textContent).toBe(
          'Canal no habilitado en dispositivo'
        );
        expect(screen.getByTestId('btn-abrir-ajustes')).toBeDefined();

        // 2. El usuario va a Ajustes del sistema y las habilita
        notificacionesHabilitadas = true;

        // 3. Al volver a la app (AppState 'active')
        await act(async () => {
          (AppState as any)._simulateStateChange('active');
        });

        await waitFor(() => {
          expect(screen.getByTestId('estado-push-dispositivo').textContent).toBe('Habilitado');
        });
        expect(screen.queryByTestId('btn-abrir-ajustes')).toBeNull();
      } finally {
        (Platform as any).OS = origOS;
        (Platform as any).Version = origVersion;
      }
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

  describe('AdaptadorNativoExpo y mapeo Expo 57', () => {
    it('mapea respuestas de Expo 57 al dominio correctamente', () => {
      expect(mapearEstadoPermisoExpo({ status: 'granted', granted: true })).toBe('concedido');
      expect(
        mapearEstadoPermisoExpo({ status: 'denied', granted: false, canAskAgain: false })
      ).toBe('denegado');
      expect(
        mapearEstadoPermisoExpo({ status: 'undetermined', granted: false, canAskAgain: true })
      ).toBe('no_determinado');
      expect(mapearEstadoPermisoExpo(null)).toBe('no_disponible');
      expect(mapearEstadoPermisoExpo(undefined)).toBe('no_disponible');
    });

    it('AdaptadorNativoExpo consulta getPermissionsAsync y requestPermissionsAsync del módulo si existe', async () => {
      const moduloMock = {
        getPermissionsAsync: vi.fn(async () => ({
          status: 'granted' as const,
          granted: true,
        })),
        requestPermissionsAsync: vi.fn(async () => ({
          status: 'granted' as const,
          granted: true,
        })),
      };
      const adaptador = new AdaptadorNativoExpo(moduloMock);

      const estado = await adaptador.obtenerPermiso();
      expect(estado).toBe('concedido');
      expect(moduloMock.getPermissionsAsync).toHaveBeenCalledTimes(1);

      const solicitud = await adaptador.solicitarPermiso();
      expect(solicitud).toBe('concedido');
      expect(moduloMock.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    it('AdaptadorNativoExpo devuelve no_disponible si el módulo es nulo o lanza error', async () => {
      const adaptadorSinModulo = new AdaptadorNativoExpo(null);
      expect(await adaptadorSinModulo.obtenerPermiso()).toBe('no_disponible');
      expect(await adaptadorSinModulo.solicitarPermiso()).toBe('no_disponible');

      const moduloQueFalla = {
        getPermissionsAsync: vi.fn(async () => {
          throw new Error('Native crash');
        }),
        requestPermissionsAsync: vi.fn(async () => {
          throw new Error('Native crash');
        }),
      };
      const adaptadorFalla = new AdaptadorNativoExpo(moduloQueFalla);
      expect(await adaptadorFalla.obtenerPermiso()).toBe('no_disponible');
      expect(await adaptadorFalla.solicitarPermiso()).toBe('no_disponible');
    });

    it('AdaptadorNativoExpo en Android 13+ (API >= 33) usa PermissionsAndroid para verificar y solicitar', async () => {
      const origOS = Platform.OS;
      const origVersion = Platform.Version;
      (Platform as any).OS = 'android';
      (Platform as any).Version = 34;

      try {
        const adaptador = new AdaptadorNativoExpo(null);

        // 1. check() devuelve false -> no_determinado
        (PermissionsAndroid as any)._setPermisoParaPruebas(false);
        expect(await adaptador.obtenerPermiso()).toBe('no_determinado');

        // 2. check() devuelve true -> concedido
        (PermissionsAndroid as any)._setPermisoParaPruebas(true);
        expect(await adaptador.obtenerPermiso()).toBe('concedido');

        // 3. solicitarPermiso con resultado GRANTED -> concedido
        (PermissionsAndroid as any)._setPermisoParaPruebas(false, 'granted');
        expect(await adaptador.solicitarPermiso()).toBe('concedido');

        // 4. solicitarPermiso con resultado DENIED -> denegado
        (PermissionsAndroid as any)._setPermisoParaPruebas(false, 'denied');
        expect(await adaptador.solicitarPermiso()).toBe('denegado');

        // 5. solicitarPermiso con resultado NEVER_ASK_AGAIN -> denegado
        (PermissionsAndroid as any)._setPermisoParaPruebas(false, 'never_ask_again');
        expect(await adaptador.solicitarPermiso()).toBe('denegado');
      } finally {
        (Platform as any).OS = origOS;
        (Platform as any).Version = origVersion;
      }
    });

    it('AdaptadorNativoExpo en Android < 33 sin capacidad nativa de consulta devuelve no_disponible y nunca asume concedido', async () => {
      const origOS = Platform.OS;
      const origVersion = Platform.Version;
      (Platform as any).OS = 'android';
      (Platform as any).Version = 30;

      try {
        const adaptador = new AdaptadorNativoExpo(null, null);
        expect(await adaptador.obtenerPermiso()).toBe('no_disponible');
        expect(await adaptador.solicitarPermiso()).toBe('no_disponible');
      } finally {
        (Platform as any).OS = origOS;
        (Platform as any).Version = origVersion;
      }
    });

    it('AdaptadorNativoExpo en Android < 33 con puente NotificationManagerCompat consulta areNotificationsEnabled de forma veraz', async () => {
      const origOS = Platform.OS;
      const origVersion = Platform.Version;
      (Platform as any).OS = 'android';
      (Platform as any).Version = 30;

      try {
        const puente = {
          areNotificationsEnabled: vi.fn(),
        };
        const adaptador = new AdaptadorNativoExpo(null, puente);

        // Si están bloqueadas en Ajustes de Android
        puente.areNotificationsEnabled.mockResolvedValueOnce(false);
        expect(await adaptador.obtenerPermiso()).toBe('denegado');

        // Si están habilitadas en Ajustes de Android
        puente.areNotificationsEnabled.mockResolvedValueOnce(true);
        expect(await adaptador.obtenerPermiso()).toBe('concedido');

        // Solicitar permiso en Android < 33 consulta el estado efectivo
        puente.areNotificationsEnabled.mockResolvedValueOnce(false);
        expect(await adaptador.solicitarPermiso()).toBe('denegado');

        puente.areNotificationsEnabled.mockResolvedValueOnce(true);
        expect(await adaptador.solicitarPermiso()).toBe('concedido');
      } finally {
        (Platform as any).OS = origOS;
        (Platform as any).Version = origVersion;
      }
    });
  });
});
