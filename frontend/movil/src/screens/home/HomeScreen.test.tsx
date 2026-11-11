// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HomeScreen, { HomeView } from './HomeScreen';
import type { Suscripcion, Usuario } from '@ojoalgasto/shared';

const MOCK_USUARIO: Usuario = {
  id: 'usr-1',
  nombre: 'Sebastian Mena',
  correo: 'sebastian@ojoalgasto.cl',
  rol: 'administrador',
  organizacion_id: 'org-1',
  plan: 'pro',
};

const MOCK_SUSCRIPCIONES: Suscripcion[] = [
  {
    id: '1',
    nombre: 'Netflix',
    monto: 9990,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-10-05',
    categoria: 'streaming',
    estado: 'activo',
    horas_uso_mes: 18,
  },
  {
    id: '2',
    nombre: 'Spotify',
    monto: 4990,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-09-28',
    categoria: 'musica',
    estado: 'activo',
    horas_uso_mes: 40,
  },
  {
    id: '3',
    nombre: 'Gimnasio',
    monto: 25000,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-10-01',
    categoria: 'salud',
    estado: 'fantasma',
    horas_uso_mes: 0,
  },
];

describe('Home Móvil de Suscripciones (SE-17)', () => {
  describe('Componente Presentacional HomeView', () => {
    it('renderiza encabezado con título, usuario y botones de acción principales', () => {
      const onSuscripcionPress = vi.fn();
      const onNuevaSuscripcion = vi.fn();
      const onReintentar = vi.fn();
      const onLogout = vi.fn();

      render(
        <HomeView
          estado={{ tipo: 'listo', datos: MOCK_SUSCRIPCIONES }}
          usuario={MOCK_USUARIO}
          onSuscripcionPress={onSuscripcionPress}
          onNuevaSuscripcion={onNuevaSuscripcion}
          onReintentar={onReintentar}
          onLogout={onLogout}
        />
      );

      expect(screen.getByTestId('screen-home')).toBeTruthy();
      expect(screen.getByText('Home de Suscripciones')).toBeTruthy();
      expect(screen.getByText('Usuario: Sebastian Mena')).toBeTruthy();
      expect(screen.getByTestId('go-nueva-suscripcion')).toBeTruthy();
      expect(screen.getByTestId('logout')).toBeTruthy();
    });

    it('renderiza resumen de gasto mensual proyectado y total de suscripciones', () => {
      render(
        <HomeView
          estado={{ tipo: 'listo', datos: MOCK_SUSCRIPCIONES }}
          usuario={MOCK_USUARIO}
          onSuscripcionPress={vi.fn()}
          onNuevaSuscripcion={vi.fn()}
          onReintentar={vi.fn()}
        />
      );

      const resumen = screen.getByTestId('resumen-gastos');
      expect(resumen).toBeTruthy();
      expect(screen.getByText('Gasto mensual proyectado')).toBeTruthy();
      // 9990 + 4990 + 25000 = 39980 CLP
      expect(screen.getByText(/39\.980/)).toBeTruthy();
      expect(screen.getByText('3 suscripciones en total')).toBeTruthy();
    });

    it('renderiza lista de tarjetas con nombre, categoría, monto y badge de estado', () => {
      render(
        <HomeView
          estado={{ tipo: 'listo', datos: MOCK_SUSCRIPCIONES }}
          usuario={MOCK_USUARIO}
          onSuscripcionPress={vi.fn()}
          onNuevaSuscripcion={vi.fn()}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByText('Netflix')).toBeTruthy();
      expect(screen.getByText('streaming')).toBeTruthy();
      expect(screen.getByText('Spotify')).toBeTruthy();
      expect(screen.getByText('Gimnasio')).toBeTruthy();
      expect(screen.getByText('Sin uso')).toBeTruthy(); // Estado fantasma
    });

    it('dispara onSuscripcionPress con los datos de la suscripción al pulsar una tarjeta', () => {
      const onSuscripcionPress = vi.fn();

      render(
        <HomeView
          estado={{ tipo: 'listo', datos: MOCK_SUSCRIPCIONES }}
          usuario={MOCK_USUARIO}
          onSuscripcionPress={onSuscripcionPress}
          onNuevaSuscripcion={vi.fn()}
          onReintentar={vi.fn()}
        />
      );

      // Card 1 usa go-detalle para compatibilidad de navegación
      fireEvent.click(screen.getByTestId('go-detalle'));
      expect(onSuscripcionPress).toHaveBeenCalledWith(MOCK_SUSCRIPCIONES[0]);

      // Card 2 usa card-suscripcion-2
      fireEvent.click(screen.getByTestId('card-suscripcion-2'));
      expect(onSuscripcionPress).toHaveBeenCalledWith(MOCK_SUSCRIPCIONES[1]);
    });

    it('dispara onNuevaSuscripcion al presionar el botón de acción Crear Nueva Suscripción', () => {
      const onNuevaSuscripcion = vi.fn();

      render(
        <HomeView
          estado={{ tipo: 'listo', datos: MOCK_SUSCRIPCIONES }}
          usuario={MOCK_USUARIO}
          onSuscripcionPress={vi.fn()}
          onNuevaSuscripcion={onNuevaSuscripcion}
          onReintentar={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('go-nueva-suscripcion'));
      expect(onNuevaSuscripcion).toHaveBeenCalledTimes(1);
    });

    it('dispara onLogout al presionar el botón de Cerrar Sesión', () => {
      const onLogout = vi.fn();

      render(
        <HomeView
          estado={{ tipo: 'listo', datos: MOCK_SUSCRIPCIONES }}
          usuario={MOCK_USUARIO}
          onSuscripcionPress={vi.fn()}
          onNuevaSuscripcion={vi.fn()}
          onReintentar={vi.fn()}
          onLogout={onLogout}
        />
      );

      fireEvent.click(screen.getByTestId('logout'));
      expect(onLogout).toHaveBeenCalledTimes(1);
    });

    it('muestra estado cargando (Loading con progressbar) cuando tipo es cargando', () => {
      render(
        <HomeView
          estado={{ tipo: 'cargando' }}
          usuario={MOCK_USUARIO}
          onSuscripcionPress={vi.fn()}
          onNuevaSuscripcion={vi.fn()}
          onReintentar={vi.fn()}
        />
      );

      // Loading de AN-28 define role="progressbar"
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toBeTruthy();
      expect(screen.queryByTestId('lista-suscripciones')).toBeNull();
    });

    it('muestra estado error (NetworkError con alert) y reintenta con onReintentar', () => {
      const onReintentar = vi.fn();

      render(
        <HomeView
          estado={{ tipo: 'error' }}
          usuario={MOCK_USUARIO}
          onSuscripcionPress={vi.fn()}
          onNuevaSuscripcion={vi.fn()}
          onReintentar={onReintentar}
        />
      );

      // NetworkError de AN-28 define role="alert"
      const alerta = screen.getByRole('alert');
      expect(alerta).toBeTruthy();

      const btnReintentar = screen.getByRole('button', { name: /reintentar/i });
      fireEvent.click(btnReintentar);
      expect(onReintentar).toHaveBeenCalledTimes(1);
    });

    it('muestra estado vacio (EmptyState) con acción para crear suscripción', () => {
      const onNuevaSuscripcion = vi.fn();

      render(
        <HomeView
          estado={{ tipo: 'listo', datos: [] }}
          usuario={MOCK_USUARIO}
          onSuscripcionPress={vi.fn()}
          onNuevaSuscripcion={onNuevaSuscripcion}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByText('No tienes suscripciones todavía')).toBeTruthy();
      expect(
        screen.getByText(
          'Agrega tu primera suscripción para comenzar a controlar tus cobros y gastos.'
        )
      ).toBeTruthy();

      const btnCrear = screen.getByRole('button', { name: 'Crear suscripción' });
      fireEvent.click(btnCrear);
      expect(onNuevaSuscripcion).toHaveBeenCalledTimes(1);
    });
  });

  describe('Componente Contenedor HomeScreen', () => {
    it('carga suscripciones automáticamente al montarse consumiendo la API', async () => {
      const onCargarSuscripciones = vi
        .fn()
        .mockResolvedValueOnce(MOCK_SUSCRIPCIONES);

      render(<HomeScreen onCargarSuscripciones={onCargarSuscripciones} />);

      // Inicialmente muestra estado cargando
      expect(screen.getByRole('progressbar')).toBeTruthy();

      // Al resolver, carga las suscripciones reales
      expect(await screen.findByText('Netflix')).toBeTruthy();
      expect(onCargarSuscripciones).toHaveBeenCalledTimes(1);
    });

    it('navega a SuscripcionDetalle con id al presionar una suscripción', () => {
      const navigateMock = vi.fn();
      const navigation = { navigate: navigateMock };

      render(
        <HomeScreen
          navigation={navigation as any}
          estadoInicial={{ tipo: 'listo', datos: MOCK_SUSCRIPCIONES }}
        />
      );

      fireEvent.click(screen.getByTestId('go-detalle'));
      expect(navigateMock).toHaveBeenCalledWith('SuscripcionDetalle', { id: '1' });
    });

    it('navega a SuscripcionNueva al presionar botón Crear Nueva Suscripción', () => {
      const navigateMock = vi.fn();
      const navigation = { navigate: navigateMock };

      render(
        <HomeScreen
          navigation={navigation as any}
          estadoInicial={{ tipo: 'listo', datos: MOCK_SUSCRIPCIONES }}
        />
      );

      fireEvent.click(screen.getByTestId('go-nueva-suscripcion'));
      expect(navigateMock).toHaveBeenCalledWith('SuscripcionNueva');
    });

    it('soporta recarga mediante onCargarSuscripciones en reintento', async () => {
      const onCargarSuscripciones = vi
        .fn()
        .mockResolvedValueOnce(MOCK_SUSCRIPCIONES);

      render(
        <HomeScreen
          navigation={{ navigate: vi.fn() } as any}
          estadoInicial={{ tipo: 'error' }}
          onCargarSuscripciones={onCargarSuscripciones}
        />
      );

      expect(screen.getByRole('alert')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
      expect(onCargarSuscripciones).toHaveBeenCalledTimes(1);

      expect(await screen.findByText('Netflix')).toBeTruthy();
    });
  });
});
