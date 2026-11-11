// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BackHandler } from 'react-native';
import CuentaCreadaScreen, {
  CuentaCreadaView,
  type CuentaCreadaScreenPropsContainer,
  type DatosCuentaConfirmada,
} from './CuentaCreadaScreen';
import { obtenerAccessToken } from '@ojoalgasto/shared';

describe('Confirmación de Cuenta Creada (SE-13)', () => {
  const CUENTA_EJEMPLO: DatosCuentaConfirmada = {
    nombre: 'Sebastian Mena',
    email: 'sebastian@ojoalgasto.cl',
  };

  describe('Componente Presentacional CuentaCreadaView', () => {
    it('renderiza encabezado, icono de éxito, nombre del usuario, correo y botones de acción', () => {
      const onContinuarLogin = vi.fn();
      const onVolver = vi.fn();

      render(
        <CuentaCreadaView
          cuenta={CUENTA_EJEMPLO}
          onContinuarLogin={onContinuarLogin}
          onVolver={onVolver}
        />
      );

      // Contenedor principal con rol de accesibilidad
      const pantalla = screen.getByTestId('pantalla-cuenta-creada');
      expect(pantalla).toBeTruthy();
      expect(pantalla.getAttribute('role')).toBe('alert');

      // Elementos visuales
      expect(screen.getByTestId('cuenta-creada-icono')).toBeTruthy();
      expect(screen.getByText('✓')).toBeTruthy();
      expect(screen.getByTestId('cuenta-creada-titulo').textContent).toBe(
        '¡Cuenta creada exitosamente!'
      );
      expect(screen.getByTestId('cuenta-creada-nombre').textContent).toContain(
        'Sebastian Mena'
      );
      expect(screen.getByTestId('cuenta-creada-email').textContent).toBe(
        'sebastian@ojoalgasto.cl'
      );

      // Botones de acción
      expect(screen.getByTestId('btn-continuar-login')).toBeTruthy();
      expect(screen.getByTestId('btn-volver-login')).toBeTruthy();
    });

    it('al pulsar Continuar a Iniciar Sesión invoca onContinuarLogin', () => {
      const onContinuarLogin = vi.fn();

      render(
        <CuentaCreadaView
          cuenta={CUENTA_EJEMPLO}
          onContinuarLogin={onContinuarLogin}
        />
      );

      fireEvent.click(screen.getByTestId('btn-continuar-login'));
      expect(onContinuarLogin).toHaveBeenCalledTimes(1);
    });

    it('al pulsar Volver invoca onVolver', () => {
      const onContinuarLogin = vi.fn();
      const onVolver = vi.fn();

      render(
        <CuentaCreadaView
          cuenta={CUENTA_EJEMPLO}
          onContinuarLogin={onContinuarLogin}
          onVolver={onVolver}
        />
      );

      fireEvent.click(screen.getByTestId('btn-volver-login'));
      expect(onVolver).toHaveBeenCalledTimes(1);
      expect(onContinuarLogin).not.toHaveBeenCalled();
    });

    it('utiliza fallback seguro si el nombre de usuario viene vacío', () => {
      render(
        <CuentaCreadaView
          cuenta={{ nombre: '', email: 'sin_nombre@ojoalgasto.cl' }}
          onContinuarLogin={vi.fn()}
        />
      );

      expect(screen.getByTestId('cuenta-creada-nombre').textContent).toContain('Usuario');
      expect(screen.getByTestId('cuenta-creada-email').textContent).toBe(
        'sin_nombre@ojoalgasto.cl'
      );
    });
  });

  describe('Contenedor CuentaCreadaScreen conectado a React Navigation', () => {
    it('navega a Login al pulsar Continuar a Iniciar Sesión usando navigation.navigate', () => {
      const navigation = {
        navigate: vi.fn(),
        goBack: vi.fn(),
      } as unknown as CuentaCreadaScreenPropsContainer['navigation'];

      render(
        <CuentaCreadaScreen
          navigation={navigation}
          cuenta={CUENTA_EJEMPLO}
        />
      );

      fireEvent.click(screen.getByTestId('btn-continuar-login'));
      expect(navigation?.navigate).toHaveBeenCalledWith('Login');
    });

    it('navega a Login al pulsar el botón Volver', () => {
      const navigation = {
        navigate: vi.fn(),
        goBack: vi.fn(),
      } as unknown as CuentaCreadaScreenPropsContainer['navigation'];

      render(
        <CuentaCreadaScreen
          navigation={navigation}
          cuenta={CUENTA_EJEMPLO}
        />
      );

      fireEvent.click(screen.getByTestId('btn-volver-login'));
      expect(navigation?.navigate).toHaveBeenCalledWith('Login');
    });

    it('toma los datos de la cuenta desde route.params si no vienen por props', () => {
      const route = {
        params: {
          nombre: 'Camila Reyes',
          email: 'camila@ojoalgasto.cl',
        },
      } as unknown as CuentaCreadaScreenPropsContainer['route'];

      render(<CuentaCreadaScreen route={route} />);

      expect(screen.getByTestId('cuenta-creada-nombre').textContent).toContain('Camila Reyes');
      expect(screen.getByTestId('cuenta-creada-email').textContent).toBe('camila@ojoalgasto.cl');
    });

    it('registra el listener de BackHandler para que el botón físico atrás redirija a Login', () => {
      const addEventListenerSpy = vi.spyOn(BackHandler, 'addEventListener');
      const navigation = {
        navigate: vi.fn(),
        goBack: vi.fn(),
      } as unknown as CuentaCreadaScreenPropsContainer['navigation'];

      const { unmount } = render(
        <CuentaCreadaScreen
          navigation={navigation}
          cuenta={CUENTA_EJEMPLO}
        />
      );

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'hardwareBackPress',
        expect.any(Function)
      );

      unmount();
      addEventListenerSpy.mockRestore();
    });
  });

  describe('Criterio de Aceptación: Evitar crear sesión ficticia si register no emite tokens', () => {
    it('no guarda ningún token en almacenamiento de sesión tras mostrar la confirmación', () => {
      render(
        <CuentaCreadaView
          cuenta={CUENTA_EJEMPLO}
          onContinuarLogin={vi.fn()}
        />
      );

      // No debe existir ningún access token en el almacenamiento
      expect(obtenerAccessToken()).toBeNull();
    });
  });
});
