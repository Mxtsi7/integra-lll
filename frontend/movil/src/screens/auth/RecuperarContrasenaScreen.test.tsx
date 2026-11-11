// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BackHandler } from 'react-native';
import { AuthError } from '@ojoalgasto/shared';
import RecuperarContrasenaScreen, {
  RecuperarContrasenaForm,
  RecuperarContrasenaConfirmacionView,
  type RecuperarContrasenaScreenPropsContainer,
} from './RecuperarContrasenaScreen';

describe('Pantalla Móvil Recuperar Contraseña (SE-14)', () => {
  const RESPUESTA_NEUTRA = {
    detail: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.',
  };

  describe('Maquetación y Controles Básicos', () => {
    it('renderiza título, subtítulo, input de correo y botones de acción', () => {
      render(
        <RecuperarContrasenaForm
          correo=""
          onCorreoChange={vi.fn()}
          onSubmit={vi.fn()}
          onNavegarLogin={vi.fn()}
          onVolver={vi.fn()}
        />
      );

      expect(screen.getByTestId('recuperar-titulo')).toBeTruthy();
      expect(screen.getByText('Recuperar Contraseña')).toBeTruthy();
      expect(
        screen.getByText('Te mandamos un enlace para crear una contraseña nueva.')
      ).toBeTruthy();

      const input = screen.getByTestId('input-correo');
      expect(input).toBeTruthy();
      expect(input.getAttribute('type')).toBe('email');

      expect(screen.getByTestId('recuperar-submit')).toBeTruthy();
      expect(screen.getByTestId('go-login')).toBeTruthy();
      expect(screen.getByTestId('go-back')).toBeTruthy();
    });

    it('ejecuta callbacks de navegación hacia Login y Atrás', () => {
      const onNavegarLogin = vi.fn();
      const onVolver = vi.fn();

      render(
        <RecuperarContrasenaForm
          correo=""
          onCorreoChange={vi.fn()}
          onSubmit={vi.fn()}
          onNavegarLogin={onNavegarLogin}
          onVolver={onVolver}
        />
      );

      fireEvent.click(screen.getByTestId('go-login'));
      expect(onNavegarLogin).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('go-back'));
      expect(onVolver).toHaveBeenCalledTimes(1);
    });
  });

  describe('Criterio de Aceptación 1: Solicitud genera feedback sin revelar existencia de cuenta', () => {
    it('un correo con cuenta y uno sin cuenta muestran exactamente la misma confirmación neutra', async () => {
      const onSolicitarRecuperacionApi = vi.fn().mockResolvedValue(RESPUESTA_NEUTRA);

      // 1. Intento con correo existente
      const { unmount: unmount1 } = render(
        <RecuperarContrasenaScreen onSolicitarRecuperacionApi={onSolicitarRecuperacionApi} />
      );

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'existe@ojoalgasto.cl' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('recuperar-submit'));
      });

      expect(screen.getByTestId('pantalla-recuperar-confirmacion')).toBeTruthy();
      const textoExiste = screen.getByTestId('recuperar-confirmacion-texto').textContent;
      expect(textoExiste).toContain('Si hay una cuenta con existe@ojoalgasto.cl');
      unmount1();

      // 2. Intento con correo no registrado
      render(
        <RecuperarContrasenaScreen onSolicitarRecuperacionApi={onSolicitarRecuperacionApi} />
      );

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'noexiste@ojoalgasto.cl' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('recuperar-submit'));
      });

      expect(screen.getByTestId('pantalla-recuperar-confirmacion')).toBeTruthy();
      const textoNoExiste = screen.getByTestId('recuperar-confirmacion-texto').textContent;
      expect(textoNoExiste).toContain('Si hay una cuenta con noexiste@ojoalgasto.cl');

      // Ambas confirmaciones comparten la misma estructura neutra anti-enumeración
      const normalizadoExiste = textoExiste?.replace('existe@ojoalgasto.cl', '<email>');
      const normalizadoNoExiste = textoNoExiste?.replace('noexiste@ojoalgasto.cl', '<email>');
      expect(normalizadoExiste).toBe(normalizadoNoExiste);
    });

    it('limpia espacios en blanco del correo antes de enviarlo a la API', async () => {
      const onSolicitarRecuperacionApi = vi.fn().mockResolvedValue(RESPUESTA_NEUTRA);

      render(
        <RecuperarContrasenaScreen onSolicitarRecuperacionApi={onSolicitarRecuperacionApi} />
      );

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: '   usuario.espaciado@ojoalgasto.cl   ' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('recuperar-submit'));
      });

      expect(onSolicitarRecuperacionApi).toHaveBeenCalledWith('usuario.espaciado@ojoalgasto.cl');
      expect(screen.getByTestId('recuperar-confirmacion-email').textContent).toBe(
        'usuario.espaciado@ojoalgasto.cl'
      );
    });
  });

  describe('Criterio de Aceptación 2: Caída de red termina la espera y permite reintentar', () => {
    it('ante error de red muestra aviso en español, deja el formulario editable y permite reintentar con éxito', async () => {
      const onSolicitarRecuperacionApi = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(RESPUESTA_NEUTRA);

      render(
        <RecuperarContrasenaScreen onSolicitarRecuperacionApi={onSolicitarRecuperacionApi} />
      );

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'ana@ojoalgasto.cl' },
      });

      // Primer intento: falla por red
      await act(async () => {
        fireEvent.click(screen.getByTestId('recuperar-submit'));
      });

      // Termina la espera y muestra error accesible en español
      expect(screen.getByTestId('recuperar-error-general')).toBeTruthy();
      expect(screen.getByTestId('recuperar-error-general').textContent).toContain(
        'No se pudo conectar con el servidor'
      );

      // El campo conserva el valor y el botón vuelve a estar habilitado
      const input = screen.getByTestId('input-correo') as HTMLInputElement;
      expect(input.value).toBe('ana@ojoalgasto.cl');
      expect(input.readOnly).toBe(false);

      const boton = screen.getByTestId('recuperar-submit');
      expect(boton.getAttribute('disabled')).toBeNull();

      // Segundo intento: el servidor se recupera y responde con éxito
      await act(async () => {
        fireEvent.click(boton);
      });

      expect(onSolicitarRecuperacionApi).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('pantalla-recuperar-confirmacion')).toBeTruthy();
    });
  });

  describe('Validaciones del Formulario y Errores de Servidor', () => {
    it('correo vacío no llama a la API y muestra mensaje requerido', async () => {
      const onSolicitarRecuperacionApi = vi.fn();

      render(
        <RecuperarContrasenaScreen onSolicitarRecuperacionApi={onSolicitarRecuperacionApi} />
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId('recuperar-submit'));
      });

      expect(onSolicitarRecuperacionApi).not.toHaveBeenCalled();
      expect(screen.getByTestId('error-correo').textContent).toBe(
        'Ingresa tu correo electrónico.'
      );
    });

    it('correo con formato inválido no llama a la API y muestra error específico', async () => {
      const onSolicitarRecuperacionApi = vi.fn();

      render(
        <RecuperarContrasenaScreen onSolicitarRecuperacionApi={onSolicitarRecuperacionApi} />
      );

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'usuario_invalido@' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('recuperar-submit'));
      });

      expect(onSolicitarRecuperacionApi).not.toHaveBeenCalled();
      expect(screen.getByTestId('error-correo').textContent).toBe(
        'Ingresa un correo electrónico válido.'
      );
    });

    it('al recibir HTTP 400 por campo email del backend lo muestra bajo el input', async () => {
      const onSolicitarRecuperacionApi = vi.fn().mockRejectedValue(
        new AuthError('Correo no aceptado', 400, {
          campos: { email: ['Introduzca una dirección de correo electrónico válida.'] },
        })
      );

      render(
        <RecuperarContrasenaScreen onSolicitarRecuperacionApi={onSolicitarRecuperacionApi} />
      );

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'test@dominio.cl' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('recuperar-submit'));
      });

      expect(screen.getByTestId('error-correo').textContent).toBe(
        'Introduzca una dirección de correo electrónico válida.'
      );
      expect(screen.queryByTestId('pantalla-recuperar-confirmacion')).toBeNull();
    });

    it('modificar el correo limpia reactivamente el error visible', async () => {
      render(<RecuperarContrasenaScreen />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('recuperar-submit'));
      });

      expect(screen.getByTestId('error-correo')).toBeTruthy();

      await act(async () => {
        fireEvent.change(screen.getByTestId('input-correo'), {
          target: { value: 'nuevo@correo.cl' },
        });
      });

      expect(screen.queryByTestId('error-correo')).toBeNull();
    });

    it('previene envíos concurrentes mientras la petición está en vuelo', async () => {
      let resolverPeticion: (val: any) => void = () => {};
      const promesaLenta = new Promise((resolve) => {
        resolverPeticion = resolve;
      });

      const onSolicitarRecuperacionApi = vi.fn().mockReturnValue(promesaLenta);

      render(
        <RecuperarContrasenaScreen onSolicitarRecuperacionApi={onSolicitarRecuperacionApi} />
      );

      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'lento@correo.cl' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('recuperar-submit'));
        fireEvent.click(screen.getByTestId('recuperar-submit'));
      });

      expect(onSolicitarRecuperacionApi).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolverPeticion(RESPUESTA_NEUTRA);
      });

      expect(screen.getByTestId('pantalla-recuperar-confirmacion')).toBeTruthy();
    });
  });

  describe('Interacciones en Vista de Confirmación', () => {
    it('al presionar "Usar otro correo" regresa al formulario editable', async () => {
      render(
        <RecuperarContrasenaScreen
          enviadoInicial={true}
          correoInicial="anterior@ojoalgasto.cl"
        />
      );

      expect(screen.getByTestId('pantalla-recuperar-confirmacion')).toBeTruthy();

      fireEvent.click(screen.getByTestId('btn-usar-otro-correo'));

      expect(screen.queryByTestId('pantalla-recuperar-confirmacion')).toBeNull();
      expect(screen.getByTestId('input-correo')).toBeTruthy();
      expect((screen.getByTestId('input-correo') as HTMLInputElement).value).toBe(
        'anterior@ojoalgasto.cl'
      );
    });

    it('al presionar "Volver a Iniciar Sesión" navega a Login', () => {
      const navigation = {
        navigate: vi.fn(),
        goBack: vi.fn(),
      } as unknown as RecuperarContrasenaScreenPropsContainer['navigation'];

      render(
        <RecuperarContrasenaConfirmacionView
          email="test@ojoalgasto.cl"
          onUsarOtroCorreo={vi.fn()}
          onNavegarLogin={() => navigation?.navigate('Login')}
        />
      );

      fireEvent.click(screen.getByTestId('go-login'));
      expect(navigation?.navigate).toHaveBeenCalledWith('Login');
    });

    it('el retroceso físico de Android (BackHandler) desde confirmación regresa al formulario', async () => {
      const listeners: Array<() => boolean> = [];
      const addEventListenerSpy = vi
        .spyOn(BackHandler, 'addEventListener')
        .mockImplementation(((evento: string, handler: () => boolean) => {
          if (evento === 'hardwareBackPress') {
            listeners.push(handler);
          }
          return {
            remove: vi.fn(() => {
              const idx = listeners.indexOf(handler);
              if (idx >= 0) listeners.splice(idx, 1);
            }),
          };
        }) as any);

      render(<RecuperarContrasenaScreen enviadoInicial={true} correoInicial="back@test.cl" />);

      expect(screen.getByTestId('pantalla-recuperar-confirmacion')).toBeTruthy();
      expect(listeners.length).toBeGreaterThan(0);

      // Disparar botón físico de atrás
      let interceptado = false;
      await act(async () => {
        interceptado = listeners[listeners.length - 1]();
      });

      expect(interceptado).toBe(true);
      expect(screen.queryByTestId('pantalla-recuperar-confirmacion')).toBeNull();
      expect(screen.getByTestId('input-correo')).toBeTruthy();

      addEventListenerSpy.mockRestore();
    });
  });
});
