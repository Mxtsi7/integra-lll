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

      expect(screen.getByTestId('empty-state-home')).toBeTruthy();
      expect(screen.getByText('Todavía no registras suscripciones')).toBeTruthy();
      expect(
        screen.getByText(
          'Agrega la primera y empieza a ver cuánto gastas al mes, qué cobros vienen y cuáles pagas sin usar.'
        )
      ).toBeTruthy();

      const btnCrear = screen.getByTestId('btn-crear-primera-suscripcion');
      expect(btnCrear).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Agregar suscripción' })).toBeTruthy();
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

  describe('Vacío Móvil y Acceso a Primera Suscripción (SE-20)', () => {
    describe('Criterio 1: Cuenta sin suscripciones ve instrucción útil', () => {
      it('muestra encabezado, descripción de valor basada en web y CTA primario sin mostrar lista ni resumen', () => {
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

        // Contenedor de estado vacío presente
        expect(screen.getByTestId('empty-state-home')).toBeTruthy();

        // Título con rol de encabezado
        const encabezado = screen.getByText('Todavía no registras suscripciones');
        expect(encabezado).toBeTruthy();
        expect(encabezado.getAttribute('role')).toBe('header');

        // Instrucción útil que orienta al usuario sobre qué beneficios obtiene
        expect(
          screen.getByText(
            'Agrega la primera y empieza a ver cuánto gastas al mes, qué cobros vienen y cuáles pagas sin usar.'
          )
        ).toBeTruthy();

        // Botón CTA primario accesible
        const btnCta = screen.getByTestId('btn-crear-primera-suscripcion');
        expect(btnCta).toBeTruthy();
        expect(btnCta.getAttribute('aria-label')).toBe('Agregar suscripción');

        // No se presentan resumen numérico ni lista cuando la cuenta está vacía
        expect(screen.queryByTestId('resumen-gastos')).toBeNull();
        expect(screen.queryByTestId('lista-suscripciones')).toBeNull();

        // Al pulsar el botón se invoca la acción
        fireEvent.click(btnCta);
        expect(onNuevaSuscripcion).toHaveBeenCalledTimes(1);
      });
    });

    describe('Criterio 2: Un fallo de red NO se presenta como cuenta vacía', () => {
      it('en estado error muestra NetworkError con role="alert" y NUNCA el estado vacío ni su CTA', () => {
        render(
          <HomeView
            estado={{ tipo: 'error' }}
            usuario={MOCK_USUARIO}
            onSuscripcionPress={vi.fn()}
            onNuevaSuscripcion={vi.fn()}
            onReintentar={vi.fn()}
          />
        );

        // Se muestra alerta de error de red
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByRole('button', { name: /reintentar/i })).toBeTruthy();

        // NUNCA se presenta como vacío
        expect(screen.queryByTestId('empty-state-home')).toBeNull();
        expect(screen.queryByTestId('btn-crear-primera-suscripcion')).toBeNull();
        expect(screen.queryByText('Todavía no registras suscripciones')).toBeNull();
      });

      it('en estado cargando muestra Loading con role="progressbar" y NUNCA el estado vacío', () => {
        render(
          <HomeView
            estado={{ tipo: 'cargando' }}
            usuario={MOCK_USUARIO}
            onSuscripcionPress={vi.fn()}
            onNuevaSuscripcion={vi.fn()}
            onReintentar={vi.fn()}
          />
        );

        expect(screen.getByRole('progressbar')).toBeTruthy();
        expect(screen.queryByTestId('empty-state-home')).toBeNull();
        expect(screen.queryByTestId('btn-crear-primera-suscripcion')).toBeNull();
      });

      it('en contenedor HomeScreen: caída de API muestra error y al reintentar exitoso con [] muestra vacío', async () => {
        const onCargarSuscripciones = vi
          .fn()
          .mockRejectedValueOnce(new Error('Network request failed'))
          .mockResolvedValueOnce([]);

        render(<HomeScreen onCargarSuscripciones={onCargarSuscripciones} />);

        // Al fallar la red, muestra alerta de error y NUNCA estado vacío
        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.queryByTestId('empty-state-home')).toBeNull();

        // Usuario reintenta la carga
        fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

        // Ahora la API responde lista vacía: pasa a mostrar el estado vacío con instrucción útil
        expect(
          await screen.findByText('Todavía no registras suscripciones')
        ).toBeTruthy();
        expect(screen.getByTestId('btn-crear-primera-suscripcion')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
      });
    });

    describe('Navegación CTA hacia SuscripcionNueva', () => {
      it('navega a SuscripcionNueva al pulsar el CTA del estado vacío en HomeScreen', () => {
        const navigateMock = vi.fn();
        const navigation = { navigate: navigateMock };

        render(
          <HomeScreen
            navigation={navigation as any}
            estadoInicial={{ tipo: 'listo', datos: [] }}
          />
        );

        const btnCta = screen.getByTestId('btn-crear-primera-suscripcion');
        fireEvent.click(btnCta);

        expect(navigateMock).toHaveBeenCalledWith('SuscripcionNueva');
      });
    });
  });
});
