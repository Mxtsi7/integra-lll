// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorDeApi, type Suscripcion } from '@ojoalgasto/shared';
import SuscripcionDetalleScreen, {
  SuscripcionDetalleView,
} from './SuscripcionDetalleScreen';

const MOCK_SUSCRIPCION_ACTIVA: Suscripcion = {
  id: 'sub-1',
  nombre: 'Netflix',
  monto: 9990,
  moneda: 'CLP',
  frecuencia: 'mensual',
  fecha_proximo_cobro: '2026-10-05',
  categoria: 'streaming',
  estado: 'activo',
  horas_uso_mes: 18,
};

const MOCK_SUSCRIPCION_ANUAL: Suscripcion = {
  id: 'sub-2',
  nombre: 'Amazon Prime',
  monto: 60000,
  moneda: 'CLP',
  frecuencia: 'anual',
  fecha_proximo_cobro: '2027-01-15',
  categoria: 'streaming',
  estado: 'activo',
  horas_uso_mes: 10,
};

const MOCK_SUSCRIPCION_FANTASMA: Suscripcion = {
  id: 'sub-3',
  nombre: 'Gimnasio',
  monto: 25000,
  moneda: 'CLP',
  frecuencia: 'mensual',
  fecha_proximo_cobro: '2026-10-01',
  categoria: 'salud',
  estado: 'fantasma',
  horas_uso_mes: 0,
};

const MOCK_SUSCRIPCION_CANCELADA: Suscripcion = {
  id: 'sub-4',
  nombre: 'Disney Plus',
  monto: 7990,
  moneda: 'CLP',
  frecuencia: 'mensual',
  fecha_proximo_cobro: '2026-09-01',
  categoria: 'streaming',
  estado: 'cancelado',
};

const MOCK_SUSCRIPCION_PRUEBA: Suscripcion = {
  id: 'sub-5',
  nombre: 'Apple Music',
  monto: 4500,
  moneda: 'CLP',
  frecuencia: 'mensual',
  fecha_proximo_cobro: '2026-11-01',
  fin_prueba: '2026-10-25',
  categoria: 'musica',
  estado: 'prueba',
};

describe('Detalle Móvil de Suscripción (SE-21)', () => {
  describe('Criterio 1: Id correcto muestra sus datos actuales', () => {
    it('renderiza encabezado, monto, periodicidad, próximo cobro, badge de estado y datos de uso', () => {
      const onVolver = vi.fn();

      render(
        <SuscripcionDetalleView
          id="sub-1"
          estado={{ tipo: 'listo', suscripcion: MOCK_SUSCRIPCION_ACTIVA }}
          onVolver={onVolver}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByTestId('screen-suscripcion-detalle')).toBeTruthy();
      expect(screen.getByText('Netflix')).toBeTruthy();
      expect(screen.getAllByText('streaming').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('ID Suscripción: sub-1')).toBeTruthy();

      // Monto formateado con sufijo de frecuencia
      expect(screen.getByText(/9\.990/)).toBeTruthy();
      expect(screen.getByText('/mes')).toBeTruthy();

      // Badge de estado accesible con texto explícito (no solo color)
      expect(screen.getByText('Activa')).toBeTruthy();

      // Datos en cuadrícula
      expect(screen.getByText(/Próximo cobro: 05 oct 2026/)).toBeTruthy();
      expect(screen.getByText('18 h')).toBeTruthy();
      // Costo por hora calculado: 9990 / 18 = 555
      expect(screen.getByText(/555/)).toBeTruthy();

      // Botón volver
      const btnVolver = screen.getByTestId('go-back');
      fireEvent.click(btnVolver);
      expect(onVolver).toHaveBeenCalledTimes(1);
    });

    it('para suscripciones anuales calcula y muestra el equivalente mensual', () => {
      render(
        <SuscripcionDetalleView
          id="sub-2"
          estado={{ tipo: 'listo', suscripcion: MOCK_SUSCRIPCION_ANUAL }}
          onVolver={vi.fn()}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByText('Amazon Prime')).toBeTruthy();
      expect(screen.getByText('/año')).toBeTruthy();
      // 60.000 / 12 = 5.000 mensual
      expect(screen.getByText(/Equivale a \$5\.000 al mes/)).toBeTruthy();
    });

    it('para suscripciones fantasma muestra el aviso preventivo de ahorro', () => {
      render(
        <SuscripcionDetalleView
          id="sub-3"
          estado={{ tipo: 'listo', suscripcion: MOCK_SUSCRIPCION_FANTASMA }}
          onVolver={vi.fn()}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByTestId('aviso-fantasma')).toBeTruthy();
      expect(screen.getByText('Suscripción sin uso prolongado')).toBeTruthy();
      expect(
        screen.getByText(
          /Lleva más de 45 días sin uso registrado y sigue cobrando/
        )
      ).toBeTruthy();
      expect(screen.getByText('Sin uso')).toBeTruthy();
    });

    it('para suscripciones canceladas muestra "Sin cobros pendientes" y badge Cancelada', () => {
      render(
        <SuscripcionDetalleView
          id="sub-4"
          estado={{ tipo: 'listo', suscripcion: MOCK_SUSCRIPCION_CANCELADA }}
          onVolver={vi.fn()}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByText('Disney Plus')).toBeTruthy();
      expect(screen.getByText('Sin cobros pendientes')).toBeTruthy();
      expect(screen.getByText('Cancelada')).toBeTruthy();
    });

    it('para suscripciones en prueba muestra fecha de fin de prueba', () => {
      render(
        <SuscripcionDetalleView
          id="sub-5"
          estado={{ tipo: 'listo', suscripcion: MOCK_SUSCRIPCION_PRUEBA }}
          onVolver={vi.fn()}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByText('Apple Music')).toBeTruthy();
      expect(screen.getByText(/Prueba termina: 25 oct 2026/)).toBeTruthy();
      expect(screen.getByText('Prueba gratis')).toBeTruthy();
    });
  });

  describe('Criterio 2: Id inexistente/ajeno no rompe navegación ni revela información', () => {
    it('ante error 404 (no encontrada / retirada) muestra mensaje neutro y permite volver a la lista', () => {
      const onVolver = vi.fn();

      render(
        <SuscripcionDetalleView
          id="inexistente-999"
          estado={{ tipo: 'no-encontrada' }}
          onVolver={onVolver}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText('Suscripción no encontrada')).toBeTruthy();
      expect(
        screen.getByText(
          'No encontramos esa suscripción. Puede que haya sido eliminada.'
        )
      ).toBeTruthy();

      // No revela información de datos o montos
      expect(screen.queryByTestId('cuadricula-datos')).toBeNull();
      expect(screen.queryByTestId('btn-editar-suscripcion')).toBeNull();

      // Botón volver a la lista no rompe navegación
      const btnVolver = screen.getByTestId('go-back');
      fireEvent.click(btnVolver);
      expect(onVolver).toHaveBeenCalledTimes(1);
    });

    it('ante error 403 (ajeno / sin permiso) muestra mensaje seguro de acceso no autorizado y permite volver', () => {
      const onVolver = vi.fn();

      render(
        <SuscripcionDetalleView
          id="ajena-888"
          estado={{ tipo: 'no-autorizada' }}
          onVolver={onVolver}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText('Acceso no autorizado')).toBeTruthy();
      expect(
        screen.getByText('No tienes permiso para ver esta suscripción.')
      ).toBeTruthy();

      // No revela datos privados ni filtra información ajena
      expect(screen.queryByTestId('cuadricula-datos')).toBeNull();

      const btnVolver = screen.getByTestId('go-back');
      fireEvent.click(btnVolver);
      expect(onVolver).toHaveBeenCalledTimes(1);
    });

    it('ante fallo de red (500/offline) muestra NetworkError con reintento y botón de retorno', () => {
      const onReintentar = vi.fn();
      const onVolver = vi.fn();

      render(
        <SuscripcionDetalleView
          id="sub-1"
          estado={{
            tipo: 'error',
            mensaje: 'No pudimos conectar con el servidor.',
          }}
          onVolver={onVolver}
          onReintentar={onReintentar}
        />
      );

      expect(screen.getByRole('alert')).toBeTruthy();
      expect(
        screen.getByText('No pudimos conectar con el servidor.')
      ).toBeTruthy();

      // Botón reintentar
      const btnReintentar = screen.getByRole('button', { name: /reintentar/i });
      fireEvent.click(btnReintentar);
      expect(onReintentar).toHaveBeenCalledTimes(1);

      // Botón volver disponible sin quedar atrapado
      const btnVolver = screen.getByTestId('go-back');
      fireEvent.click(btnVolver);
      expect(onVolver).toHaveBeenCalledTimes(1);
    });

    it('mientras carga muestra indicador Loading con role="progressbar" y botón volver', () => {
      const onVolver = vi.fn();

      render(
        <SuscripcionDetalleView
          id="sub-1"
          estado={{ tipo: 'cargando' }}
          onVolver={onVolver}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByRole('progressbar')).toBeTruthy();
      expect(screen.getByText('ID Suscripción: sub-1')).toBeTruthy();

      const btnVolver = screen.getByTestId('go-back');
      fireEvent.click(btnVolver);
      expect(onVolver).toHaveBeenCalledTimes(1);
    });
  });

  describe('Puntos de Integración (SE-24, SE-26, SE-28, SE-30)', () => {
    it('dispara onEditar con la suscripción al pulsar Editar Suscripción', () => {
      const onEditar = vi.fn();

      render(
        <SuscripcionDetalleView
          id="sub-1"
          estado={{ tipo: 'listo', suscripcion: MOCK_SUSCRIPCION_ACTIVA }}
          onVolver={vi.fn()}
          onReintentar={vi.fn()}
          onEditar={onEditar}
        />
      );

      const btnEditar = screen.getByTestId('btn-editar-suscripcion');
      expect(btnEditar).toBeTruthy();
      fireEvent.click(btnEditar);
      expect(onEditar).toHaveBeenCalledWith(MOCK_SUSCRIPCION_ACTIVA);
    });

    it('dispara onEliminar con la suscripción al pulsar Retirar Suscripción', () => {
      const onEliminar = vi.fn();

      render(
        <SuscripcionDetalleView
          id="sub-1"
          estado={{ tipo: 'listo', suscripcion: MOCK_SUSCRIPCION_ACTIVA }}
          onVolver={vi.fn()}
          onReintentar={vi.fn()}
          onEliminar={onEliminar}
        />
      );

      const btnEliminar = screen.getByTestId('btn-eliminar-suscripcion');
      expect(btnEliminar).toBeTruthy();
      fireEvent.click(btnEliminar);
      expect(onEliminar).toHaveBeenCalledWith(MOCK_SUSCRIPCION_ACTIVA);
    });

    it('dispara onRegistrarUso con la suscripción al pulsar Registrar Uso', () => {
      const onRegistrarUso = vi.fn();

      render(
        <SuscripcionDetalleView
          id="sub-1"
          estado={{ tipo: 'listo', suscripcion: MOCK_SUSCRIPCION_ACTIVA }}
          onVolver={vi.fn()}
          onReintentar={vi.fn()}
          onRegistrarUso={onRegistrarUso}
        />
      );

      const btnUso = screen.getByTestId('btn-registrar-uso');
      expect(btnUso).toBeTruthy();
      fireEvent.click(btnUso);
      expect(onRegistrarUso).toHaveBeenCalledWith(MOCK_SUSCRIPCION_ACTIVA);
    });

    it('renderiza la sección ancla de Historial y Registro de Uso (SE-30)', () => {
      render(
        <SuscripcionDetalleView
          id="sub-1"
          estado={{ tipo: 'listo', suscripcion: MOCK_SUSCRIPCION_ACTIVA }}
          onVolver={vi.fn()}
          onReintentar={vi.fn()}
        />
      );

      expect(screen.getByTestId('seccion-historial-uso')).toBeTruthy();
      expect(screen.getByText('Historial y Registro de Uso')).toBeTruthy();
    });
  });

  describe('Componente Contenedor SuscripcionDetalleScreen', () => {
    it('consume onCargarSuscripcion automáticamente al montarse', async () => {
      const onCargar = vi
        .fn()
        .mockResolvedValueOnce(MOCK_SUSCRIPCION_ACTIVA);

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-1' } } as any}
          onCargarSuscripcion={onCargar}
        />
      );

      expect(screen.getByRole('progressbar')).toBeTruthy();
      expect(await screen.findByText('Netflix')).toBeTruthy();
      expect(onCargar).toHaveBeenCalledWith('sub-1');
    });

    it('mapea ErrorDeApi con status 404 a estado no-encontrada', async () => {
      const onCargar = vi
        .fn()
        .mockRejectedValueOnce(new ErrorDeApi('No encontrado', 404));

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'inexistente' } } as any}
          onCargarSuscripcion={onCargar}
        />
      );

      expect(
        await screen.findByText('Suscripción no encontrada')
      ).toBeTruthy();
      expect(
        screen.getByText(
          'No encontramos esa suscripción. Puede que haya sido eliminada.'
        )
      ).toBeTruthy();
    });

    it('mapea ErrorDeApi con status 403 a estado no-autorizada', async () => {
      const onCargar = vi
        .fn()
        .mockRejectedValueOnce(new ErrorDeApi('Prohibido', 403));

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'ajena' } } as any}
          onCargarSuscripcion={onCargar}
        />
      );

      expect(await screen.findByText('Acceso no autorizado')).toBeTruthy();
      expect(
        screen.getByText('No tienes permiso para ver esta suscripción.')
      ).toBeTruthy();
    });

    it('navega hacia atrás con navigation.goBack() al presionar volver', () => {
      const goBackMock = vi.fn();
      const navigation = { goBack: goBackMock };

      render(
        <SuscripcionDetalleScreen
          navigation={navigation as any}
          route={{ params: { id: 'sub-1' } } as any}
          estadoInicial={{ tipo: 'listo', suscripcion: MOCK_SUSCRIPCION_ACTIVA }}
        />
      );

      const btnVolver = screen.getByTestId('go-back');
      fireEvent.click(btnVolver);
      expect(goBackMock).toHaveBeenCalledTimes(1);
    });

    it('protección de concurrencia: éxito antiguo de A no reemplaza 403 de B al actualizar route.params.id', async () => {
      let resolverA: (val: Suscripcion) => void;
      const promesaA = new Promise<Suscripcion>((resolve) => {
        resolverA = resolve;
      });

      const onCargar = vi.fn().mockImplementation((id: string) => {
        if (id === 'sub-A') return promesaA;
        if (id === 'sub-B') return Promise.reject(new ErrorDeApi('Prohibido', 403));
        return Promise.resolve(MOCK_SUSCRIPCION_ACTIVA);
      });

      // 1. Iniciar con sub-A (queda pendiente)
      const { rerender } = render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-A' } } as any}
          onCargarSuscripcion={onCargar}
        />
      );

      expect(screen.getByRole('progressbar')).toBeTruthy();

      // 2. Actualizar route.params.id a sub-B en la misma instancia
      rerender(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-B' } } as any}
          onCargarSuscripcion={onCargar}
        />
      );

      // B responde 403: aparece "Acceso no autorizado"
      expect(await screen.findByText('Acceso no autorizado')).toBeTruthy();

      // 3. A finalmente resuelve con datos de Netflix
      resolverA!(MOCK_SUSCRIPCION_ACTIVA);

      // Esperar un ciclo y verificar que B (403) se conserva y A no sobrescribe la pantalla
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByText('Acceso no autorizado')).toBeTruthy();
      expect(screen.queryByText('Netflix')).toBeNull();
    });

    it('protección de concurrencia: error antiguo de A no reemplaza éxito de B al actualizar route.params.id', async () => {
      let rechazarA: (err: unknown) => void;
      const promesaA = new Promise<Suscripcion>((_, reject) => {
        rechazarA = reject;
      });

      const onCargar = vi.fn().mockImplementation((id: string) => {
        if (id === 'sub-A') return promesaA;
        if (id === 'sub-B') return Promise.resolve(MOCK_SUSCRIPCION_ANUAL);
        return Promise.resolve(MOCK_SUSCRIPCION_ACTIVA);
      });

      const { rerender } = render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-A' } } as any}
          onCargarSuscripcion={onCargar}
        />
      );

      // Cambiar a sub-B
      rerender(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-B' } } as any}
          onCargarSuscripcion={onCargar}
        />
      );

      // B resuelve con Amazon Prime
      expect(await screen.findByText('Amazon Prime')).toBeTruthy();

      // A rechaza tarde con 404
      rechazarA!(new ErrorDeApi('No encontrada', 404));

      await new Promise((resolve) => setTimeout(resolve, 50));
      // B permanece intacto
      expect(screen.getByText('Amazon Prime')).toBeTruthy();
      expect(screen.queryByText('Suscripción no encontrada')).toBeNull();
    });

    it('desmontaje invalida respuestas pendientes sin actualizar estado', async () => {
      let resolverA: (val: Suscripcion) => void;
      const promesaA = new Promise<Suscripcion>((resolve) => {
        resolverA = resolve;
      });

      const onCargar = vi.fn().mockReturnValue(promesaA);

      const { unmount } = render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-A' } } as any}
          onCargarSuscripcion={onCargar}
        />
      );

      unmount();

      // Resolver después de desmontar
      resolverA!(MOCK_SUSCRIPCION_ACTIVA);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });
});
