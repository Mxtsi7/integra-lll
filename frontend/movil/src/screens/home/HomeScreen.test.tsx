// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import HomeScreen, { HomeView, deduplicarSuscripciones } from './HomeScreen';
import {
  FiltrosSuscripcionesMovil,
  describirCriterioActivo,
} from './FiltrosSuscripcionesMovil';
import type {
  Suscripcion,
  SuscripcionesPaginadas,
  Usuario,
} from '@ojoalgasto/shared';

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

    describe('Invalidación y actualización de listado ante foco (SE-23)', () => {
      it('invalida y recarga la lista cuando la pantalla recupera el foco', async () => {
        let focusCallback: (() => void) | undefined;
        const addListenerMock = vi.fn().mockImplementation((event, cb) => {
          if (event === 'focus') {
            focusCallback = cb;
          }
          return () => {};
        });

        const suscripcionNueva: Suscripcion = {
          id: 'sub-nueva',
          nombre: 'HBO Max',
          monto: 5990,
          moneda: 'CLP',
          frecuencia: 'mensual',
          fecha_proximo_cobro: '2026-12-10',
          categoria: 'streaming',
          estado: 'activo',
        };

        const onCargarSuscripciones = vi
          .fn()
          .mockResolvedValueOnce(MOCK_SUSCRIPCIONES)
          .mockResolvedValueOnce([...MOCK_SUSCRIPCIONES, suscripcionNueva]);

        render(
          <HomeScreen
            navigation={{ addListener: addListenerMock } as any}
            onCargarSuscripciones={onCargarSuscripciones}
          />
        );

        // Carga inicial
        expect(await screen.findByText('Netflix')).toBeTruthy();
        expect(screen.queryByText('HBO Max')).toBeNull();
        expect(onCargarSuscripciones).toHaveBeenCalledTimes(1);

        // Simular evento de foco (por ejemplo, al volver de crear una nueva suscripción)
        await act(async () => {
          focusCallback?.();
        });

        // La lista se actualizó y ahora incluye la nueva suscripción
        expect(await screen.findByText('HBO Max')).toBeTruthy();
        expect(onCargarSuscripciones).toHaveBeenCalledTimes(2);
      });
    });

    describe('Protección contra respuestas asíncronas desordenadas o desactualizadas', () => {
      it('ignora respuesta anterior A si B resolvió primero y conserva los datos y totales de B', async () => {
        let resolverA: (val: Suscripcion[]) => void = () => {};
        let resolverB: (val: Suscripcion[]) => void = () => {};

        const promesaA = new Promise<Suscripcion[]>((res) => {
          resolverA = res;
        });
        const promesaB = new Promise<Suscripcion[]>((res) => {
          resolverB = res;
        });

        let focusCallback: (() => void) | undefined;
        const addListenerMock = vi.fn().mockImplementation((event, cb) => {
          if (event === 'focus') {
            focusCallback = cb;
          }
          return () => {};
        });

        const onCargarSuscripciones = vi
          .fn()
          .mockReturnValueOnce(promesaA) // Petición inicial A
          .mockReturnValueOnce(promesaB); // Petición posterior B (por foco tras crear)

        render(
          <HomeScreen
            navigation={{ addListener: addListenerMock } as any}
            onCargarSuscripciones={onCargarSuscripciones}
          />
        );

        // A está pendiente. El usuario crea y al volver a foco se dispara B:
        await act(async () => {
          focusCallback?.();
        });

        expect(onCargarSuscripciones).toHaveBeenCalledTimes(2);

        const suscripcionNueva: Suscripcion = {
          id: 'sub-b',
          nombre: 'Disney Plus B',
          monto: 7990,
          moneda: 'CLP',
          frecuencia: 'mensual',
          fecha_proximo_cobro: '2026-11-20',
          categoria: 'streaming',
          estado: 'activo',
        };

        // B resuelve primero con la nueva suscripción
        await act(async () => {
          resolverB([suscripcionNueva]);
        });

        expect(await screen.findByText('Disney Plus B')).toBeTruthy();
        expect(screen.getAllByText(/7\.990/).length).toBeGreaterThanOrEqual(1);

        // A termina después con la instantánea vieja (sin la suscripción nueva)
        await act(async () => {
          resolverA(MOCK_SUSCRIPCIONES);
        });

        // La pantalla debe conservar los datos de B y no revertir a la lista vieja de A
        expect(screen.getByText('Disney Plus B')).toBeTruthy();
        expect(screen.queryByText('Netflix')).toBeNull();
        expect(screen.getAllByText(/7\.990/).length).toBeGreaterThanOrEqual(1);
      });

      it('ignora rechazo tardío de A si B ya resolvió con éxito y no muestra estado de error', async () => {
        let rechazarA: (err: unknown) => void = () => {};
        let resolverB: (val: Suscripcion[]) => void = () => {};

        const promesaA = new Promise<Suscripcion[]>((_, rej) => {
          rechazarA = rej;
        });
        const promesaB = new Promise<Suscripcion[]>((res) => {
          resolverB = res;
        });

        let focusCallback: (() => void) | undefined;
        const addListenerMock = vi.fn().mockImplementation((event, cb) => {
          if (event === 'focus') {
            focusCallback = cb;
          }
          return () => {};
        });

        const onCargarSuscripciones = vi
          .fn()
          .mockReturnValueOnce(promesaA)
          .mockReturnValueOnce(promesaB);

        render(
          <HomeScreen
            navigation={{ addListener: addListenerMock } as any}
            onCargarSuscripciones={onCargarSuscripciones}
          />
        );

        await act(async () => {
          focusCallback?.();
        });

        const suscripcionValida: Suscripcion = {
          id: 'sub-ok',
          nombre: 'Spotify OK',
          monto: 4990,
          moneda: 'CLP',
          frecuencia: 'mensual',
          fecha_proximo_cobro: '2026-11-20',
          categoria: 'musica',
          estado: 'activo',
        };

        // B resuelve con éxito
        await act(async () => {
          resolverB([suscripcionValida]);
        });

        expect(await screen.findByText('Spotify OK')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();

        // A falla más tarde con error de red
        await act(async () => {
          rechazarA(new Error('Network error tardío'));
        });

        // No debe pisar los datos con error
        expect(screen.getByText('Spotify OK')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
      });

      it('invalida peticiones en curso al desmontar el componente', async () => {
        let resolverA: (val: Suscripcion[]) => void = () => {};
        const promesaA = new Promise<Suscripcion[]>((res) => {
          resolverA = res;
        });

        const onCargarSuscripciones = vi.fn().mockReturnValueOnce(promesaA);

        const { unmount } = render(
          <HomeScreen onCargarSuscripciones={onCargarSuscripciones} />
        );

        // Desmontar mientras A está pendiente
        unmount();

        // Resolver A tras el desmontaje no debe generar errores ni actualizaciones no deseadas
        await act(async () => {
          resolverA(MOCK_SUSCRIPCIONES);
        });

        expect(screen.queryByTestId('screen-home')).toBeNull();
      });

      it('invalida peticiones anteriores al cambiar de usuario o sesión', async () => {
        let resolverUser1: (val: Suscripcion[]) => void = () => {};
        let resolverUser2: (val: Suscripcion[]) => void = () => {};

        const promesa1 = new Promise<Suscripcion[]>((res) => {
          resolverUser1 = res;
        });
        const promesa2 = new Promise<Suscripcion[]>((res) => {
          resolverUser2 = res;
        });

        const onCargarSuscripciones = vi
          .fn()
          .mockReturnValueOnce(promesa1)
          .mockReturnValueOnce(promesa2);

        const { rerender } = render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarSuscripciones={onCargarSuscripciones}
          />
        );

        // Cambiar de usuario antes de que resuelva promesa1
        const usuario2: Usuario = { ...MOCK_USUARIO, id: 'usr-2', nombre: 'Ana López' };

        rerender(
          <HomeScreen
            usuario={usuario2}
            onCargarSuscripciones={onCargarSuscripciones}
          />
        );

        // El cambio de usuario invalida la petición anterior y dispara la nueva carga
        expect(onCargarSuscripciones).toHaveBeenCalledTimes(2);

        // Usuario 2 resuelve con sus datos
        await act(async () => {
          resolverUser2([{
            id: 'sub-ana',
            nombre: 'Ana Service',
            monto: 12000,
            moneda: 'CLP',
            frecuencia: 'mensual',
            fecha_proximo_cobro: '2026-11-30',
            categoria: 'otros',
            estado: 'activo',
          }]);
        });

        expect(await screen.findByText('Ana Service')).toBeTruthy();

        // Llega tarde la respuesta del usuario 1
        await act(async () => {
          resolverUser1(MOCK_SUSCRIPCIONES);
        });

        // Se mantienen los datos de Ana y no los de User 1
        expect(screen.getByText('Ana Service')).toBeTruthy();
        expect(screen.queryByText('Netflix')).toBeNull();
      });
    });
  });

  describe('Conectar listado móvil paginado (SE-19)', () => {
    describe('Función pura deduplicarSuscripciones', () => {
      it('conserva el orden y elimina cualquier elemento de nuevas cuyo id ya esté en acumuladas', () => {
        const acumuladas: Suscripcion[] = [MOCK_SUSCRIPCIONES[0], MOCK_SUSCRIPCIONES[1]];
        const nuevasConDuplicado: Suscripcion[] = [
          MOCK_SUSCRIPCIONES[1], // Spotify repetido
          MOCK_SUSCRIPCIONES[2], // Gimnasio nuevo
        ];

        const resultado = deduplicarSuscripciones(acumuladas, nuevasConDuplicado);
        expect(resultado).toHaveLength(3);
        expect(resultado.map((s) => s.id)).toEqual(['1', '2', '3']);
      });

      it('concatena todas si no hay IDs repetidos', () => {
        const acumuladas = [MOCK_SUSCRIPCIONES[0]];
        const nuevas = [MOCK_SUSCRIPCIONES[1], MOCK_SUSCRIPCIONES[2]];
        const resultado = deduplicarSuscripciones(acumuladas, nuevas);
        expect(resultado).toHaveLength(3);
        expect(resultado.map((s) => s.id)).toEqual(['1', '2', '3']);
      });

      it('maneja listas vacías correctamente', () => {
        expect(deduplicarSuscripciones([], [MOCK_SUSCRIPCIONES[0]])).toHaveLength(1);
        expect(deduplicarSuscripciones([MOCK_SUSCRIPCIONES[0]], [])).toHaveLength(1);
      });
    });

    describe('HomeView - Controles de paginación', () => {
      it('renderiza botón "Cargar más" y contador cuando hayMás es true', () => {
        const onCargarMas = vi.fn();

        render(
          <HomeView
            estado={{ tipo: 'listo', datos: [MOCK_SUSCRIPCIONES[0], MOCK_SUSCRIPCIONES[1]] }}
            usuario={MOCK_USUARIO}
            onSuscripcionPress={vi.fn()}
            onNuevaSuscripcion={vi.fn()}
            onReintentar={vi.fn()}
            hayMas={true}
            totalGeneral={5}
            onCargarMas={onCargarMas}
          />
        );

        const btnCargarMas = screen.getByTestId('btn-cargar-mas');
        expect(btnCargarMas).toBeTruthy();
        expect(screen.getByText('Cargar más')).toBeTruthy();
        expect(screen.getByTestId('contador-paginacion')).toBeTruthy();
        expect(screen.getByText('Mostrando 2 de 5')).toBeTruthy();

        fireEvent.click(btnCargarMas);
        expect(onCargarMas).toHaveBeenCalledTimes(1);
      });

      it('muestra estado de carga en el botón y lo deshabilita cuando cargandoMas es true', () => {
        render(
          <HomeView
            estado={{ tipo: 'listo', datos: [MOCK_SUSCRIPCIONES[0]] }}
            usuario={MOCK_USUARIO}
            onSuscripcionPress={vi.fn()}
            onNuevaSuscripcion={vi.fn()}
            onReintentar={vi.fn()}
            hayMas={true}
            cargandoMas={true}
            onCargarMas={vi.fn()}
          />
        );

        expect(screen.getByText('Cargando más...')).toBeTruthy();
      });

      it('oculta el botón "Cargar más" cuando hayMas es false', () => {
        render(
          <HomeView
            estado={{ tipo: 'listo', datos: [MOCK_SUSCRIPCIONES[0]] }}
            usuario={MOCK_USUARIO}
            onSuscripcionPress={vi.fn()}
            onNuevaSuscripcion={vi.fn()}
            onReintentar={vi.fn()}
            hayMas={false}
          />
        );

        expect(screen.queryByTestId('btn-cargar-mas')).toBeNull();
      });
    });

    describe('HomeScreen - Integración de paginación real', () => {
      it('consume la página 1 inicialmente mediante onCargarPagina', async () => {
        const onCargarPagina = vi.fn().mockResolvedValue({
          count: 3,
          next: 'http://api.local/suscripciones/?page=2',
          previous: null,
          results: [MOCK_SUSCRIPCIONES[0]],
        } satisfies SuscripcionesPaginadas);

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        expect(await screen.findByText('Netflix')).toBeTruthy();
        expect(onCargarPagina).toHaveBeenCalledWith({}, 1);
        expect(screen.getByTestId('btn-cargar-mas')).toBeTruthy();
        expect(screen.getByText('Mostrando 1 de 3')).toBeTruthy();
      });

      it('Criterio 1 SE-19: más de una página muestra cada suscripción una sola vez (deduplicación entre páginas)', async () => {
        const pag1: SuscripcionesPaginadas = {
          count: 3,
          next: 'http://api.local/suscripciones/?page=2',
          previous: null,
          results: [MOCK_SUSCRIPCIONES[0], MOCK_SUSCRIPCIONES[1]], // Netflix (id: 1), Spotify (id: 2)
        };

        const pag2: SuscripcionesPaginadas = {
          count: 3,
          next: null,
          previous: 'http://api.local/suscripciones/?page=1',
          results: [MOCK_SUSCRIPCIONES[1], MOCK_SUSCRIPCIONES[2]], // Spotify (id: 2 - duplicado por inserción concurrente), Gimnasio (id: 3)
        };

        const onCargarPagina = vi
          .fn()
          .mockResolvedValueOnce(pag1)
          .mockResolvedValueOnce(pag2);

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        // Esperar página 1
        expect(await screen.findByText('Netflix')).toBeTruthy();
        expect(screen.getByText('Spotify')).toBeTruthy();
        expect(screen.queryByText('Gimnasio')).toBeNull();

        const btnCargarMas = screen.getByTestId('btn-cargar-mas');
        await act(async () => {
          fireEvent.click(btnCargarMas);
        });

        // Esperar página 2 agregada
        expect(await screen.findByText('Gimnasio')).toBeTruthy();
        expect(onCargarPagina).toHaveBeenCalledWith({}, 2);

        // Spotify estaba en ambas páginas pero sólo debe aparecer UNA vez en la lista
        expect(screen.getAllByText('Spotify')).toHaveLength(1);
        expect(screen.getAllByText('Netflix')).toHaveLength(1);
        expect(screen.getAllByText('Gimnasio')).toHaveLength(1);

        // Al finalizar las páginas (next === null), desaparece el botón de cargar más
        expect(screen.queryByTestId('btn-cargar-mas')).toBeNull();
      });

      it('recarga desde página 1 al ejecutar refresh de la lista', async () => {
        const pag1: SuscripcionesPaginadas = {
          count: 1,
          next: null,
          previous: null,
          results: [MOCK_SUSCRIPCIONES[0]],
        };
        const pagRefrescada: SuscripcionesPaginadas = {
          count: 2,
          next: null,
          previous: null,
          results: [MOCK_SUSCRIPCIONES[0], MOCK_SUSCRIPCIONES[1]],
        };

        const onCargarPagina = vi
          .fn()
          .mockResolvedValueOnce(pag1)
          .mockResolvedValueOnce(pagRefrescada);

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        expect(await screen.findByText('Netflix')).toBeTruthy();
        expect(screen.queryByText('Spotify')).toBeNull();

        const btnRefresh = screen.getByTestId('flatlist-refresh-button');
        await act(async () => {
          fireEvent.click(btnRefresh);
        });

        expect(await screen.findByText('Spotify')).toBeTruthy();
        expect(onCargarPagina).toHaveBeenLastCalledWith({}, 1);
      });

      it('falla al cargar página siguiente no corrompe la lista previa', async () => {
        const pag1: SuscripcionesPaginadas = {
          count: 3,
          next: 'http://api.local/suscripciones/?page=2',
          previous: null,
          results: [MOCK_SUSCRIPCIONES[0]],
        };

        const onCargarPagina = vi
          .fn()
          .mockResolvedValueOnce(pag1)
          .mockRejectedValueOnce(new Error('Fallo de red en página 2'));

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        expect(await screen.findByText('Netflix')).toBeTruthy();

        const btnCargarMas = screen.getByTestId('btn-cargar-mas');
        await act(async () => {
          fireEvent.click(btnCargarMas);
        });

        // La lista no se cae ni se borra la página 1
        expect(screen.getByText('Netflix')).toBeTruthy();
      });
    });
  });

  describe('Aplicar filtros móviles por estado y fecha (SE-27)', () => {
    describe('FiltrosSuscripcionesMovil y describirCriterioActivo', () => {
      it('describirCriterioActivo genera texto conciso para accesibilidad', () => {
        expect(describirCriterioActivo('todas', '')).toBe('');
        expect(describirCriterioActivo('activo', '')).toBe(
          'Filtro activo: Estado: Activas'
        );
        expect(describirCriterioActivo('fantasma', '2026-10-05')).toBe(
          'Filtro activo: Estado: Sin uso · Cobro: 2026-10-05'
        );
        expect(describirCriterioActivo('todas', '2026-10-05')).toBe(
          'Filtro activo: Cobro: 2026-10-05'
        );
      });

      it('renderiza chips de estado y dispara callbacks al seleccionarlos', () => {
        const onCambiarEstado = vi.fn();
        const onCambiarFecha = vi.fn();
        const onLimpiarFiltros = vi.fn();

        render(
          <FiltrosSuscripcionesMovil
            filtroEstado="todas"
            filtroFecha=""
            onCambiarEstado={onCambiarEstado}
            onCambiarFecha={onCambiarFecha}
            onLimpiarFiltros={onLimpiarFiltros}
            hayFiltrosActivos={false}
          />
        );

        expect(screen.getByTestId('filtros-suscripciones')).toBeTruthy();
        expect(screen.getByTestId('filtro-estado-todas')).toBeTruthy();
        expect(screen.getByTestId('filtro-estado-activo')).toBeTruthy();
        expect(screen.getByTestId('filtro-estado-fantasma')).toBeTruthy();
        expect(screen.getByTestId('filtro-estado-prueba')).toBeTruthy();
        expect(screen.getByTestId('filtro-estado-por_confirmar')).toBeTruthy();
        expect(screen.getByTestId('filtro-estado-cancelado')).toBeTruthy();
        expect(screen.queryByTestId('btn-limpiar-filtros')).toBeNull();

        fireEvent.click(screen.getByTestId('filtro-estado-activo'));
        expect(onCambiarEstado).toHaveBeenCalledWith('activo');

        const inputFecha = screen.getByTestId('input-filtro-fecha');
        fireEvent.change(inputFecha, { target: { value: '2026-10-05' } });
        expect(onCambiarFecha).toHaveBeenCalledWith('2026-10-05');
      });

      it('muestra botón de limpiar filtros cuando hay filtros activos y dispara callback', () => {
        const onLimpiarFiltros = vi.fn();

        render(
          <FiltrosSuscripcionesMovil
            filtroEstado="activo"
            filtroFecha="2026-10-05"
            onCambiarEstado={vi.fn()}
            onCambiarFecha={vi.fn()}
            onLimpiarFiltros={onLimpiarFiltros}
            hayFiltrosActivos={true}
          />
        );

        const btnLimpiar = screen.getByTestId('btn-limpiar-filtros');
        expect(btnLimpiar).toBeTruthy();
        fireEvent.click(btnLimpiar);
        expect(onLimpiarFiltros).toHaveBeenCalledTimes(1);
      });
    });

    describe('HomeScreen - Criterio 1: Combinación filtra en servidor', () => {
      it('filtra por estado en servidor al seleccionar un chip', async () => {
        const onCargarPagina = vi.fn().mockResolvedValue({
          count: 1,
          next: null,
          previous: null,
          results: [MOCK_SUSCRIPCIONES[0]], // Netflix activo
        } satisfies SuscripcionesPaginadas);

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        expect(await screen.findByText('Netflix')).toBeTruthy();
        expect(onCargarPagina).toHaveBeenCalledWith({}, 1);

        const chipActivo = screen.getByTestId('filtro-estado-activo');
        await act(async () => {
          fireEvent.click(chipActivo);
        });

        expect(onCargarPagina).toHaveBeenLastCalledWith({ estado: 'activo' }, 1);
      });

      it('filtra por fecha en servidor y combina con estado', async () => {
        const onCargarPagina = vi.fn().mockResolvedValue({
          count: 1,
          next: null,
          previous: null,
          results: [MOCK_SUSCRIPCIONES[0]],
        } satisfies SuscripcionesPaginadas);

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        expect(await screen.findByText('Netflix')).toBeTruthy();

        // 1. Aplicar estado activo
        await act(async () => {
          fireEvent.click(screen.getByTestId('filtro-estado-activo'));
        });
        expect(onCargarPagina).toHaveBeenLastCalledWith({ estado: 'activo' }, 1);

        // 2. Aplicar fecha válida YYYY-MM-DD
        const inputFecha = screen.getByTestId('input-filtro-fecha');
        await act(async () => {
          fireEvent.change(inputFecha, { target: { value: '2026-10-05' } });
        });

        expect(onCargarPagina).toHaveBeenLastCalledWith(
          { estado: 'activo', fecha_cobro: '2026-10-05' },
          1
        );
      });

      it('ignora fechas inválidas en la petición al servidor', async () => {
        const onCargarPagina = vi.fn().mockResolvedValue({
          count: 1,
          next: null,
          previous: null,
          results: [MOCK_SUSCRIPCIONES[0]],
        } satisfies SuscripcionesPaginadas);

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        expect(await screen.findByText('Netflix')).toBeTruthy();

        const inputFecha = screen.getByTestId('input-filtro-fecha');
        // Fecha inválida de mes 13 o texto incompleto
        await act(async () => {
          fireEvent.change(inputFecha, { target: { value: '2026-13-40' } });
        });

        // Al no ser fecha real, no envía fecha_cobro
        expect(onCargarPagina).toHaveBeenLastCalledWith({}, 1);
      });
    });

    describe('HomeScreen - Criterio 2: No deja resultados de la consulta anterior y maneja carreras', () => {
      it('cambiar filtro pasa de inmediato a cargando y oculta los datos previos', async () => {
        let resolverFiltro: (val: SuscripcionesPaginadas) => void = () => {};
        const promesaFiltro = new Promise<SuscripcionesPaginadas>((res) => {
          resolverFiltro = res;
        });

        const onCargarPagina = vi
          .fn()
          .mockResolvedValueOnce({
            count: 1,
            next: null,
            previous: null,
            results: [MOCK_SUSCRIPCIONES[0]], // Netflix
          } satisfies SuscripcionesPaginadas)
          .mockReturnValueOnce(promesaFiltro);

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        // Vista inicial lista con Netflix
        expect(await screen.findByText('Netflix')).toBeTruthy();

        // Cambiar filtro a fantasma
        await act(async () => {
          fireEvent.click(screen.getByTestId('filtro-estado-fantasma'));
        });

        // Inmediatamente muestra cargando (progressbar) y Netflix ya no está visible
        expect(screen.getByRole('progressbar')).toBeTruthy();
        expect(screen.queryByText('Netflix')).toBeNull();

        // Resolver la promesa de fantasma
        await act(async () => {
          resolverFiltro({
            count: 1,
            next: null,
            previous: null,
            results: [MOCK_SUSCRIPCIONES[2]], // Gimnasio
          });
        });

        // Aparece Gimnasio y desaparece el cargando
        expect(await screen.findByText('Gimnasio')).toBeTruthy();
        expect(screen.queryByRole('progressbar')).toBeNull();
      });

      it('ignora respuesta lenta de filtro A si filtro B resolvió primero', async () => {
        let resolverA: (val: SuscripcionesPaginadas) => void = () => {};
        let resolverB: (val: SuscripcionesPaginadas) => void = () => {};

        const promesaA = new Promise<SuscripcionesPaginadas>((res) => {
          resolverA = res;
        });
        const promesaB = new Promise<SuscripcionesPaginadas>((res) => {
          resolverB = res;
        });

        const onCargarPagina = vi
          .fn()
          .mockResolvedValueOnce({
            count: 1,
            next: null,
            previous: null,
            results: [MOCK_SUSCRIPCIONES[0]],
          } satisfies SuscripcionesPaginadas) // inicial
          .mockReturnValueOnce(promesaA) // Filtro A (activo)
          .mockReturnValueOnce(promesaB); // Filtro B (fantasma)

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        expect(await screen.findByText('Netflix')).toBeTruthy();

        // Disparar Filtro A
        await act(async () => {
          fireEvent.click(screen.getByTestId('filtro-estado-activo'));
        });

        // Inmediatamente disparar Filtro B
        await act(async () => {
          fireEvent.click(screen.getByTestId('filtro-estado-fantasma'));
        });

        // B resuelve primero con Gimnasio
        await act(async () => {
          resolverB({
            count: 1,
            next: null,
            previous: null,
            results: [MOCK_SUSCRIPCIONES[2]], // Gimnasio
          });
        });

        expect(await screen.findByText('Gimnasio')).toBeTruthy();

        // Llega tarde A con Netflix
        await act(async () => {
          resolverA({
            count: 1,
            next: null,
            previous: null,
            results: [MOCK_SUSCRIPCIONES[0]], // Netflix
          });
        });

        // Se mantiene Gimnasio y no se mezcla Netflix
        expect(screen.getByText('Gimnasio')).toBeTruthy();
        expect(screen.queryByText('Netflix')).toBeNull();
      });
    });

    describe('HomeScreen - Reinicio de paginación y limpiar filtros', () => {
      it('reinicia a página 1 al cambiar de filtro cuando se estaba en una página posterior', async () => {
        const pag1: SuscripcionesPaginadas = {
          count: 5,
          next: 'http://api.local/suscripciones/?page=2',
          previous: null,
          results: [MOCK_SUSCRIPCIONES[0]],
        };
        const pag2: SuscripcionesPaginadas = {
          count: 5,
          next: null,
          previous: 'http://api.local/suscripciones/?page=1',
          results: [MOCK_SUSCRIPCIONES[1]],
        };
        const pagFiltro: SuscripcionesPaginadas = {
          count: 1,
          next: null,
          previous: null,
          results: [MOCK_SUSCRIPCIONES[2]],
        };

        const onCargarPagina = vi
          .fn()
          .mockResolvedValueOnce(pag1)
          .mockResolvedValueOnce(pag2)
          .mockResolvedValueOnce(pagFiltro);

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        expect(await screen.findByText('Netflix')).toBeTruthy();

        // Ir a página 2
        await act(async () => {
          fireEvent.click(screen.getByTestId('btn-cargar-mas'));
        });
        expect(await screen.findByText('Spotify')).toBeTruthy();
        expect(onCargarPagina).toHaveBeenLastCalledWith({}, 2);

        // Ahora cambiar filtro a fantasma
        await act(async () => {
          fireEvent.click(screen.getByTestId('filtro-estado-fantasma'));
        });

        // Debe solicitar página 1, NO página 2
        expect(onCargarPagina).toHaveBeenLastCalledWith({ estado: 'fantasma' }, 1);
        expect(await screen.findByText('Gimnasio')).toBeTruthy();
      });

      it('limpiar filtros restablece estado a "todas", borra fecha y solicita página 1 sin filtros', async () => {
        const onCargarPagina = vi.fn().mockResolvedValue({
          count: 3,
          next: null,
          previous: null,
          results: MOCK_SUSCRIPCIONES,
        } satisfies SuscripcionesPaginadas);

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        expect(await screen.findByText('Netflix')).toBeTruthy();

        // Aplicar filtro
        await act(async () => {
          fireEvent.click(screen.getByTestId('filtro-estado-activo'));
        });
        expect(onCargarPagina).toHaveBeenLastCalledWith({ estado: 'activo' }, 1);

        // Limpiar filtros con botón
        const btnLimpiar = screen.getByTestId('btn-limpiar-filtros');
        await act(async () => {
          fireEvent.click(btnLimpiar);
        });

        // Debe haber solicitado nuevamente sin filtros
        expect(onCargarPagina).toHaveBeenLastCalledWith({}, 1);
      });

      it('distingue cuenta vacía de búsqueda sin coincidencias según filtros activos', async () => {
        const onCargarPagina = vi
          .fn()
          .mockResolvedValueOnce({
            count: 1,
            next: null,
            previous: null,
            results: [MOCK_SUSCRIPCIONES[0]],
          } satisfies SuscripcionesPaginadas)
          .mockResolvedValueOnce({
            count: 0,
            next: null,
            previous: null,
            results: [],
          } satisfies SuscripcionesPaginadas)
          .mockResolvedValueOnce({
            count: 1,
            next: null,
            previous: null,
            results: [MOCK_SUSCRIPCIONES[0]],
          } satisfies SuscripcionesPaginadas);

        render(
          <HomeScreen
            usuario={MOCK_USUARIO}
            onCargarPagina={onCargarPagina}
          />
        );

        expect(await screen.findByText('Netflix')).toBeTruthy();

        // Aplicar filtro que no tiene coincidencias
        await act(async () => {
          fireEvent.click(screen.getByTestId('filtro-estado-cancelado'));
        });

        // Muestra estado vacío de filtros, no el estado vacío de bienvenida de la cuenta
        expect(await screen.findByTestId('empty-state-filtros')).toBeTruthy();
        expect(screen.queryByTestId('empty-state-home')).toBeNull();
        expect(screen.getByText('Ninguna suscripción coincide')).toBeTruthy();
        expect(screen.getAllByText(/Filtro activo: Estado: Canceladas/).length).toBeGreaterThan(0);

        // El botón para limpiar filtros desde el estado vacío limpia los filtros y recarga
        const btnLimpiarVacio = screen.getByTestId('btn-limpiar-filtros-vacio');
        await act(async () => {
          fireEvent.click(btnLimpiarVacio);
        });

        expect(await screen.findByText('Netflix')).toBeTruthy();
        expect(screen.queryByTestId('empty-state-filtros')).toBeNull();
      });
    });
  });
});

