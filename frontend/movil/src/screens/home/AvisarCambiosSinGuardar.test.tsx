import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackHandler } from 'react-native';
import SuscripcionNuevaScreen from './SuscripcionNuevaScreen';
import SuscripcionEditarScreen from './SuscripcionEditarScreen';
import type { CatalogosSuscripciones, Suscripcion } from '@ojoalgasto/shared';

const CATALOGO_MOCK: CatalogosSuscripciones = {
  monedas: [
    { codigo: 'CLP', nombre: 'Peso chileno', activo: true, orden: 1 },
    { codigo: 'USD', nombre: 'Dólar estadounidense', activo: true, orden: 2 },
  ],
  frecuencias: [
    { codigo: 'mensual', nombre: 'Mensual' },
    { codigo: 'anual', nombre: 'Anual' },
  ],
  categorias: [
    { codigo: 'streaming', nombre: 'Streaming', activo: true, orden: 1 },
    { codigo: 'musica', nombre: 'Música', activo: true, orden: 2 },
  ],
  predeterminados: {
    moneda: 'CLP',
    frecuencia: 'mensual',
    categoria: 'streaming',
  },
};

const SUSCRIPCION_MOCK: Suscripcion = {
  id: 'sub-test-1',
  nombre: 'Spotify',
  monto: 5990,
  moneda: 'CLP',
  frecuencia: 'mensual',
  categoria: 'musica',
  fecha_proximo_cobro: '2026-11-30',
  estado: 'activo',
  horas_uso_mes: 15,
};

describe('SE-31: Avisar cambios sin guardar en móvil', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Formulario de Nueva Suscripción (SuscripcionNuevaScreen)', () => {
    it('formulario limpio no interrumpe navegación al cancelar', () => {
      const goBackMock = vi.fn();
      const navigation = {
        goBack: goBackMock,
        addListener: vi.fn().mockReturnValue(() => {}),
      };

      render(
        <SuscripcionNuevaScreen
          catalogos={CATALOGO_MOCK}
          navigation={navigation as any}
        />,
      );

      // El aviso no debe estar visible inicialmente
      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();

      // Pulsar Cancelar y Volver
      fireEvent.click(screen.getByTestId('go-back'));

      // Navega de inmediato sin desplegar el modal
      expect(goBackMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();
    });

    it('formulario limpio no intercepta beforeRemove de React Navigation', () => {
      let beforeRemoveHandler: ((e: any) => void) | null = null;
      const navigation = {
        goBack: vi.fn(),
        addListener: vi.fn((event, cb) => {
          if (event === 'beforeRemove') beforeRemoveHandler = cb;
          return () => {};
        }),
      };

      render(
        <SuscripcionNuevaScreen
          catalogos={CATALOGO_MOCK}
          navigation={navigation as any}
        />,
      );

      expect(beforeRemoveHandler).toBeTruthy();

      const preventDefault = vi.fn();
      beforeRemoveHandler!({ preventDefault, data: { action: { type: 'GO_BACK' } } });

      // No previene la salida y no abre el modal
      expect(preventDefault).not.toHaveBeenCalled();
      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();
    });

    it('con cambios pendientes intercepta la salida y muestra el diálogo accesible', () => {
      const goBackMock = vi.fn();
      const navigation = {
        goBack: goBackMock,
        addListener: vi.fn().mockReturnValue(() => {}),
      };

      render(
        <SuscripcionNuevaScreen
          catalogos={CATALOGO_MOCK}
          navigation={navigation as any}
        />,
      );

      // Usuario ingresa datos
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Netflix' },
      });

      // Intenta salir
      fireEvent.click(screen.getByTestId('go-back'));

      // No se ejecuta goBack directo; se despliega el aviso accesible
      expect(goBackMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('aviso-cambios-sin-guardar')).toBeTruthy();
      expect(screen.getByTestId('titulo-aviso-cambios-sin-guardar').textContent).toBe(
        'Cambios sin guardar',
      );
      expect(screen.getByTestId('mensaje-aviso-cambios-sin-guardar').textContent).toContain(
        'Tienes cambios sin guardar. Si sales ahora, se perderán.',
      );
      expect(screen.getByTestId('btn-seguir-editando')).toBeTruthy();
      expect(screen.getByTestId('btn-descartar-cambios')).toBeTruthy();
    });

    it('pulsar "Seguir editando" cierra el diálogo y conserva los datos ingresados', () => {
      const goBackMock = vi.fn();
      const navigation = {
        goBack: goBackMock,
        addListener: vi.fn().mockReturnValue(() => {}),
      };

      render(
        <SuscripcionNuevaScreen
          catalogos={CATALOGO_MOCK}
          navigation={navigation as any}
        />,
      );

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Prime Video' },
      });
      fireEvent.click(screen.getByTestId('go-back'));

      expect(screen.getByTestId('aviso-cambios-sin-guardar')).toBeTruthy();

      // Elegir seguir editando
      fireEvent.click(screen.getByTestId('btn-seguir-editando'));

      // El aviso desaparece, no se navega y los datos siguen presentes
      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();
      expect(goBackMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('input-nombre')).toHaveProperty('value', 'Prime Video');
    });

    it('pulsar "Descartar cambios" cierra el diálogo y concreta la salida', () => {
      const goBackMock = vi.fn();
      const dispatchMock = vi.fn();
      let beforeRemoveHandler: ((e: any) => void) | null = null;

      const navigation = {
        goBack: goBackMock,
        dispatch: dispatchMock,
        addListener: vi.fn((event, cb) => {
          if (event === 'beforeRemove') beforeRemoveHandler = cb;
          return () => {};
        }),
      };

      render(
        <SuscripcionNuevaScreen
          catalogos={CATALOGO_MOCK}
          navigation={navigation as any}
        />,
      );

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Disney+' },
      });

      // Simular intento de salida por navegación (beforeRemove)
      const preventDefault = vi.fn();
      const accion = { type: 'POP' };
      act(() => {
        beforeRemoveHandler!({ preventDefault, data: { action: accion } });
      });

      expect(preventDefault).toHaveBeenCalled();
      expect(screen.getByTestId('aviso-cambios-sin-guardar')).toBeTruthy();

      // Descartar cambios
      fireEvent.click(screen.getByTestId('btn-descartar-cambios'));

      // Ejecuta la acción de navegación retenida
      expect(dispatchMock).toHaveBeenCalledWith(accion);
      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();
    });

    it('restaurar el valor inicial desactiva el aviso y permite salir directamente', () => {
      const goBackMock = vi.fn();
      const navigation = {
        goBack: goBackMock,
        addListener: vi.fn().mockReturnValue(() => {}),
      };

      render(
        <SuscripcionNuevaScreen
          catalogos={CATALOGO_MOCK}
          navigation={navigation as any}
        />,
      );

      // Escribir texto
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'HBO Max' },
      });

      // Borrar texto volviendo al valor inicial vacío
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: '' },
      });

      // Pulsar Cancelar y Volver
      fireEvent.click(screen.getByTestId('go-back'));

      // Como ya no hay cambios sucios, se cierra de inmediato
      expect(goBackMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();
    });

    it('guardar exitosamente limpia el estado sucio y navega a detalle sin advertencias', async () => {
      const replaceMock = vi.fn();
      const navigation = {
        replace: replaceMock,
        navigate: vi.fn(),
        addListener: vi.fn().mockReturnValue(() => {}),
      };

      const onCrearSuscripcion = vi.fn().mockResolvedValue({
        id: 'nueva-sub-1',
        nombre: 'Crunchyroll',
        monto: 3990,
        moneda: 'CLP',
        frecuencia: 'mensual',
        categoria: 'streaming',
        fecha_proximo_cobro: '2026-12-01',
        estado: 'activo',
      });

      render(
        <SuscripcionNuevaScreen
          catalogos={CATALOGO_MOCK}
          navigation={navigation as any}
          onCrearSuscripcion={onCrearSuscripcion}
        />,
      );

      // Llenar campos requeridos
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Crunchyroll' },
      });
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '3990' },
      });
      fireEvent.change(screen.getByTestId('input-fecha-cobro'), {
        target: { value: '2026-12-01' },
      });

      // Guardar
      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar-suscripcion'));
      });

      expect(onCrearSuscripcion).toHaveBeenCalledTimes(1);
      // Redirige al detalle y no muestra diálogo
      expect(replaceMock).toHaveBeenCalledWith('SuscripcionDetalle', { id: 'nueva-sub-1' });
      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();
    });
  });

  describe('Formulario de Edición (SuscripcionEditarScreen)', () => {
    it('formulario limpio no interrumpe navegación al cancelar', () => {
      const goBackMock = vi.fn();
      const navigation = {
        goBack: goBackMock,
        addListener: vi.fn().mockReturnValue(() => {}),
      };

      render(
        <SuscripcionEditarScreen
          suscripcion={SUSCRIPCION_MOCK}
          catalogos={CATALOGO_MOCK}
          navigation={navigation as any}
        />,
      );

      // Cancelar sin tocar nada
      fireEvent.click(screen.getByTestId('go-back'));

      expect(goBackMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();
    });

    it('con cambios modificados intercepta la salida en edición y permite seguir o descartar', () => {
      const goBackMock = vi.fn();
      const navigation = {
        goBack: goBackMock,
        addListener: vi.fn().mockReturnValue(() => {}),
      };

      render(
        <SuscripcionEditarScreen
          suscripcion={SUSCRIPCION_MOCK}
          catalogos={CATALOGO_MOCK}
          navigation={navigation as any}
        />,
      );

      // Modificar monto
      fireEvent.change(screen.getByTestId('input-monto'), {
        target: { value: '7990' },
      });

      // Intentar salir
      fireEvent.click(screen.getByTestId('go-back'));

      expect(goBackMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('aviso-cambios-sin-guardar')).toBeTruthy();

      // Seguir editando conserva el cambio
      fireEvent.click(screen.getByTestId('btn-seguir-editando'));
      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();
      expect(screen.getByTestId('input-monto')).toHaveProperty('value', '7990');

      // Intentar salir nuevamente y descartar
      fireEvent.click(screen.getByTestId('go-back'));
      fireEvent.click(screen.getByTestId('btn-descartar-cambios'));

      expect(goBackMock).toHaveBeenCalledTimes(1);
    });

    it('guardar exitosamente en edición actualiza y regresa sin mostrar advertencias', async () => {
      const popToMock = vi.fn();
      const navigation = {
        popTo: popToMock,
        navigate: vi.fn(),
        goBack: vi.fn(),
        addListener: vi.fn().mockReturnValue(() => {}),
      };

      const onActualizarSuscripcion = vi.fn().mockResolvedValue({
        ...SUSCRIPCION_MOCK,
        nombre: 'Spotify Familiar',
      });

      render(
        <SuscripcionEditarScreen
          suscripcion={SUSCRIPCION_MOCK}
          catalogos={CATALOGO_MOCK}
          navigation={navigation as any}
          onActualizarSuscripcion={onActualizarSuscripcion}
        />,
      );

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Spotify Familiar' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-guardar-edicion'));
      });

      expect(onActualizarSuscripcion).toHaveBeenCalledTimes(1);
      expect(popToMock).toHaveBeenCalledWith('SuscripcionDetalle', {
        id: SUSCRIPCION_MOCK.id,
        suscripcion: expect.objectContaining({ nombre: 'Spotify Familiar' }),
      });
      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();
    });
  });

  describe('Integración con Android Hardware BackHandler', () => {
    it('BackHandler abre el aviso si hay cambios pendientes y lo cierra con un segundo toque', () => {
      render(
        <SuscripcionNuevaScreen
          catalogos={CATALOGO_MOCK}
          navigation={{ addListener: vi.fn().mockReturnValue(() => {}) } as any}
        />,
      );

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'YouTube Premium' },
      });

      // Disparar pulsación de botón atrás físico de Android
      act(() => {
        const interceptado = (BackHandler as any)._triggerBackPress();
        expect(interceptado).toBe(true);
      });

      // Despliega el modal de aviso
      expect(screen.getByTestId('aviso-cambios-sin-guardar')).toBeTruthy();

      // Segundo toque atrás físico actúa como cancelar aviso ("Seguir editando")
      act(() => {
        const interceptado = (BackHandler as any)._triggerBackPress();
        expect(interceptado).toBe(true);
      });

      expect(screen.queryByTestId('aviso-cambios-sin-guardar')).toBeNull();
      expect(screen.getByTestId('input-nombre')).toHaveProperty('value', 'YouTube Premium');
    });
  });
});
