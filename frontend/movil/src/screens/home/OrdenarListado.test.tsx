// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import HomeScreen, { HomeView } from './HomeScreen';
import {
  FiltrosSuscripcionesMovil,
  describirCriterioActivo,
  OPCIONES_ORDEN,
} from './FiltrosSuscripcionesMovil';
import type {
  OrdenSuscripciones,
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

const MOCK_PAGE_1: Suscripcion[] = [
  {
    id: 'sub-gym',
    nombre: 'Gimnasio',
    monto: 30000,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-10-01',
    categoria: 'salud',
    estado: 'activo',
    horas_uso_mes: 10,
  },
  {
    id: 'sub-netflix',
    nombre: 'Netflix',
    monto: 15000,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-10-05',
    categoria: 'streaming',
    estado: 'activo',
    horas_uso_mes: 20,
  },
];

const MOCK_PAGE_2: Suscripcion[] = [
  {
    id: 'sub-spotify',
    nombre: 'Spotify',
    monto: 5000,
    moneda: 'CLP',
    frecuencia: 'mensual',
    fecha_proximo_cobro: '2026-10-10',
    categoria: 'musica',
    estado: 'activo',
    horas_uso_mes: 35,
  },
];

describe('SE-29 — Ordenar listado móvil y mostrar criterio', () => {
  describe('FiltrosSuscripcionesMovil y describirCriterioActivo', () => {
    it('describirCriterioActivo genera texto conciso para accesibilidad con orden activo', () => {
      // Sin criterio activo
      expect(describirCriterioActivo('todas', '')).toBe('');
      expect(describirCriterioActivo('todas', '', undefined)).toBe('');

      // Solo orden
      expect(describirCriterioActivo('todas', '', 'monto')).toBe(
        'Filtro activo: Orden: Monto: de menor a mayor'
      );
      expect(describirCriterioActivo('todas', '', '-monto')).toBe(
        'Filtro activo: Orden: Monto: de mayor a menor'
      );
      expect(describirCriterioActivo('todas', '', 'nombre')).toBe(
        'Filtro activo: Orden: Nombre: de la A a la Z'
      );
      expect(describirCriterioActivo('todas', '', '-nombre')).toBe(
        'Filtro activo: Orden: Nombre: de la Z a la A'
      );
      expect(describirCriterioActivo('todas', '', 'fecha_proximo_cobro')).toBe(
        'Filtro activo: Orden: Próximo cobro: más cercano primero'
      );
      expect(describirCriterioActivo('todas', '', '-fecha_proximo_cobro')).toBe(
        'Filtro activo: Orden: Próximo cobro: más lejano primero'
      );

      // Combinado con filtros de estado y fecha
      expect(describirCriterioActivo('activo', '2026-10-05', '-monto')).toBe(
        'Filtro activo: Estado: Activas · Cobro: 2026-10-05 · Orden: Monto: de mayor a menor'
      );
      expect(describirCriterioActivo('fantasma', '', 'nombre')).toBe(
        'Filtro activo: Estado: Sin uso · Orden: Nombre: de la A a la Z'
      );
    });

    it('renderiza selector de orden con los 6 chips requeridos y dispara callbacks al seleccionarlos', () => {
      const onCambiarOrden = vi.fn();

      render(
        <FiltrosSuscripcionesMovil
          filtroEstado="todas"
          filtroFecha=""
          orden={undefined}
          onCambiarEstado={vi.fn()}
          onCambiarFecha={vi.fn()}
          onCambiarOrden={onCambiarOrden}
          onLimpiarFiltros={vi.fn()}
          hayFiltrosActivos={false}
        />
      );

      expect(screen.getByTestId('seccion-orden')).toBeTruthy();
      expect(screen.getByTestId('orden-chips-scroll')).toBeTruthy();

      // Verificar existencia de las 6 opciones
      for (const opcion of OPCIONES_ORDEN) {
        const chip = screen.getByTestId(`orden-chip-${opcion.valor}`);
        expect(chip).toBeTruthy();
        expect(chip.getAttribute('aria-pressed')).toBe('false');
      }

      // Indicador de orden muestra predeterminado si orden es undefined
      const indicador = screen.getByTestId('indicador-orden-activo');
      expect(indicador.textContent).toContain('Predeterminado: Próximo cobro (más cercano)');

      // Simular selección de chip de monto descendente
      fireEvent.click(screen.getByTestId('orden-chip--monto'));
      expect(onCambiarOrden).toHaveBeenCalledWith('-monto');
    });

    it('marca accesibilidad aria-pressed=true y texto de criterio en el chip y banner activo', () => {
      render(
        <FiltrosSuscripcionesMovil
          filtroEstado="todas"
          filtroFecha=""
          orden="monto"
          onCambiarEstado={vi.fn()}
          onCambiarFecha={vi.fn()}
          onCambiarOrden={vi.fn()}
          onLimpiarFiltros={vi.fn()}
          hayFiltrosActivos={true}
        />
      );

      const chipMonto = screen.getByTestId('orden-chip-monto');
      expect(chipMonto.getAttribute('aria-pressed')).toBe('true');
      expect(chipMonto.getAttribute('aria-label')).toContain('(activo)');

      const indicador = screen.getByTestId('indicador-orden-activo');
      expect(indicador.textContent).toContain('Activo: Monto: de menor a mayor');
    });
  });

  describe('Criterio 1: El orden cruza páginas correctamente y mantiene filtros', () => {
    it('solicita la primera página con orden y mantiene filtros activos', async () => {
      const onCargarPagina = vi.fn().mockResolvedValue({
        count: 3,
        next: 'http://test/api/suscripciones/?page=2',
        previous: null,
        results: MOCK_PAGE_1,
      } satisfies SuscripcionesPaginadas);

      render(
        <HomeScreen
          usuario={MOCK_USUARIO}
          onCargarPagina={onCargarPagina}
        />
      );

      // Carga inicial sin filtros, envía orden predeterminado 'fecha_proximo_cobro'
      expect(await screen.findByText('Gimnasio')).toBeTruthy();
      expect(onCargarPagina).toHaveBeenCalledWith({ orden: 'fecha_proximo_cobro' }, 1);

      // Activar filtro de estado 'activo'
      await act(async () => {
        fireEvent.click(screen.getByTestId('filtro-estado-activo'));
      });
      expect(onCargarPagina).toHaveBeenLastCalledWith(
        { estado: 'activo', orden: 'fecha_proximo_cobro' },
        1
      );

      // Seleccionar orden por monto descendente (-monto)
      await act(async () => {
        fireEvent.click(screen.getByTestId('orden-chip--monto'));
      });

      // Debe solicitar con filtro de estado activo Y orden por servidor
      expect(onCargarPagina).toHaveBeenLastCalledWith(
        { estado: 'activo', orden: '-monto' },
        1
      );
    });

    it('al pulsar "Cargar más" la página 2 incluye el mismo orden y filtros por servidor', async () => {
      const onCargarPagina = vi.fn()
        .mockResolvedValueOnce({
          count: 3,
          next: 'http://test/api/suscripciones/?page=2',
          previous: null,
          results: MOCK_PAGE_1, // Gimnasio (30000), Netflix (15000)
        } satisfies SuscripcionesPaginadas)
        .mockResolvedValueOnce({
          count: 3,
          next: null,
          previous: 'http://test/api/suscripciones/?page=1',
          results: MOCK_PAGE_2, // Spotify (5000)
        } satisfies SuscripcionesPaginadas);

      render(
        <HomeScreen
          usuario={MOCK_USUARIO}
          onCargarPagina={onCargarPagina}
          orden="-monto"
        />
      );

      // Página 1 inicial solicitada con orden
      expect(await screen.findByText('Gimnasio')).toBeTruthy();
      expect(screen.getByText('Netflix')).toBeTruthy();
      expect(onCargarPagina).toHaveBeenCalledWith({ orden: '-monto' }, 1);

      // Botón cargar más disponible y contador de página 1
      const btnCargarMas = screen.getByTestId('btn-cargar-mas');
      expect(btnCargarMas).toBeTruthy();
      expect(screen.getByTestId('contador-paginacion').textContent).toContain('Mostrando 2 de 3');

      // Cargar página 2
      await act(async () => {
        fireEvent.click(btnCargarMas);
      });

      // La llamada a página 2 DEBE mantener el orden
      expect(onCargarPagina).toHaveBeenCalledWith({ orden: '-monto' }, 2);

      // Suscripciones de ambas páginas coexisten ordenadas por servidor
      expect(await screen.findByText('Spotify')).toBeTruthy();
      expect(screen.getByText('Gimnasio')).toBeTruthy();
      expect(screen.getByText('Netflix')).toBeTruthy();
      expect(screen.queryByTestId('btn-cargar-mas')).toBeNull();
      expect(screen.getByTestId('resumen-subtitulo').textContent).toContain('3');
    });

    it('cambiar de orden en página 2 reinicia a página 1 y cancela la anterior', async () => {
      const onCargarPagina = vi.fn()
        .mockResolvedValueOnce({
          count: 3,
          next: 'http://test/api/suscripciones/?page=2',
          previous: null,
          results: MOCK_PAGE_1,
        } satisfies SuscripcionesPaginadas)
        .mockResolvedValueOnce({
          count: 3,
          next: null,
          previous: 'http://test/api/suscripciones/?page=1',
          results: MOCK_PAGE_2,
        } satisfies SuscripcionesPaginadas)
        .mockResolvedValueOnce({
          count: 3,
          next: null,
          previous: null,
          results: [MOCK_PAGE_1[0]],
        } satisfies SuscripcionesPaginadas);

      render(
        <HomeScreen
          usuario={MOCK_USUARIO}
          onCargarPagina={onCargarPagina}
          orden="-monto"
        />
      );

      expect(await screen.findByText('Gimnasio')).toBeTruthy();

      // Cargar página 2
      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-cargar-mas'));
      });
      expect(await screen.findByText('Spotify')).toBeTruthy();

      // Ahora cambiar el orden a 'nombre'
      await act(async () => {
        fireEvent.click(screen.getByTestId('orden-chip-nombre'));
      });

      // Debe haber reiniciado la consulta a la página 1 con orden 'nombre'
      expect(onCargarPagina).toHaveBeenLastCalledWith({ orden: 'nombre' }, 1);
    });
  });

  describe('Criterio 2: Criterio activo es visible y accesible', () => {
    it('muestra el criterio activo en el banner accesible de FiltrosSuscripcionesMovil', async () => {
      const onCargarPagina = vi.fn().mockResolvedValue({
        count: 2,
        next: null,
        previous: null,
        results: MOCK_PAGE_1,
      } satisfies SuscripcionesPaginadas);

      render(
        <HomeScreen
          usuario={MOCK_USUARIO}
          onCargarPagina={onCargarPagina}
        />
      );

      expect(await screen.findByText('Gimnasio')).toBeTruthy();

      // Seleccionar orden por próximo cobro ascendente
      await act(async () => {
        fireEvent.click(screen.getByTestId('orden-chip-fecha_proximo_cobro'));
      });

      const indicador = screen.getByTestId('indicador-orden-activo');
      expect(indicador.textContent).toContain('Activo: Próximo cobro: más cercano primero');

      // Seleccionar orden por nombre Z-A
      await act(async () => {
        fireEvent.click(screen.getByTestId('orden-chip--nombre'));
      });
      expect(indicador.textContent).toContain('Activo: Nombre: de la Z a la A');
    });

    it('en estado vacío por filtros/orden muestra el criterio activo en la descripción', async () => {
      const onCargarPagina = vi.fn().mockResolvedValue({
        count: 0,
        next: null,
        previous: null,
        results: [],
      } satisfies SuscripcionesPaginadas);

      render(
        <HomeScreen
          usuario={MOCK_USUARIO}
          onCargarPagina={onCargarPagina}
          orden="monto"
        />
      );

      // Estado vacío con filtros/orden activos
      expect(await screen.findByTestId('empty-state-filtros')).toBeTruthy();
      expect(screen.getByText('Ninguna suscripción coincide')).toBeTruthy();
      expect(screen.getByText('Filtro activo: Orden: Monto: de menor a mayor')).toBeTruthy();

      // Botón limpiar filtros en estado vacío restablece orden
      const btnLimpiarVacio = screen.getByTestId('btn-limpiar-filtros-vacio');
      await act(async () => {
        fireEvent.click(btnLimpiarVacio);
      });

      // Debe volver a consultar página 1 con orden predeterminado
      expect(onCargarPagina).toHaveBeenLastCalledWith({ orden: 'fecha_proximo_cobro' }, 1);
    });

    it('el botón "Limpiar filtros" restablece tanto el estado como el orden seleccionado', async () => {
      const onCargarPagina = vi.fn().mockResolvedValue({
        count: 2,
        next: null,
        previous: null,
        results: MOCK_PAGE_1,
      } satisfies SuscripcionesPaginadas);

      render(
        <HomeScreen
          usuario={MOCK_USUARIO}
          onCargarPagina={onCargarPagina}
        />
      );

      expect(await screen.findByText('Gimnasio')).toBeTruthy();

      // Seleccionar orden y estado
      await act(async () => {
        fireEvent.click(screen.getByTestId('orden-chip-monto'));
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('filtro-estado-activo'));
      });

      expect(onCargarPagina).toHaveBeenLastCalledWith({ estado: 'activo', orden: 'monto' }, 1);

      // Limpiar filtros
      const btnLimpiar = screen.getByTestId('btn-limpiar-filtros');
      await act(async () => {
        fireEvent.click(btnLimpiar);
      });

      // Debe consultar con orden predeterminado tras limpiar filtros
      expect(onCargarPagina).toHaveBeenLastCalledWith({ orden: 'fecha_proximo_cobro' }, 1);
    });

    it('Regresión P2 · Envía fecha_proximo_cobro como predeterminado en montaje, siguiente página y limpieza, coincidiendo primera fila y etiqueta', async () => {
      const subCercana: Suscripcion = {
        id: 'sub-cercana',
        nombre: 'Cobro Cercano',
        monto: 10000,
        moneda: 'CLP',
        frecuencia: 'mensual',
        fecha_proximo_cobro: '2026-10-01',
        categoria: 'servicios',
        estado: 'activo',
        horas_uso_mes: 0,
      };

      const subLejana: Suscripcion = {
        id: 'sub-lejana',
        nombre: 'Cobro Lejano',
        monto: 20000,
        moneda: 'CLP',
        frecuencia: 'mensual',
        fecha_proximo_cobro: '2026-10-30',
        categoria: 'servicios',
        estado: 'activo',
        horas_uso_mes: 0,
      };

      const subPagina2: Suscripcion = {
        id: 'sub-pag2',
        nombre: 'Tercer Cobro',
        monto: 15000,
        moneda: 'CLP',
        frecuencia: 'mensual',
        fecha_proximo_cobro: '2026-11-15',
        categoria: 'servicios',
        estado: 'activo',
        horas_uso_mes: 0,
      };

      const onCargarPagina = vi.fn().mockImplementation((consulta, pagina) => {
        if (pagina === 1) {
          const results =
            consulta.orden === 'fecha_proximo_cobro'
              ? [subCercana, subLejana]
              : [subLejana, subCercana];
          return Promise.resolve({
            count: 3,
            next: 'http://test/api/suscripciones/?page=2',
            previous: null,
            results,
          } satisfies SuscripcionesPaginadas);
        }
        return Promise.resolve({
          count: 3,
          next: null,
          previous: 'http://test/api/suscripciones/?page=1',
          results: [subPagina2],
        } satisfies SuscripcionesPaginadas);
      });

      render(
        <HomeScreen
          usuario={MOCK_USUARIO}
          onCargarPagina={onCargarPagina}
        />
      );

      // 1. Montaje inicial:
      // Debe haber enviado explícitamente consulta con orden: 'fecha_proximo_cobro'
      expect(onCargarPagina).toHaveBeenCalledWith({ orden: 'fecha_proximo_cobro' }, 1);

      // La etiqueta anuncia "más cercano"
      const indicador = await screen.findByTestId('indicador-orden-activo');
      expect(indicador.textContent).toContain('más cercano');

      // La primera fila coincide con la fecha más cercana
      expect(await screen.findByText('Cobro Cercano')).toBeTruthy();
      expect(screen.getByTestId('go-detalle').textContent).toContain('Cobro Cercano');

      // 2. Siguiente página ("Cargar más"):
      const btnCargarMas = screen.getByTestId('btn-cargar-mas');
      await act(async () => {
        fireEvent.click(btnCargarMas);
      });
      // La solicitud a la siguiente página conserva orden: 'fecha_proximo_cobro'
      expect(onCargarPagina).toHaveBeenLastCalledWith({ orden: 'fecha_proximo_cobro' }, 2);
      expect(await screen.findByText('Tercer Cobro')).toBeTruthy();

      // 3. Modificar filtros/orden y luego limpiar:
      await act(async () => {
        fireEvent.click(screen.getByTestId('orden-chip--monto'));
      });
      expect(onCargarPagina).toHaveBeenLastCalledWith({ orden: '-monto' }, 1);

      const btnLimpiar = screen.getByTestId('btn-limpiar-filtros');
      await act(async () => {
        fireEvent.click(btnLimpiar);
      });

      // Tras limpiar filtros:
      // Debe volver a solicitar con orden: 'fecha_proximo_cobro' a la página 1
      expect(onCargarPagina).toHaveBeenLastCalledWith({ orden: 'fecha_proximo_cobro' }, 1);
      // La etiqueta vuelve a anunciar "más cercano"
      expect(indicador.textContent).toContain('más cercano');
      // La primera fila vuelve a ser la fecha más cercana
      expect(screen.getByTestId('go-detalle').textContent).toContain('Cobro Cercano');
    });
  });

  describe('Protección contra respuestas asíncronas y carreras de orden', () => {
    it('ignora respuesta tardía de orden A si orden B resolvió primero', async () => {
      let resolverA: (res: SuscripcionesPaginadas) => void = () => {};
      let resolverB: (res: SuscripcionesPaginadas) => void = () => {};

      const promesaA = new Promise<SuscripcionesPaginadas>((res) => {
        resolverA = res;
      });
      const promesaB = new Promise<SuscripcionesPaginadas>((res) => {
        resolverB = res;
      });

      const onCargarPagina = vi.fn()
        // Carga inicial
        .mockResolvedValueOnce({
          count: 2,
          next: null,
          previous: null,
          results: MOCK_PAGE_1,
        } satisfies SuscripcionesPaginadas)
        // Cambio a orden A (lento)
        .mockReturnValueOnce(promesaA)
        // Cambio a orden B (rápido)
        .mockReturnValueOnce(promesaB);

      render(
        <HomeScreen
          usuario={MOCK_USUARIO}
          onCargarPagina={onCargarPagina}
        />
      );

      expect(await screen.findByText('Gimnasio')).toBeTruthy();

      // Selecciona orden A
      await act(async () => {
        fireEvent.click(screen.getByTestId('orden-chip-monto'));
      });

      // Selecciona orden B de inmediato
      await act(async () => {
        fireEvent.click(screen.getByTestId('orden-chip--nombre'));
      });

      // Orden B resuelve primero con Spotify
      await act(async () => {
        resolverB({
          count: 1,
          next: null,
          previous: null,
          results: [MOCK_PAGE_2[0]], // Spotify
        });
      });

      expect(await screen.findByText('Spotify')).toBeTruthy();

      // Orden A resuelve tarde con Netflix
      await act(async () => {
        resolverA({
          count: 1,
          next: null,
          previous: null,
          results: [MOCK_PAGE_1[1]], // Netflix
        });
      });

      // Spotify de orden B DEBE prevalecer, Netflix de orden A debe ser descartado
      expect(screen.getByText('Spotify')).toBeTruthy();
      expect(screen.queryByText('Netflix')).toBeNull();
    });
  });
});
