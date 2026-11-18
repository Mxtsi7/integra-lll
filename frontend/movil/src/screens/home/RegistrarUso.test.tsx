// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  ErrorDeApi,
  formatearFecha,
  hoyEnTexto,
  type Suscripcion,
} from '@ojoalgasto/shared';
import { RegistrarUsoFormMovil } from './RegistrarUsoFormMovil';
import { RegistrarUsoModal } from './RegistrarUsoModal';
import SuscripcionDetalleScreen from './SuscripcionDetalleScreen';

const MOCK_SUSCRIPCION: Suscripcion = {
  id: 'sub-uso-1',
  nombre: 'Spotify',
  monto: 4500,
  moneda: 'CLP',
  frecuencia: 'mensual',
  fecha_proximo_cobro: '2026-11-05',
  categoria: 'musica',
  estado: 'activo',
  horas_uso_mes: 0,
};

describe('Registrar Minutos de Uso desde Móvil (SE-28)', () => {
  describe('Formulario Móvil RegistrarUsoFormMovil', () => {
    it('renderiza inputs de minutos, fecha con valor predeterminado de hoy y botón de envío', () => {
      render(
        <RegistrarUsoFormMovil
          idSuscripcion="sub-uso-1"
          onRegistrar={vi.fn()}
        />
      );

      const inputMinutos = screen.getByTestId('input-minutos');
      const inputFecha = screen.getByTestId('input-fecha');
      const btnSubmit = screen.getByTestId('btn-submit-uso');

      expect(inputMinutos).toBeTruthy();
      expect(inputFecha).toBeTruthy();
      expect(btnSubmit).toBeTruthy();
      expect(screen.getByText('Registrar uso')).toBeTruthy();

      // Fecha predeterminada es la fecha local de hoy (YYYY-MM-DD)
      expect((inputFecha as HTMLInputElement).value).toBe(hoyEnTexto());
    });

    it('Criterio 2: Rechaza minutos vacíos, cero o negativos sin enviar ni presentar como guardado', async () => {
      const onRegistrar = vi.fn();
      render(
        <RegistrarUsoFormMovil
          idSuscripcion="sub-uso-1"
          onRegistrar={onRegistrar}
        />
      );

      const inputMinutos = screen.getByTestId('input-minutos');
      const btnSubmit = screen.getByTestId('btn-submit-uso');

      // 1. Minutos vacíos
      fireEvent.change(inputMinutos, { target: { value: '' } });
      await act(async () => {
        fireEvent.click(btnSubmit);
      });
      expect(onRegistrar).not.toHaveBeenCalled();
      expect(screen.getByTestId('error-minutos').textContent).toContain('Ingresa los minutos de uso.');
      expect(screen.queryByTestId('confirmacion-uso')).toBeNull();

      // 2. Cero minutos
      fireEvent.change(inputMinutos, { target: { value: '0' } });
      await act(async () => {
        fireEvent.click(btnSubmit);
      });
      expect(onRegistrar).not.toHaveBeenCalled();
      expect(screen.getByTestId('error-minutos').textContent).toContain(
        'Los minutos de uso no pueden ser negativos ni cero.'
      );
      expect(screen.queryByTestId('confirmacion-uso')).toBeNull();

      // 3. Negativo
      fireEvent.change(inputMinutos, { target: { value: '-30' } });
      await act(async () => {
        fireEvent.click(btnSubmit);
      });
      expect(onRegistrar).not.toHaveBeenCalled();
      expect(screen.getByTestId('error-minutos').textContent).toContain(
        'Los minutos de uso no pueden ser negativos ni cero.'
      );

      // 4. Decimal o no entero
      fireEvent.change(inputMinutos, { target: { value: '15.5' } });
      await act(async () => {
        fireEvent.click(btnSubmit);
      });
      expect(onRegistrar).not.toHaveBeenCalled();
      expect(screen.getByTestId('error-minutos').textContent).toContain(
        'Los minutos deben ser un número entero válido.'
      );

      // 5. Superior al máximo mensual (44.640)
      fireEvent.change(inputMinutos, { target: { value: '50000' } });
      await act(async () => {
        fireEvent.click(btnSubmit);
      });
      expect(onRegistrar).not.toHaveBeenCalled();
      expect(screen.getByTestId('error-minutos').textContent).toContain(
        'Los minutos de uso no pueden superar el máximo mensual (44.640 minutos).'
      );
      expect(screen.queryByTestId('confirmacion-uso')).toBeNull();
    });

    it('Criterio 2: Rechaza fecha inexistente o fecha futura sin enviar al servidor', async () => {
      const onRegistrar = vi.fn();
      render(
        <RegistrarUsoFormMovil
          idSuscripcion="sub-uso-1"
          onRegistrar={onRegistrar}
        />
      );

      const inputMinutos = screen.getByTestId('input-minutos');
      const inputFecha = screen.getByTestId('input-fecha');
      const btnSubmit = screen.getByTestId('btn-submit-uso');

      fireEvent.change(inputMinutos, { target: { value: '60' } });

      // Fecha inexistente (e.g. 30 de febrero)
      fireEvent.change(inputFecha, { target: { value: '2026-02-30' } });
      await act(async () => {
        fireEvent.click(btnSubmit);
      });
      expect(onRegistrar).not.toHaveBeenCalled();
      expect(screen.getByTestId('error-fecha').textContent).toContain('Esa fecha no existe.');
      expect(screen.queryByTestId('confirmacion-uso')).toBeNull();

      // Fecha futura
      fireEvent.change(inputFecha, { target: { value: '2099-01-01' } });
      await act(async () => {
        fireEvent.click(btnSubmit);
      });
      expect(onRegistrar).not.toHaveBeenCalled();
      expect(screen.getByTestId('error-fecha').textContent).toContain(
        'No se puede registrar uso de una fecha futura.'
      );
      expect(screen.queryByTestId('confirmacion-uso')).toBeNull();
    });

    it('si se borra la fecha, envía undefined para que el backend use hoy de forma predeterminada', async () => {
      const onRegistrar = vi.fn().mockResolvedValue({
        ...MOCK_SUSCRIPCION,
        horas_uso_mes: 0.5,
      });

      render(
        <RegistrarUsoFormMovil
          idSuscripcion="sub-uso-1"
          onRegistrar={onRegistrar}
        />
      );

      fireEvent.change(screen.getByTestId('input-minutos'), { target: { value: '30' } });
      fireEvent.change(screen.getByTestId('input-fecha'), { target: { value: '   ' } });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-submit-uso'));
      });

      expect(onRegistrar).toHaveBeenCalledTimes(1);
      expect(onRegistrar).toHaveBeenCalledWith(30, undefined);
      expect(screen.getByTestId('confirmacion-uso').textContent).toContain('Registraste 30 minutos.');
    });

    it('Criterio 1: Registro positivo en el mes actual envía payload, muestra confirmación y limpia input', async () => {
      const onRegistrar = vi.fn().mockResolvedValue({
        ...MOCK_SUSCRIPCION,
        horas_uso_mes: 0.75,
      });
      const onExito = vi.fn();

      render(
        <RegistrarUsoFormMovil
          idSuscripcion="sub-uso-1"
          onRegistrar={onRegistrar}
          onExito={onExito}
        />
      );

      const inputMinutos = screen.getByTestId('input-minutos');
      fireEvent.change(inputMinutos, { target: { value: '45' } });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-submit-uso'));
      });

      expect(onRegistrar).toHaveBeenCalledTimes(1);
      expect(onRegistrar).toHaveBeenCalledWith(45, hoyEnTexto());
      expect(onExito).toHaveBeenCalledWith(expect.objectContaining({ horas_uso_mes: 0.75 }));

      // Confirmación accesible
      const confirmacion = screen.getByTestId('confirmacion-uso');
      expect(confirmacion.textContent).toContain('Registraste 45 minutos.');
      expect(confirmacion.getAttribute('role')).toBe('status');

      // Minutos se limpian tras éxito
      expect((inputMinutos as HTMLInputElement).value).toBe('');
    });

    it('registro positivo en fecha de un mes anterior avisa que no suma a las horas del mes actual (VI-10)', async () => {
      const [anio, mes] = hoyEnTexto().split('-').map(Number);
      const finMesAnterior = new Date(anio, mes - 1, 0);
      const fechaAnterior = `${finMesAnterior.getFullYear()}-${String(finMesAnterior.getMonth() + 1).padStart(2, '0')}-${String(finMesAnterior.getDate()).padStart(2, '0')}`;

      const onRegistrar = vi.fn().mockResolvedValue(MOCK_SUSCRIPCION);

      render(
        <RegistrarUsoFormMovil
          idSuscripcion="sub-uso-1"
          onRegistrar={onRegistrar}
        />
      );

      fireEvent.change(screen.getByTestId('input-minutos'), { target: { value: '90' } });
      fireEvent.change(screen.getByTestId('input-fecha'), { target: { value: fechaAnterior } });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-submit-uso'));
      });

      expect(onRegistrar).toHaveBeenCalledWith(90, fechaAnterior);
      expect(screen.getByTestId('confirmacion-uso').textContent).toContain(
        `Registraste 90 minutos el ${formatearFecha(fechaAnterior)}. No suma a las horas de este mes.`
      );
    });

    it('bloqueo de doble envío: múltiples pulsaciones mientras está en vuelo solo envían una petición', async () => {
      let resolverPeticion: (s: Suscripcion) => void;
      const onRegistrar = vi.fn().mockReturnValue(
        new Promise<Suscripcion>((resolve) => {
          resolverPeticion = resolve;
        })
      );

      render(
        <RegistrarUsoFormMovil
          idSuscripcion="sub-uso-1"
          onRegistrar={onRegistrar}
        />
      );

      fireEvent.change(screen.getByTestId('input-minutos'), { target: { value: '20' } });
      const btn = screen.getByTestId('btn-submit-uso');

      // Primer click
      fireEvent.click(btn);
      // Clicks repetidos mientras guardando es true
      fireEvent.click(btn);
      fireEvent.click(btn);

      expect(onRegistrar).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Registrando…')).toBeTruthy();
      expect(btn.getAttribute('aria-disabled')).toBe('true');

      // Resolver petición
      await act(async () => {
        resolverPeticion!({ ...MOCK_SUSCRIPCION, horas_uso_mes: 0.33 });
      });

      expect(screen.getByText('Registrar uso')).toBeTruthy();
      expect(btn.getAttribute('aria-disabled')).toBeNull();
      expect(screen.getByTestId('confirmacion-uso').textContent).toContain('Registraste 20 minutos.');
    });

    it('Criterio 2: Errores del servidor por campo se mapean al campo correspondiente y conservan el valor escrito', async () => {
      const errorApi = new ErrorDeApi('Error en los campos', 400, {
        minutos: ['Los minutos de uso no pueden ser negativos ni cero.'],
      });
      const onRegistrar = vi.fn().mockRejectedValue(errorApi);

      render(
        <RegistrarUsoFormMovil
          idSuscripcion="sub-uso-1"
          onRegistrar={onRegistrar}
        />
      );

      const inputMinutos = screen.getByTestId('input-minutos');
      fireEvent.change(inputMinutos, { target: { value: '30' } });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-submit-uso'));
      });

      expect(screen.getByTestId('error-minutos').textContent).toContain(
        'Los minutos de uso no pueden ser negativos ni cero.'
      );
      expect(screen.queryByTestId('confirmacion-uso')).toBeNull();
      // Conserva el valor escrito para corregirlo
      expect((inputMinutos as HTMLInputElement).value).toBe('30');
    });

    it('Criterio 2: Error general (500 o desconexión de red) muestra alerta accesible y no confirma guardado', async () => {
      const onRegistrar = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      render(
        <RegistrarUsoFormMovil
          idSuscripcion="sub-uso-1"
          onRegistrar={onRegistrar}
        />
      );

      fireEvent.change(screen.getByTestId('input-minutos'), { target: { value: '40' } });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-submit-uso'));
      });

      expect(screen.getByTestId('error-general').textContent).toContain(
        'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'
      );
      expect(screen.queryByTestId('confirmacion-uso')).toBeNull();
    });
  });

  describe('Modal Accesible RegistrarUsoModal', () => {
    it('renderiza título con el nombre de la suscripción y permite cancelar', () => {
      const onCancelar = vi.fn();
      render(
        <RegistrarUsoModal
          visible={true}
          idSuscripcion="sub-uso-1"
          nombreSuscripcion="Spotify Premium"
          onRegistrar={vi.fn()}
          onCancelar={onCancelar}
        />
      );

      expect(screen.getByTestId('modal-registrar-uso')).toBeTruthy();
      expect(screen.getByTestId('titulo-modal-registrar-uso').textContent).toContain(
        'Registrar uso en Spotify Premium'
      );

      fireEvent.click(screen.getByTestId('btn-cancelar-uso'));
      expect(onCancelar).toHaveBeenCalledTimes(1);
    });
  });

  describe('Integración en SuscripcionDetalleScreen (SE-21 + SE-28)', () => {
    it('Criterio 1: Registrar uso positivo actualiza de inmediato las métricas en la pantalla de detalle', async () => {
      const suscripcionInicial: Suscripcion = {
        id: 'sub-1',
        nombre: 'Netflix',
        monto: 9990,
        moneda: 'CLP',
        frecuencia: 'mensual',
        fecha_proximo_cobro: '2026-10-05',
        categoria: 'streaming',
        estado: 'activo',
        horas_uso_mes: 0, // Inicialmente sin uso
      };

      const suscripcionActualizada: Suscripcion = {
        ...suscripcionInicial,
        horas_uso_mes: 18, // 18 horas tras registrar uso
      };

      const onCargarSuscripcion = vi.fn().mockResolvedValue(suscripcionInicial);
      const onRegistrarUsoApi = vi.fn().mockResolvedValue(suscripcionActualizada);

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-1' } } as any}
          onCargarSuscripcion={onCargarSuscripcion}
          onRegistrarUsoApi={onRegistrarUsoApi}
        />
      );

      // Esperar a que cargue el detalle
      expect(await screen.findByText('Netflix')).toBeTruthy();
      // Inicialmente con 0 horas de uso, no aparece "18 h"
      expect(screen.queryByText('18 h')).toBeNull();

      // Abrir modal de registro de uso
      fireEvent.click(screen.getByTestId('btn-registrar-uso'));
      expect(await screen.findByTestId('modal-registrar-uso')).toBeTruthy();

      // Ingresar 1080 minutos (= 18 horas)
      fireEvent.change(screen.getByTestId('input-minutos'), { target: { value: '1080' } });

      // Enviar formulario
      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-submit-uso'));
      });

      expect(onRegistrarUsoApi).toHaveBeenCalledTimes(1);
      expect(onRegistrarUsoApi).toHaveBeenCalledWith('sub-1', {
        minutos: 1080,
        fecha: hoyEnTexto(),
      });

      // Se muestra la confirmación en el modal
      expect(screen.getByTestId('confirmacion-uso').textContent).toContain('Registraste 1.080 minutos.');

      // Cerrar modal
      fireEvent.click(screen.getByTestId('btn-cancelar-uso'));

      // Verificar que las métricas en la pantalla de Detalle se actualizaron reactivamente
      expect(screen.getByText('18 h')).toBeTruthy();
      // Costo por hora estimado: 9990 / 18 = 555
      expect(screen.getByText(/555/)).toBeTruthy();
    });

    it('Criterio 2: Si el registro falla, las métricas previas de la pantalla no se alteran y no se presenta como guardado', async () => {
      const suscripcionInicial: Suscripcion = {
        id: 'sub-1',
        nombre: 'Netflix',
        monto: 9990,
        moneda: 'CLP',
        frecuencia: 'mensual',
        fecha_proximo_cobro: '2026-10-05',
        categoria: 'streaming',
        estado: 'activo',
        horas_uso_mes: 5,
      };

      const onRegistrarUsoApi = vi.fn().mockRejectedValue(new ErrorDeApi('Error en servidor', 500));

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-1' } } as any}
          onCargarSuscripcion={vi.fn().mockResolvedValue(suscripcionInicial)}
          onRegistrarUsoApi={onRegistrarUsoApi}
        />
      );

      expect(await screen.findByText('Netflix')).toBeTruthy();
      expect(screen.getByText('5 h')).toBeTruthy();

      // Abrir modal
      fireEvent.click(screen.getByTestId('btn-registrar-uso'));
      expect(await screen.findByTestId('modal-registrar-uso')).toBeTruthy();

      // Enviar 60 minutos (fallará con 500)
      fireEvent.change(screen.getByTestId('input-minutos'), { target: { value: '60' } });
      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-submit-uso'));
      });

      expect(screen.getByTestId('error-general')).toBeTruthy();
      expect(screen.queryByTestId('confirmacion-uso')).toBeNull();

      // Cerrar modal
      fireEvent.click(screen.getByTestId('btn-cancelar-uso'));

      // Las métricas originales de 5 h siguen intactas
      expect(screen.getByText('5 h')).toBeTruthy();
      expect(screen.queryByText('6 h')).toBeNull();
    });

    it('Regresión P2 · POST pendiente + Atrás (onRequestClose) no permite doble envío y recupera estado correcto tras éxito', async () => {
      let resolverPost: (sub: Suscripcion) => void = () => {};
      const promesaPostPendiente = new Promise<Suscripcion>((resolve) => {
        resolverPost = resolve;
      });

      const suscripcionInicial: Suscripcion = {
        id: 'sub-doble-envio',
        nombre: 'Disney+',
        monto: 7990,
        moneda: 'CLP',
        frecuencia: 'mensual',
        fecha_proximo_cobro: '2026-10-15',
        categoria: 'streaming',
        estado: 'activo',
        horas_uso_mes: 2,
      };

      const onRegistrarUsoApi = vi.fn().mockImplementation(() => promesaPostPendiente);

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-doble-envio' } } as any}
          onCargarSuscripcion={vi.fn().mockResolvedValue(suscripcionInicial)}
          onRegistrarUsoApi={onRegistrarUsoApi}
        />
      );

      expect(await screen.findByText('Disney+')).toBeTruthy();

      // 1. Abrir modal
      fireEvent.click(screen.getByTestId('btn-registrar-uso'));
      expect(await screen.findByTestId('modal-registrar-uso')).toBeTruthy();

      // 2. Ingresar 60 minutos y presionar enviar
      fireEvent.change(screen.getByTestId('input-minutos'), { target: { value: '60' } });
      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-submit-uso'));
      });

      // Primer POST disparado y en curso
      expect(onRegistrarUsoApi).toHaveBeenCalledTimes(1);

      // 3. Simular evento Atrás de Android (onRequestClose en Modal)
      const btnRequestClose = screen.getByTestId('modal-registrar-uso-request-close');
      await act(async () => {
        fireEvent.click(btnRequestClose);
      });

      // El modal permanece visible porque está bloqueado durante el POST pendiente
      expect(screen.queryByTestId('modal-registrar-uso')).toBeTruthy();

      // El botón de submit está deshabilitado / aria-disabled=true
      const btnSubmit = screen.getByTestId('btn-submit-uso');
      expect(btnSubmit.getAttribute('disabled')).not.toBeNull();

      // Intentar forzar un segundo click de envío mientras sigue pendiente
      await act(async () => {
        fireEvent.click(btnSubmit);
      });

      // Sigue habiendo SOLO un POST en vuelo (no se duplicó el envío)
      expect(onRegistrarUsoApi).toHaveBeenCalledTimes(1);

      // 4. Resolver el POST pendiente con éxito
      await act(async () => {
        resolverPost({
          ...suscripcionInicial,
          horas_uso_mes: 3,
        });
      });

      // Se muestra la confirmación del nuevo uso
      expect(screen.getByTestId('confirmacion-uso')).toBeTruthy();

      // Ahora que terminó el POST, el modal permite cerrarse normalmente
      const btnCancelar = screen.getByTestId('btn-cancelar-uso');
      expect(btnCancelar.getAttribute('disabled')).toBeNull();
      await act(async () => {
        fireEvent.click(btnCancelar);
      });
      expect(screen.queryByTestId('modal-registrar-uso')).toBeNull();

      // Las métricas se actualizaron correctamente a 3 h
      expect(screen.getByText('3 h')).toBeTruthy();
    });

    it('Regresión P2 · Si POST pendiente con intento de cierre falla, se muestra el error y se recupera el estado para reintentar o cancelar', async () => {
      let rechazarPost: (err: any) => void = () => {};
      const promesaPostFalla = new Promise<Suscripcion>((_, reject) => {
        rechazarPost = reject;
      });

      const suscripcionInicial: Suscripcion = {
        id: 'sub-falla',
        nombre: 'HBO Max',
        monto: 6990,
        moneda: 'CLP',
        frecuencia: 'mensual',
        fecha_proximo_cobro: '2026-10-15',
        categoria: 'streaming',
        estado: 'activo',
        horas_uso_mes: 1,
      };

      const onRegistrarUsoApi = vi.fn().mockImplementation(() => promesaPostFalla);

      render(
        <SuscripcionDetalleScreen
          route={{ params: { id: 'sub-falla' } } as any}
          onCargarSuscripcion={vi.fn().mockResolvedValue(suscripcionInicial)}
          onRegistrarUsoApi={onRegistrarUsoApi}
        />
      );

      expect(await screen.findByText('HBO Max')).toBeTruthy();

      // Abrir modal y enviar
      fireEvent.click(screen.getByTestId('btn-registrar-uso'));
      fireEvent.change(screen.getByTestId('input-minutos'), { target: { value: '45' } });
      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-submit-uso'));
      });

      expect(onRegistrarUsoApi).toHaveBeenCalledTimes(1);

      // Simular Atrás mientras POST está en vuelo: bloqueado
      const btnRequestClose = screen.getByTestId('modal-registrar-uso-request-close');
      await act(async () => {
        fireEvent.click(btnRequestClose);
      });
      expect(screen.getByTestId('modal-registrar-uso')).toBeTruthy();

      // Ahora el POST falla
      await act(async () => {
        rechazarPost(new ErrorDeApi('Fallo temporal de servidor', 500));
      });

      // Muestra el error y libera el bloqueo
      expect(screen.getByTestId('error-general')).toBeTruthy();
      expect(screen.getByText('Fallo temporal de servidor')).toBeTruthy();

      // Ahora Atrás o Cancelar sí permite cerrar el modal
      await act(async () => {
        fireEvent.click(btnRequestClose);
      });
      expect(screen.queryByTestId('modal-registrar-uso')).toBeNull();
    });
  });
});
