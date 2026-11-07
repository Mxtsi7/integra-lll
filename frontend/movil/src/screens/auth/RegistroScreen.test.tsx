// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthError } from '@ojoalgasto/shared';
import RegistroScreen, {
  RegistroForm,
  type RegistroScreenPropsContainer,
} from './RegistroScreen';
import { MENSAJE_ERROR_RED } from '../../services/clienteHttp';

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

  describe('Conectar Registro móvil y validaciones del servidor (SE-12)', () => {
    function llenarFormularioValido({
      nombre = 'Sebastian Mena',
      correo = 'seba@ojoalgasto.cl',
      password = 'PasswordSegura123',
      confirmacion = 'PasswordSegura123',
      marcarConsentimiento = true,
    }: {
      nombre?: string;
      correo?: string;
      password?: string;
      confirmacion?: string;
      marcarConsentimiento?: boolean;
    } = {}) {
      fireEvent.change(screen.getByTestId('input-nombre'), {
        target: { value: nombre },
      });
      fireEvent.change(screen.getByTestId('input-correo'), {
        target: { value: correo },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: password },
      });
      fireEvent.change(screen.getByTestId('input-confirmacion'), {
        target: { value: confirmacion },
      });
      if (marcarConsentimiento) {
        fireEvent.click(screen.getByTestId('checkbox-acepta-datos'));
      }
    }

    describe('Criterio de Aceptación: Registro válido crea cuenta una sola vez', () => {
      it('envía los datos limpios a la API con mapeo de campos (email y acepta_datos)', async () => {
        const onRegisterApi = vi.fn().mockResolvedValue({
          id: 'usr-123',
          email: 'seba@ojoalgasto.cl',
          nombre: 'Sebastian Mena',
        });
        const onRegistroExitoso = vi.fn();

        render(
          <RegistroScreen
            onRegisterApi={onRegisterApi}
            onRegistroExitoso={onRegistroExitoso}
          />
        );

        llenarFormularioValido({
          nombre: '  Sebastian Mena  ',
          correo: '  seba@ojoalgasto.cl  ',
          password: 'PasswordSegura123',
          confirmacion: 'PasswordSegura123',
        });

        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        expect(onRegisterApi).toHaveBeenCalledTimes(1);
        expect(onRegisterApi).toHaveBeenCalledWith({
          nombre: 'Sebastian Mena',
          correo: 'seba@ojoalgasto.cl',
          password: 'PasswordSegura123',
          aceptaDatos: true,
          codigoOrganizacion: undefined,
        });

        expect(onRegistroExitoso).toHaveBeenCalledTimes(1);
        expect(onRegistroExitoso).toHaveBeenCalledWith({
          id: 'usr-123',
          email: 'seba@ojoalgasto.cl',
          nombre: 'Sebastian Mena',
        });
      });

      it('navega a Login por defecto tras registro exitoso si no se proveyó callback', async () => {
        const onRegisterApi = vi.fn().mockResolvedValue({
          id: 'usr-456',
          email: 'nuevo@ojoalgasto.cl',
          nombre: 'Nuevo Usuario',
        });
        const navigation = {
          navigate: vi.fn(),
          goBack: vi.fn(),
        } as unknown as RegistroScreenPropsContainer['navigation'];

        render(
          <RegistroScreen
            navigation={navigation}
            onRegisterApi={onRegisterApi}
          />
        );

        llenarFormularioValido({
          nombre: 'Nuevo Usuario',
          correo: 'nuevo@ojoalgasto.cl',
        });

        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        expect(onRegisterApi).toHaveBeenCalledTimes(1);
        expect(navigation?.navigate).toHaveBeenCalledWith('Login');
      });

      it('previene envíos duplicados mientras la petición está en vuelo (crea la cuenta una sola vez)', async () => {
        let resolverPeticion: (val: any) => void = () => {};
        const promesaDemorada = new Promise((resolve) => {
          resolverPeticion = resolve;
        });

        const onRegisterApi = vi.fn().mockImplementation(() => promesaDemorada);
        const onRegistroExitoso = vi.fn();

        render(
          <RegistroScreen
            onRegisterApi={onRegisterApi}
            onRegistroExitoso={onRegistroExitoso}
          />
        );

        llenarFormularioValido();

        // Primer envío: arranca la petición
        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        expect(onRegisterApi).toHaveBeenCalledTimes(1);

        // Intentar pulsar repetidamente mientras está cargando
        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        // La API no debe ser invocada nuevamente
        expect(onRegisterApi).toHaveBeenCalledTimes(1);

        // Completar la promesa
        await act(async () => {
          resolverPeticion({ id: 'usr-999', email: 'seba@ojoalgasto.cl', nombre: 'Sebastian' });
        });

        expect(onRegistroExitoso).toHaveBeenCalledTimes(1);
      });

      it('adapta e incluye codigoOrganizacion si viene por props o por route.params', async () => {
        const onRegisterApi = vi.fn().mockResolvedValue({
          id: 'usr-org-1',
          email: 'miembro@empresa.cl',
          nombre: 'Miembro Org',
        });

        render(
          <RegistroScreen
            codigoOrganizacion="ORG-EMPRESA-2026"
            onRegisterApi={onRegisterApi}
          />
        );

        llenarFormularioValido({
          correo: 'miembro@empresa.cl',
          nombre: 'Miembro Org',
        });

        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        expect(onRegisterApi).toHaveBeenCalledWith(
          expect.objectContaining({
            codigoOrganizacion: 'ORG-EMPRESA-2026',
          })
        );
      });
    });

    describe('Criterio de Aceptación: Rechazo API no navega a éxito y conserva los errores útiles', () => {
      it('si la API rechaza por correo duplicado (DRF: email), no navega a éxito, muestra el error bajo el campo y conserva los datos ingresados', async () => {
        const onRegisterApi = vi.fn().mockRejectedValue(
          new AuthError('user with this email already exists.', 400, {
            campos: {
              email: ['Ya existe un usuario registrado con este correo electrónico.'],
            },
          })
        );
        const onRegistroExitoso = vi.fn();
        const navigation = {
          navigate: vi.fn(),
          goBack: vi.fn(),
        } as unknown as RegistroScreenPropsContainer['navigation'];

        render(
          <RegistroScreen
            navigation={navigation}
            onRegisterApi={onRegisterApi}
            onRegistroExitoso={onRegistroExitoso}
          />
        );

        llenarFormularioValido({
          nombre: 'Sebastian Mena',
          correo: 'duplicado@ojoalgasto.cl',
          password: 'PasswordSegura123',
          confirmacion: 'PasswordSegura123',
        });

        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        // 1. NO navega a éxito
        expect(onRegistroExitoso).not.toHaveBeenCalled();
        expect(navigation?.navigate).not.toHaveBeenCalled();

        // 2. Muestra el error mapeado bajo el campo correo
        const errorCorreo = screen.getByTestId('error-correo');
        expect(errorCorreo.textContent).toBe(
          'Ya existe un usuario registrado con este correo electrónico.'
        );

        // 3. Conserva los datos ingresados en el formulario
        expect((screen.getByTestId('input-nombre') as HTMLInputElement).value).toBe(
          'Sebastian Mena'
        );
        expect((screen.getByTestId('input-correo') as HTMLInputElement).value).toBe(
          'duplicado@ojoalgasto.cl'
        );
        expect((screen.getByTestId('input-password') as HTMLInputElement).value).toBe(
          'PasswordSegura123'
        );
      });

      it('si la API rechaza por contraseña no aceptada por el backend (MX-30), muestra el error bajo contraseña y no navega', async () => {
        const onRegisterApi = vi.fn().mockRejectedValue(
          new AuthError('La contraseña no cumple las reglas del servidor.', 400, {
            campos: {
              password: [
                'La contraseña debe tener al menos 8 caracteres, una letra y un número.',
              ],
            },
          })
        );
        const onRegistroExitoso = vi.fn();

        render(
          <RegistroScreen
            onRegisterApi={onRegisterApi}
            onRegistroExitoso={onRegistroExitoso}
          />
        );

        llenarFormularioValido();

        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        expect(onRegistroExitoso).not.toHaveBeenCalled();
        expect(screen.getByTestId('error-password').textContent).toBe(
          'La contraseña debe tener al menos 8 caracteres, una letra y un número.'
        );
      });

      it('si la API rechaza por código de organización inválido, lo muestra en la caja de error general', async () => {
        const onRegisterApi = vi.fn().mockRejectedValue(
          new AuthError('El código de organización no es válido.', 400, {
            campos: {
              codigo_organizacion: ['El código de organización no es válido.'],
            },
          })
        );
        const onRegistroExitoso = vi.fn();

        render(
          <RegistroScreen
            codigoOrganizacion="CODIGO-INVALIDO"
            onRegisterApi={onRegisterApi}
            onRegistroExitoso={onRegistroExitoso}
          />
        );

        llenarFormularioValido();

        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        expect(onRegistroExitoso).not.toHaveBeenCalled();
        const errorGeneral = screen.getByTestId('registro-error-general');
        expect(errorGeneral).toBeTruthy();
        expect(errorGeneral.textContent).toContain(
          'El código de organización no es válido.'
        );
      });

      it('si la API rechaza por error general (non_field_errors o 400 sin campos), muestra la alerta general', async () => {
        const onRegisterApi = vi.fn().mockRejectedValue(
          new AuthError('No se pudo procesar tu solicitud de registro.', 400, {
            campos: {
              non_field_errors: ['El sistema no permite registros temporales en este momento.'],
            },
          })
        );
        const onRegistroExitoso = vi.fn();

        render(
          <RegistroScreen
            onRegisterApi={onRegisterApi}
            onRegistroExitoso={onRegistroExitoso}
          />
        );

        llenarFormularioValido();

        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        expect(onRegistroExitoso).not.toHaveBeenCalled();
        expect(screen.getByTestId('registro-error-general').textContent).toContain(
          'El sistema no permite registros temporales en este momento.'
        );
      });

      it('si ocurre un fallo de red, no navega y presenta mensaje amigable de conexión', async () => {
        const onRegisterApi = vi.fn().mockRejectedValue(
          new TypeError('Failed to fetch')
        );
        const onRegistroExitoso = vi.fn();

        render(
          <RegistroScreen
            onRegisterApi={onRegisterApi}
            onRegistroExitoso={onRegistroExitoso}
          />
        );

        llenarFormularioValido();

        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        expect(onRegistroExitoso).not.toHaveBeenCalled();
        const errorBox = screen.getByTestId('registro-error-general');
        expect(errorBox.textContent).toBe(MENSAJE_ERROR_RED);
      });

      it('si el servidor responde 500, no navega a éxito y permite reintentar el envío', async () => {
        const onRegisterApi = vi
          .fn()
          .mockRejectedValueOnce(new AuthError('Error interno del servidor (500)', 500))
          .mockResolvedValueOnce({
            id: 'usr-reintento',
            email: 'seba@ojoalgasto.cl',
            nombre: 'Sebastian Mena',
          });
        const onRegistroExitoso = vi.fn();

        render(
          <RegistroScreen
            onRegisterApi={onRegisterApi}
            onRegistroExitoso={onRegistroExitoso}
          />
        );

        llenarFormularioValido();

        // Primer intento falla con 500
        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        expect(onRegistroExitoso).not.toHaveBeenCalled();
        expect(screen.getByTestId('registro-error-general').textContent).toContain(
          'Error interno del servidor (500)'
        );

        // Segundo intento: el servidor se recupera y responde con éxito
        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        expect(onRegisterApi).toHaveBeenCalledTimes(2);
        expect(onRegistroExitoso).toHaveBeenCalledTimes(1);
      });

      it('al editar el campo correo tras un error del servidor, dicho error se limpia reactivamente', async () => {
        const onRegisterApi = vi.fn().mockRejectedValue(
          new AuthError('Correo duplicado', 400, {
            campos: {
              email: ['Este correo ya está en uso.'],
            },
          })
        );

        render(<RegistroScreen onRegisterApi={onRegisterApi} />);

        llenarFormularioValido({ correo: 'repetido@test.cl' });

        await act(async () => {
          fireEvent.click(screen.getByTestId('registro-submit'));
        });

        // Error visible
        expect(screen.getByTestId('error-correo')).toBeTruthy();

        // Editar el correo para corregirlo
        await act(async () => {
          fireEvent.change(screen.getByTestId('input-correo'), {
            target: { value: 'nuevo_correo@test.cl' },
          });
        });

        // El error individual desaparece
        expect(screen.queryByTestId('error-correo')).toBeNull();
      });
    });
  });
});
