// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SuscripcionDetalleScreen from './SuscripcionDetalleScreen';
import { HistorialUsoMovil } from './HistorialUsoMovil';
import type { RegistroUso, Suscripcion } from '@ojoalgasto/shared';

const MOCK_SUSCRIPCION: Suscripcion = {
  id: 'sub-netflix',
  nombre: 'Netflix',
  monto: 9990,
  moneda: 'CLP',
  frecuencia: 'mensual',
  fecha_proximo_cobro: '2026-10-05',
  categoria: 'streaming',
  estado: 'activo',
  horas_uso_mes: 2,
};

const MOCK_USOS_NETFLIX: RegistroUso[] = [
  { fecha: '2026-10-18', minutos: 90 },
  { fecha: '2026-10-12', minutos: 45 },
  { fecha: '2026-10-05', minutos: 60 },
];

const MOCK_USOS_SPOTIFY: RegistroUso[] = [
  { fecha: '2026-10-15', minutos: 120 },
  { fecha: '2026-10-01', minutos: 30 },
];

describe('SE-30 — Mostrar historial móvil de uso por fecha', () => {
  describe('Componente Presentacional HistorialUsoMovil', () => {
    it('muestra indicador de carga accesible cuando el estado es cargando', () => {
      render(
        <HistorialUsoMovil
          estado={{ tipo: 'cargando' }}
          onReintentar={vi.fn()}
        />
      );

      const cargando = screen.getByTestId('historial-cargando');
      expect(cargando).toBeTruthy();
      expect(cargando.getAttribute('role')).toBe('progressbar');
      expect(screen.getByText('Cargando historial de uso...')).toBeTruthy();
    });

    it('muestra alerta accesible y botón de reintento cuando el estado es error', () => {
      const onReintentar = vi.fn();
      render(
        <HistorialUsoMovil
          estado={{ tipo: 'error', mensaje: 'Fallo de conexión al cargar historial' }}
          onReintentar={onReintentar}
        />
      );

      const errorBox = screen.getByTestId('historial-error');
      expect(errorBox).toBeTruthy();
      expect(errorBox.getAttribute('role')).toBe('alert');
      expect(screen.getByText('Fallo de conexión al cargar historial')).toBeTruthy();

      const btnReintentar = screen.getByTestId('btn-reintentar-historial');
      fireEvent.click(btnReintentar);
      expect(onReintentar).toHaveBeenCalledTimes(1);
    });

    it('muestra estado vacío accesible cuando la lista de usos está vacía', () => {
      render(
        <HistorialUsoMovil
          estado={{ tipo: 'listo', usos: [] }}
          onReintentar={vi.fn()}
        />
      );

      const vacio = screen.getByTestId('historial-vacio');
      expect(vacio).toBeTruthy();
      expect(screen.getByText('Todavía no registras uso de esta suscripción.')).toBeTruthy();
    });

    it('renderiza la lista de registros en orden descendente con fecha y duración formateada', () => {
      render(
        <HistorialUsoMovil
          estado={{ tipo: 'listo', usos: MOCK_USOS_NETFLIX }}
          onReintentar={vi.fn()}
        />
      );

      const lista = screen.getByTestId('lista-historial-uso');
      expect(lista).toBeTruthy();

      // Registro 0: 2026-10-18, 90 min (1 h 30 min)
      expect(screen.getByTestId('historial-fila-0')).toBeTruthy();
      expect(screen.getByTestId('historial-fecha-0').textContent).toBe('18 oct 2026');
      expect(screen.getByTestId('historial-minutos-0').textContent).toBe('1 h 30 min');

      // Registro 1: 2026-10-12, 45 min
      expect(screen.getByTestId('historial-fila-1')).toBeTruthy();
      expect(screen.getByTestId('historial-fecha-1').textContent).toBe('12 oct 2026');
      expect(screen.getByTestId('historial-minutos-1').textContent).toBe('45 min');

      // Registro 2: 2026-10-05, 60 min (1 h)
      expect(screen.getByTestId('historial-fila-2')).toBeTruthy();
      expect(screen.getByTestId('historial-fecha-2').textContent).toBe('05 oct 2026');
      expect(screen.getByTestId('historial-minutos-2').textContent).toBe('1 h');
    });
  });

  describe('Criterio 1: Historial coincide con backend y se actualiza tras uso', () => {
    it('carga el historial desde el backend al montar y lo muestra en orden descendente', async () => {
      const onCargarSuscripcion = vi.fn().mockResolvedValue(MOCK_SUSCRIPCION);
      const onCargarHistorial = vi.fn().mockResolvedValue(MOCK_USOS_NETFLIX);

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-netflix' } }}
          onCargarSuscripcion={onCargarSuscripcion}
          onCargarHistorial={onCargarHistorial}
        />
      );

      expect(await screen.findByText('Netflix')).toBeTruthy();
      expect(onCargarHistorial).toHaveBeenCalledWith('sub-netflix');

      // Verifica los registros devueltos por el backend
      expect(await screen.findByText('18 oct 2026')).toBeTruthy();
      expect(screen.getByText('1 h 30 min')).toBeTruthy();
      expect(screen.getByText('12 oct 2026')).toBeTruthy();
      expect(screen.getByText('45 min')).toBeTruthy();
    });

    it('actualiza automáticamente el historial tras registrar un nuevo uso exitoso en el modal', async () => {
      const onCargarSuscripcion = vi.fn().mockResolvedValue(MOCK_SUSCRIPCION);
      const onCargarHistorial = vi.fn()
        .mockResolvedValueOnce(MOCK_USOS_NETFLIX) // Carga inicial
        .mockResolvedValueOnce([
          { fecha: '2026-10-20', minutos: 30 }, // Nuevo registro añadido
          ...MOCK_USOS_NETFLIX,
        ]);

      const subActualizada: Suscripcion = {
        ...MOCK_SUSCRIPCION,
        horas_uso_mes: 2.5,
      };
      const onRegistrarUsoApi = vi.fn().mockResolvedValue(subActualizada);

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-netflix' } }}
          onCargarSuscripcion={onCargarSuscripcion}
          onCargarHistorial={onCargarHistorial}
          onRegistrarUsoApi={onRegistrarUsoApi}
        />
      );

      // Esperar carga inicial
      expect(await screen.findByText('Netflix')).toBeTruthy();
      expect(await screen.findByText('18 oct 2026')).toBeTruthy();
      expect(onCargarHistorial).toHaveBeenCalledTimes(1);

      // Abrir modal de registrar uso
      const btnAbrirUso = screen.getByTestId('btn-registrar-uso');
      fireEvent.click(btnAbrirUso);

      expect(await screen.findByTestId('modal-registrar-uso')).toBeTruthy();

      // Ingresar minutos
      const inputMinutos = screen.getByTestId('input-minutos');
      fireEvent.change(inputMinutos, { target: { value: '30' } });

      // Enviar formulario
      const btnGuardar = screen.getByTestId('btn-submit-uso');
      await act(async () => {
        fireEvent.click(btnGuardar);
      });

      // Se llamó la API de registro
      expect(onRegistrarUsoApi).toHaveBeenCalledWith('sub-netflix', expect.objectContaining({
        minutos: 30,
      }));

      // Debe haberse solicitado la recarga del historial (segunda llamada)
      expect(onCargarHistorial).toHaveBeenCalledTimes(2);

      // El nuevo registro de 30 min ahora es visible en la lista
      expect(await screen.findByText('20 oct 2026')).toBeTruthy();
      expect(screen.getByText('30 min')).toBeTruthy();
    });

    it('reintentar en estado de error vuelve a consultar el historial sin perder los datos de la suscripción', async () => {
      const onCargarSuscripcion = vi.fn().mockResolvedValue(MOCK_SUSCRIPCION);
      const onCargarHistorial = vi.fn()
        .mockRejectedValueOnce(new Error('Fallo de red'))
        .mockResolvedValueOnce(MOCK_USOS_NETFLIX);

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-netflix' } }}
          onCargarSuscripcion={onCargarSuscripcion}
          onCargarHistorial={onCargarHistorial}
        />
      );

      // La suscripción carga correctamente
      expect(await screen.findByText('Netflix')).toBeTruthy();

      // El historial muestra estado de error
      expect(await screen.findByTestId('historial-error')).toBeTruthy();
      expect(screen.getByText('No pudimos cargar el historial de uso.')).toBeTruthy();

      // Pulsar reintentar historial
      const btnReintentar = screen.getByTestId('btn-reintentar-historial');
      await act(async () => {
        fireEvent.click(btnReintentar);
      });

      // Segunda llamada exitosa
      expect(onCargarHistorial).toHaveBeenCalledTimes(2);
      expect(await screen.findByText('18 oct 2026')).toBeTruthy();
      expect(screen.queryByTestId('historial-error')).toBeNull();
    });
  });

  describe('Criterio 2: No se mezcla información de otro id/tenant', () => {
    it('al cambiar de suscripción (id diferente) se descarta la respuesta tardía del id anterior', async () => {
      let resolverNetflix: (usos: RegistroUso[]) => void = () => {};
      const promesaNetflixLenta = new Promise<RegistroUso[]>((resolve) => {
        resolverNetflix = resolve;
      });

      const onCargarSuscripcion = vi.fn().mockImplementation((id: string) => {
        return Promise.resolve({
          ...MOCK_SUSCRIPCION,
          id,
          nombre: id === 'sub-netflix' ? 'Netflix' : 'Spotify',
        });
      });

      const onCargarHistorial = vi.fn().mockImplementation((id: string) => {
        if (id === 'sub-netflix') {
          return promesaNetflixLenta; // Lento
        }
        return Promise.resolve(MOCK_USOS_SPOTIFY); // Rápido
      });

      const { rerender } = render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-netflix' } }}
          onCargarSuscripcion={onCargarSuscripcion}
          onCargarHistorial={onCargarHistorial}
        />
      );

      // Netflix está cargando historial
      expect(await screen.findByText('Netflix')).toBeTruthy();
      expect(screen.getByTestId('historial-cargando')).toBeTruthy();

      // El usuario cambia inmediatamente a Spotify (mismo componente con nueva ruta)
      rerender(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-spotify' } }}
          onCargarSuscripcion={onCargarSuscripcion}
          onCargarHistorial={onCargarHistorial}
        />
      );

      // Spotify resuelve de inmediato con su propio historial
      expect(await screen.findByText('Spotify')).toBeTruthy();
      expect(await screen.findByText('15 oct 2026')).toBeTruthy();
      expect(screen.getByTestId('historial-minutos-0').textContent).toBe('2 h');

      // Ahora resuelve tardíamente la promesa de Netflix
      await act(async () => {
        resolverNetflix(MOCK_USOS_NETFLIX);
      });

      // El historial de Spotify DEBE mantenerse intacto; los registros de Netflix NUNCA deben mostrarse
      expect(screen.getByText('15 oct 2026')).toBeTruthy();
      expect(screen.getByTestId('historial-minutos-0').textContent).toBe('2 h');
      expect(screen.queryByText('18 oct 2026')).toBeNull();
      expect(screen.queryByText('1 h 30 min')).toBeNull();
    });

    it('un fallo en el historial del id anterior no contamina el estado del nuevo id', async () => {
      let rechazarNetflix: (err: any) => void = () => {};
      const promesaNetflixFalla = new Promise<RegistroUso[]>((_resolve, reject) => {
        rechazarNetflix = reject;
      });

      const onCargarSuscripcion = vi.fn().mockImplementation((id: string) => {
        return Promise.resolve({
          ...MOCK_SUSCRIPCION,
          id,
          nombre: id === 'sub-netflix' ? 'Netflix' : 'Spotify',
        });
      });

      const onCargarHistorial = vi.fn().mockImplementation((id: string) => {
        if (id === 'sub-netflix') {
          return promesaNetflixFalla;
        }
        return Promise.resolve(MOCK_USOS_SPOTIFY);
      });

      const { rerender } = render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-netflix' } }}
          onCargarSuscripcion={onCargarSuscripcion}
          onCargarHistorial={onCargarHistorial}
        />
      );

      expect(await screen.findByText('Netflix')).toBeTruthy();

      // Cambia a Spotify
      rerender(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-spotify' } }}
          onCargarSuscripcion={onCargarSuscripcion}
          onCargarHistorial={onCargarHistorial}
        />
      );

      expect(await screen.findByText('Spotify')).toBeTruthy();
      expect(await screen.findByText('15 oct 2026')).toBeTruthy();

      // Rechazo tardío de Netflix
      await act(async () => {
        rechazarNetflix(new Error('500 Server Error en Netflix'));
      });

      // Spotify permanece en estado listo y no pasa a error
      expect(screen.queryByTestId('historial-error')).toBeNull();
      expect(screen.getByText('15 oct 2026')).toBeTruthy();
    });

    it('Regresión P2 · Una lectura inicial lenta del mismo historial se descarta al recargar tras registrar uso sin pisar los nuevos registros', async () => {
      let resolverLecturaInicialA: (usos: RegistroUso[]) => void = () => {};
      const promesaInicialLenta = new Promise<RegistroUso[]>((resolve) => {
        resolverLecturaInicialA = resolve;
      });

      const onCargarSuscripcion = vi.fn().mockResolvedValue(MOCK_SUSCRIPCION);
      const onCargarHistorial = vi.fn()
        .mockImplementationOnce(() => promesaInicialLenta) // Petición A inicial (lenta)
        .mockResolvedValueOnce([ // Petición B posterior tras registrar uso
          { fecha: '2026-10-20', minutos: 60 },
        ]);

      const onRegistrarUsoApi = vi.fn().mockResolvedValue({
        ...MOCK_SUSCRIPCION,
        horas_uso_mes: 3,
      });

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-netflix' } }}
          onCargarSuscripcion={onCargarSuscripcion}
          onCargarHistorial={onCargarHistorial}
          onRegistrarUsoApi={onRegistrarUsoApi}
        />
      );

      // La suscripción carga correctamente
      expect(await screen.findByText('Netflix')).toBeTruthy();
      expect(onCargarHistorial).toHaveBeenCalledTimes(1);

      // Abrir modal de registro de uso
      fireEvent.click(screen.getByTestId('btn-registrar-uso'));
      expect(await screen.findByTestId('modal-registrar-uso')).toBeTruthy();

      // Enviar 60 minutos
      fireEvent.change(screen.getByTestId('input-minutos'), { target: { value: '60' } });
      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-submit-uso'));
      });

      expect(onRegistrarUsoApi).toHaveBeenCalledTimes(1);
      // Se solicitó la recarga B
      expect(onCargarHistorial).toHaveBeenCalledTimes(2);

      // La recarga B resolvió y muestra "1 h"
      expect(await screen.findByText('1 h')).toBeTruthy();
      expect(screen.getByText('20 oct 2026')).toBeTruthy();

      // Ahora la petición lenta anterior A resuelve tardíamente con []
      await act(async () => {
        resolverLecturaInicialA([]);
      });

      // La fila de "1 h" del nuevo uso debe permanecer intacta y no borrarse
      expect(screen.getByText('1 h')).toBeTruthy();
      expect(screen.getByText('20 oct 2026')).toBeTruthy();
      expect(screen.queryByTestId('historial-vacio')).toBeNull();
      expect(screen.queryByTestId('historial-error')).toBeNull();
    });
  });
});
