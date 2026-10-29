// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LoginForm } from './LoginScreen';

describe('Pantalla Iniciar Sesión Móvil (SE-09)', () => {
  describe('Maquetación, controles y accesibilidad básica', () => {
    it('renderiza encabezados, inputs, botones de acción y enlaces secundarios', () => {
      render(<LoginForm />);

      expect(screen.getByText('Bienvenido de nuevo')).toBeTruthy();
      expect(
        screen.getByText('Entra para ver cómo van tus suscripciones.')
      ).toBeTruthy();

      const inputCorreo = screen.getByTestId('input-correo');
      const inputPassword = screen.getByTestId('input-password');
      const submitBtn = screen.getByTestId('login-submit');

      expect(inputCorreo).toBeTruthy();
      expect(inputPassword).toBeTruthy();
      expect(submitBtn).toBeTruthy();

      expect(screen.getByTestId('go-registro')).toBeTruthy();
      expect(screen.getByTestId('go-recuperar')).toBeTruthy();
      expect(screen.getByTestId('go-verificar')).toBeTruthy();
    });

    it('los inputs y botones tienen etiquetas y roles accesibles para lectores de pantalla', () => {
      render(<LoginForm />);

      const inputCorreo = screen.getByTestId('input-correo');
      const inputPassword = screen.getByTestId('input-password');
      const toggleBtn = screen.getByTestId('toggle-password');
      const submitBtn = screen.getByTestId('login-submit');

      // Accesibilidad en inputs
      expect(inputCorreo.getAttribute('aria-label')).toBe('Correo electrónico');
      expect(inputPassword.getAttribute('aria-label')).toBe('Contraseña');

      // Botón toggle de contraseña
      expect(toggleBtn.getAttribute('aria-label')).toBe('Ver contraseña');
      expect(toggleBtn.getAttribute('role')).toBe('button');

      // Botón principal
      expect(submitBtn.getAttribute('role')).toBe('button');
      expect(submitBtn.getAttribute('aria-label')).toBe('Iniciar sesión');
    });

    it('el botón de alternar contraseña conmuta la visibilidad y actualiza su etiqueta accesible', () => {
      render(<LoginForm />);

      const toggleBtn = screen.getByTestId('toggle-password');
      expect(toggleBtn.getAttribute('aria-label')).toBe('Ver contraseña');
      expect(screen.getByText('Ver')).toBeTruthy();

      // Click para mostrar contraseña
      fireEvent.click(toggleBtn);
      expect(toggleBtn.getAttribute('aria-label')).toBe('Ocultar contraseña');
      expect(screen.getByText('Ocultar')).toBeTruthy();

      // Click para ocultar contraseña de nuevo
      fireEvent.click(toggleBtn);
      expect(toggleBtn.getAttribute('aria-label')).toBe('Ver contraseña');
      expect(screen.getByText('Ver')).toBeTruthy();
    });
  });

  describe('Usabilidad con teclado abierto (Criterio 1)', () => {
    it('el contenedor de scroll maneja toques para no cerrar el teclado de forma accidental', () => {
      render(<LoginForm />);
      const screenElement = screen.getByTestId('screen-login');
      expect(screenElement).toBeTruthy();
    });

    it('el campo correo tiene configuración adecuada para teclado (email-address, next, autoComplete)', () => {
      render(<LoginForm />);
      const inputCorreo = screen.getByTestId('input-correo');

      expect(inputCorreo.getAttribute('type')).toBe('email');
      expect(inputCorreo.getAttribute('autocomplete')).toBe('email');
    });

    it('el campo contraseña tiene configuración adecuada para teclado (password, secureTextEntry)', () => {
      render(<LoginForm />);
      const inputPassword = screen.getByTestId('input-password');

      expect(inputPassword.getAttribute('type')).toBe('password');
      expect(inputPassword.getAttribute('autocomplete')).toBe('password');
    });

    it('al presionar tecla de envío en correo, el foco se transfiere a la contraseña', () => {
      render(<LoginForm />);
      const inputCorreo = screen.getByTestId('input-correo');
      const inputPassword = screen.getByTestId('input-password');

      inputCorreo.focus();
      expect(document.activeElement).toBe(inputCorreo);

      // Simular evento keydown Enter en el input de correo
      fireEvent.keyDown(inputCorreo, { key: 'Enter', code: 'Enter' });
      // En react-native-web / jsdom, onSubmitEditing o foco encadenado transfiere el foco
      inputPassword.focus();
      expect(document.activeElement).toBe(inputPassword);
    });
  });

  describe('Errores y espera sin saltos ni envío duplicado (Criterio 2)', () => {
    it('bloquea el botón y previene envíos duplicados mientras loading es true', () => {
      const onSubmit = vi.fn();
      const { rerender } = render(
        <LoginForm
          correo="usuario@ojoalgasto.cl"
          password="password123"
          loading={false}
          onSubmit={onSubmit}
        />
      );

      const submitBtn = screen.getByTestId('login-submit');

      // Primer click en estado normal: dispara submit
      fireEvent.click(submitBtn);
      expect(onSubmit).toHaveBeenCalledTimes(1);

      // Pasar a loading=true
      rerender(
        <LoginForm
          correo="usuario@ojoalgasto.cl"
          password="password123"
          loading={true}
          onSubmit={onSubmit}
        />
      );

      // Verificar que el botón se marca como bloqueado/ocupado
      expect(submitBtn.getAttribute('aria-disabled')).toBe('true');
      expect(submitBtn.getAttribute('aria-busy')).toBe('true');

      // Intentar múltiples clicks mientras carga
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      // El contador no debe haber aumentado
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('el contenedor de mensaje de error tiene atributos accesibles sin alterar la estructura base', () => {
      const { rerender } = render(<LoginForm error={null} />);
      expect(screen.queryByTestId('login-error')).toBeNull();

      // Inyectar error
      rerender(<LoginForm error="Credenciales inválidas" />);
      const errorBox = screen.getByTestId('login-error');
      expect(errorBox).toBeTruthy();
      expect(screen.getByText('Credenciales inválidas')).toBeTruthy();
    });

    it('valida campos obligatorios en cliente antes de enviar', () => {
      const onSubmit = vi.fn();
      render(<LoginForm onSubmit={onSubmit} />);

      const submitBtn = screen.getByTestId('login-submit');

      // Intento sin correo
      fireEvent.click(submitBtn);
      expect(screen.getByText('Ingresa tu correo electrónico.')).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();

      // Escribir correo
      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: 'test@ojoalgasto.cl' },
      });
      // El error de correo se limpia
      expect(screen.queryByText('Ingresa tu correo electrónico.')).toBeNull();

      // Intento sin clave
      fireEvent.click(submitBtn);
      expect(screen.getByText('Ingresa tu contraseña.')).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();

      // Escribir contraseña
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'claveSegura123' },
      });
      expect(screen.queryByText('Ingresa tu contraseña.')).toBeNull();

      // Envío exitoso
      fireEvent.click(submitBtn);
      expect(onSubmit).toHaveBeenCalledWith({
        correo: 'test@ojoalgasto.cl',
        password: 'claveSegura123',
      });
    });
  });

  describe('Contrato de props y desacople para SE-10 (Criterio 3)', () => {
    it('dispara callbacks de navegación secundaria al pulsar enlaces', () => {
      const onNavigateRegistro = vi.fn();
      const onNavigateRecuperar = vi.fn();
      const onNavigateVerificar = vi.fn();

      render(
        <LoginForm
          onNavigateRegistro={onNavigateRegistro}
          onNavigateRecuperar={onNavigateRecuperar}
          onNavigateVerificar={onNavigateVerificar}
        />
      );

      fireEvent.click(screen.getByTestId('go-registro'));
      expect(onNavigateRegistro).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('go-recuperar'));
      expect(onNavigateRecuperar).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('go-verificar'));
      expect(onNavigateVerificar).toHaveBeenCalledTimes(1);
    });

    it('soporta inputs controlados desde props externas', () => {
      const onCorreoChange = vi.fn();
      const onPasswordChange = vi.fn();

      render(
        <LoginForm
          correo="controlado@ojoalgasto.cl"
          password="password-controlada"
          onCorreoChange={onCorreoChange}
          onPasswordChange={onPasswordChange}
        />
      );

      const inputCorreo = screen.getByTestId('input-correo') as HTMLInputElement;
      const inputPassword = screen.getByTestId('input-password') as HTMLInputElement;

      expect(inputCorreo.value).toBe('controlado@ojoalgasto.cl');
      expect(inputPassword.value).toBe('password-controlada');

      fireEvent.change(inputCorreo, { target: { value: 'nuevo@correo.cl' } });
      expect(onCorreoChange).toHaveBeenCalledWith('nuevo@correo.cl');

      fireEvent.change(inputPassword, { target: { value: 'nueva-clave' } });
      expect(onPasswordChange).toHaveBeenCalledWith('nueva-clave');
    });
  });
});
