// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RegistroScreen, {
  RegistroForm,
  type RegistroScreenPropsContainer,
} from './RegistroScreen';

describe('Pantalla Móvil Registro (SE-11)', () => {
  describe('Maquetación, controles y accesibilidad básica', () => {
    it('renderiza encabezados, campos obligatorios, checkbox y botones de acción', () => {
      render(<RegistroForm />);

      // Título y descripción
      expect(screen.getByTestId('registro-titulo')).toBeTruthy();
      expect(screen.getByText('Registro de Cuenta')).toBeTruthy();
      expect(
        screen.getByText('Crea tu cuenta para comenzar a organizar tus suscripciones.')
      ).toBeTruthy();

      // Campos de entrada
      expect(screen.getByTestId('input-nombre')).toBeTruthy();
      expect(screen.getByTestId('input-correo')).toBeTruthy();
      expect(screen.getByTestId('input-password')).toBeTruthy();
      expect(screen.getByTestId('input-confirmacion')).toBeTruthy();

      // Control de consentimiento
      expect(screen.getByTestId('checkbox-acepta-datos')).toBeTruthy();
      expect(
        screen.getByText(
          'Acepto los términos y condiciones y el uso de mis datos para calcular mi gasto.'
        )
      ).toBeTruthy();

      // Botón principal y enlaces
      expect(screen.getByTestId('registro-submit')).toBeTruthy();
      expect(screen.getByTestId('go-login')).toBeTruthy();
      expect(screen.getByTestId('go-back')).toBeTruthy();
    });

    it('los inputs y botones tienen etiquetas y roles accesibles', () => {
      render(<RegistroForm />);

      const inputNombre = screen.getByTestId('input-nombre');
      const inputCorreo = screen.getByTestId('input-correo');
      const inputPassword = screen.getByTestId('input-password');
      const inputConfirmacion = screen.getByTestId('input-confirmacion');
      const checkboxConsentimiento = screen.getByTestId('checkbox-acepta-datos');
      const submitBtn = screen.getByTestId('registro-submit');

      // Etiquetas accesibles para lectores de pantalla
      expect(inputNombre.getAttribute('aria-label')).toBe('Nombre completo');
      expect(inputCorreo.getAttribute('aria-label')).toBe('Correo electrónico');
      expect(inputPassword.getAttribute('aria-label')).toBe('Contraseña');
      expect(inputConfirmacion.getAttribute('aria-label')).toBe('Confirmar contraseña');

      // Rol de accesibilidad del checkbox
      expect(checkboxConsentimiento.getAttribute('role')).toBe('checkbox');
      expect(checkboxConsentimiento.getAttribute('aria-label')).toBe(
        'Acepto los términos y condiciones y el uso de mis datos para calcular mi gasto'
      );

      // Botón principal
      expect(submitBtn.getAttribute('role')).toBe('button');
    });

    it('los botones de alternar contraseñas funcionan independientemente con etiquetas accesibles', () => {
      render(<RegistroForm />);

      const togglePass = screen.getByTestId('toggle-password');
      const toggleConfirm = screen.getByTestId('toggle-confirmacion');

      expect(togglePass.getAttribute('aria-label')).toBe('Ver contraseña');
      expect(toggleConfirm.getAttribute('aria-label')).toBe(
        'Ver confirmación de contraseña'
      );

      // Conmutar contraseña principal
      fireEvent.click(togglePass);
      expect(togglePass.getAttribute('aria-label')).toBe('Ocultar contraseña');
      expect(toggleConfirm.getAttribute('aria-label')).toBe(
        'Ver confirmación de contraseña'
      );

      // Conmutar confirmación
      fireEvent.click(toggleConfirm);
      expect(toggleConfirm.getAttribute('aria-label')).toBe(
        'Ocultar confirmación de contraseña'
      );
    });
  });

  describe('Criterio de Aceptación: Consentimiento NO está premarcado', () => {
    it('el consentimiento inicia desmarcado (false) por defecto', () => {
      render(<RegistroForm />);

      const checkbox = screen.getByTestId('checkbox-acepta-datos');
      // aria-checked debe ser false inicialmente
      expect(checkbox.getAttribute('aria-checked')).toBe('false');
      // No debe contener el símbolo de check
      expect(screen.queryByText('✓')).toBeNull();
    });

    it('permite alternar el consentimiento al pulsar el checkbox', () => {
      render(<RegistroForm />);

      const checkbox = screen.getByTestId('checkbox-acepta-datos');

      // Pulsar para marcar
      fireEvent.click(checkbox);
      expect(checkbox.getAttribute('aria-checked')).toBe('true');
      expect(screen.getByText('✓')).toBeTruthy();

      // Pulsar para desmarcar
      fireEvent.click(checkbox);
      expect(checkbox.getAttribute('aria-checked')).toBe('false');
      expect(screen.queryByText('✓')).toBeNull();
    });
  });

  describe('Criterio de Aceptación: Validación con política común de shared y errores por campo', () => {
    it('al presionar Crear Cuenta vacío despliega errores específicos bajo cada campo', () => {
      const onSubmit = vi.fn();
      render(<RegistroForm onSubmit={onSubmit} />);

      fireEvent.click(screen.getByTestId('registro-submit'));

      // No debe llamar a onSubmit
      expect(onSubmit).not.toHaveBeenCalled();

      // Mensajes específicos por campo según política común de @ojoalgasto/shared
      expect(screen.getByTestId('error-nombre').textContent).toBe('Ingresa tu nombre.');
      expect(screen.getByTestId('error-correo').textContent).toBe(
        'Ingresa tu correo electrónico.'
      );
      expect(screen.getByTestId('error-password').textContent).toBe(
        'La contraseña debe tener al menos 8 caracteres, una letra y un número.'
      );
      expect(screen.getByTestId('error-confirmacion').textContent).toBe(
        'Repite la contraseña.'
      );
      expect(screen.getByTestId('error-acepta-datos').textContent).toBe(
        'Debes aceptar el tratamiento de tus datos.'
      );
    });

    it('valida que las contraseñas coincidan exactamente', () => {
      const onSubmit = vi.fn();
      render(<RegistroForm onSubmit={onSubmit} />);

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Sebastian Mena' },
      });
      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'sebastian@ojoalgasto.cl' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'PasswordSegura1' },
      });
      fireEvent.change(screen.getByTestId('input-confirmacion'), {
        target: { value: 'PasswordDistinta2' },
      });
      fireEvent.click(screen.getByTestId('checkbox-acepta-datos'));

      fireEvent.click(screen.getByTestId('registro-submit'));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.queryByTestId('error-nombre')).toBeNull();
      expect(screen.queryByTestId('error-correo')).toBeNull();
      expect(screen.queryByTestId('error-password')).toBeNull();
      expect(screen.queryByTestId('error-acepta-datos')).toBeNull();
      expect(screen.getByTestId('error-confirmacion').textContent).toBe(
        'Las contraseñas no coinciden.'
      );
    });

    it('valida requisitos mínimos de contraseña segura (8 caracteres, letra y número)', () => {
      const onSubmit = vi.fn();
      render(<RegistroForm onSubmit={onSubmit} />);

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Sebastian' },
      });
      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'seba@test.cl' },
      });
      // Solo 5 caracteres
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'corta' },
      });
      fireEvent.change(screen.getByTestId('input-confirmacion'), {
        target: { value: 'corta' },
      });
      fireEvent.click(screen.getByTestId('checkbox-acepta-datos'));

      fireEvent.click(screen.getByTestId('registro-submit'));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByTestId('error-password').textContent).toBe(
        'La contraseña debe tener al menos 8 caracteres, una letra y un número.'
      );
    });

    it('limpia el error de un campo individual al editar su texto', () => {
      render(<RegistroForm />);

      // Provocar errores
      fireEvent.click(screen.getByTestId('registro-submit'));
      expect(screen.getByTestId('error-nombre')).toBeTruthy();
      expect(screen.getByTestId('error-correo')).toBeTruthy();

      // Modificar el nombre: solo limpia el error de nombre
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: 'Sebastián' },
      });
      expect(screen.queryByTestId('error-nombre')).toBeNull();
      // El error de correo se mantiene
      expect(screen.getByTestId('error-correo')).toBeTruthy();
    });

    it('ejecuta onSubmit con los datos limpios si todo es válido', () => {
      const onSubmit = vi.fn();
      render(<RegistroForm onSubmit={onSubmit} />);

      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: '  Sebastian Mena  ' },
      });
      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: '  seba@ojoalgasto.cl  ' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'ClaveSegura123' },
      });
      fireEvent.change(screen.getByTestId('input-confirmacion'), {
        target: { value: 'ClaveSegura123' },
      });
      fireEvent.click(screen.getByTestId('checkbox-acepta-datos'));

      fireEvent.click(screen.getByTestId('registro-submit'));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        nombre: 'Sebastian Mena',
        correo: 'seba@ojoalgasto.cl',
        password: 'ClaveSegura123',
        confirmacion: 'ClaveSegura123',
        aceptaDatos: true,
      });
    });
  });

  describe('Criterio de Aceptación: Estado ocupado y deshabilitación', () => {
    it('cuando cargando es true, muestra estado de carga y bloquea el envío', () => {
      const onSubmit = vi.fn();
      render(<RegistroForm cargando={true} onSubmit={onSubmit} />);

      const submitBtn = screen.getByTestId('registro-submit');
      expect(submitBtn.getAttribute('aria-label')).toBe('Creando cuenta…');
      expect(submitBtn.getAttribute('aria-busy')).toBe('true');
      expect(submitBtn.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByText('Cargando…')).toBeTruthy();

      fireEvent.click(submitBtn);

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('renderiza mensaje de error general del servidor cuando se le proporciona', () => {
      render(
        <RegistroForm
          errorGeneral="No se pudo conectar con el servidor. Intenta de nuevo en un momento."
        />
      );

      const generalBox = screen.getByTestId('registro-error-general');
      expect(generalBox).toBeTruthy();
      expect(
        screen.getByText(
          'No se pudo conectar con el servidor. Intenta de nuevo en un momento.'
        )
      ).toBeTruthy();
    });
  });

  describe('Navegación y ruteo público', () => {
    it('el botón Ya tengo cuenta invoca onNavegarLogin', () => {
      const onNavegarLogin = vi.fn();
      render(<RegistroForm onNavegarLogin={onNavegarLogin} />);

      fireEvent.click(screen.getByTestId('go-login'));
      expect(onNavegarLogin).toHaveBeenCalledTimes(1);
    });

    it('el botón Volver invoca onVolver', () => {
      const onVolver = vi.fn();
      render(<RegistroForm onVolver={onVolver} />);

      fireEvent.click(screen.getByTestId('go-back'));
      expect(onVolver).toHaveBeenCalledTimes(1);
    });

    it('el contenedor RegistroScreen conecta con la navegación nativa de React Navigation', () => {
      const navigation = {
        navigate: vi.fn(),
        goBack: vi.fn(),
      } as unknown as RegistroScreenPropsContainer['navigation'];

      render(<RegistroScreen navigation={navigation} />);

      fireEvent.click(screen.getByTestId('go-login'));
      expect(navigation?.navigate).toHaveBeenCalledWith('Login');

      fireEvent.click(screen.getByTestId('go-back'));
      expect(navigation?.goBack).toHaveBeenCalledTimes(1);
    });
  });
});
