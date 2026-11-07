import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  register,
  AuthError,
  validarRegistro,
  erroresRegistroDesdeServidor,
  type CampoRegistro,
  type DatosRegistro,
  type ErroresRegistro,
  type RegisterPayload,
  type RegisterResponse,
} from '@ojoalgasto/shared';
import {
  esErrorDeRed,
  adaptarErrorRed,
  MENSAJE_ERROR_RED,
} from '../../services/clienteHttp';
import { NavButton } from '../components/NavButton';
import type { AuthScreenProps } from '../../navigation/types';
import styles from './RegistroScreen.styles';

export interface RegistroFormProps {
  /** Nombre controlado (opcional) */
  nombre?: string;
  /** Manejador de cambio de nombre */
  onNombreChange?: (nombre: string) => void;
  /** Correo controlado (opcional) */
  correo?: string;
  /** Manejador de cambio de correo */
  onCorreoChange?: (correo: string) => void;
  /** Contraseña controlada (opcional) */
  password?: string;
  /** Manejador de cambio de contraseña */
  onPasswordChange?: (password: string) => void;
  /** Confirmación de contraseña controlada (opcional) */
  confirmacion?: string;
  /** Manejador de cambio de confirmación */
  onConfirmacionChange?: (confirmacion: string) => void;
  /** Estado de consentimiento controlado (opcional, debe inicializarse en false) */
  aceptaDatos?: boolean;
  /** Manejador de cambio de consentimiento */
  onAceptaDatosChange?: (acepta: boolean) => void;
  /** Errores de validación por campo */
  errores?: ErroresRegistro;
  /** Mensaje de error general del servidor o conexión */
  errorGeneral?: string | null;
  /** Notifica cuando se edita un campo para limpiar su error en el contenedor */
  onLimpiarError?: (campo: CampoRegistro) => void;
  /** Estado de carga u ocupado */
  cargando?: boolean;
  /** Deshabilita la interacción con el formulario */
  deshabilitado?: boolean;
  /** Callback al enviar el formulario con datos válidos */
  onSubmit?: (datos: DatosRegistro) => void | Promise<void>;
  /** Navegación a la pantalla de inicio de sesión */
  onNavegarLogin?: () => void;
  /** Navegación de retroceso */
  onVolver?: () => void;
  /** Identificador para pruebas automatizadas */
  testID?: string;
}

/**
 * Componente presentacional puro del formulario de Registro (SE-11).
 * Implementa accesibilidad con teclado, visibilidad de errores por campo,
 * casilla de consentimiento no premarcada y estado ocupado.
 */
export function RegistroForm({
  nombre: propNombre,
  onNombreChange: propOnNombreChange,
  correo: propCorreo,
  onCorreoChange: propOnCorreoChange,
  password: propPassword,
  onPasswordChange: propOnPasswordChange,
  confirmacion: propConfirmacion,
  onConfirmacionChange: propOnConfirmacionChange,
  aceptaDatos: propAceptaDatos,
  onAceptaDatosChange: propOnAceptaDatosChange,
  errores: propErrores,
  errorGeneral,
  onLimpiarError,
  cargando = false,
  deshabilitado = false,
  onSubmit,
  onNavegarLogin,
  onVolver,
  testID = 'screen-registro',
}: RegistroFormProps) {
  // Estados internos para funcionamiento desacoplado
  const [internalNombre, setInternalNombre] = useState('');
  const [internalCorreo, setInternalCorreo] = useState('');
  const [internalPassword, setInternalPassword] = useState('');
  const [internalConfirmacion, setInternalConfirmacion] = useState('');
  // Criterio de aceptación SE-11: El consentimiento NO debe estar premarcado
  const [internalAceptaDatos, setInternalAceptaDatos] = useState(false);
  const [internalErrores, setInternalErrores] = useState<ErroresRegistro>({});
  const [erroresLimpiados, setErroresLimpiados] = useState<Record<string, boolean>>({});
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false);

  // Referencias a los campos para navegación accesible con teclado
  const inputCorreoRef = useRef<TextInput>(null);
  const inputPasswordRef = useRef<TextInput>(null);
  const inputConfirmacionRef = useRef<TextInput>(null);

  // Reiniciar máscara de limpiados al recibir nuevos errores del servidor
  useEffect(() => {
    setErroresLimpiados({});
  }, [propErrores]);

  // Resolución de valores (controlados externamente o internos)
  const valorNombre = propNombre !== undefined ? propNombre : internalNombre;
  const valorCorreo = propCorreo !== undefined ? propCorreo : internalCorreo;
  const valorPassword = propPassword !== undefined ? propPassword : internalPassword;
  const valorConfirmacion =
    propConfirmacion !== undefined ? propConfirmacion : internalConfirmacion;
  const valorAceptaDatos =
    propAceptaDatos !== undefined ? propAceptaDatos : internalAceptaDatos;

  // Los errores visibles descuentan los campos que el usuario ya comenzó a corregir
  const erroresBase = propErrores !== undefined ? propErrores : internalErrores;
  const erroresActivos: ErroresRegistro = {};
  for (const [campo, mensaje] of Object.entries(erroresBase)) {
    if (!erroresLimpiados[campo] && mensaje) {
      erroresActivos[campo as CampoRegistro] = mensaje;
    }
  }

  const estaBloqueado = Boolean(deshabilitado || cargando);

  // Limpieza individual de error al editar un campo
  const limpiarError = (campo: CampoRegistro) => {
    setErroresLimpiados((actuales) => ({ ...actuales, [campo]: true }));
    setInternalErrores((actuales) => {
      if (!actuales[campo]) return actuales;
      const copia = { ...actuales };
      delete copia[campo];
      return copia;
    });
    if (onLimpiarError) {
      onLimpiarError(campo);
    }
  };

  const handleNombreChange = (texto: string) => {
    setInternalNombre(texto);
    if (propOnNombreChange) propOnNombreChange(texto);
    limpiarError('nombre');
  };

  const handleCorreoChange = (texto: string) => {
    setInternalCorreo(texto);
    if (propOnCorreoChange) propOnCorreoChange(texto);
    limpiarError('correo');
  };

  const handlePasswordChange = (texto: string) => {
    setInternalPassword(texto);
    if (propOnPasswordChange) propOnPasswordChange(texto);
    limpiarError('password');
  };

  const handleConfirmacionChange = (texto: string) => {
    setInternalConfirmacion(texto);
    if (propOnConfirmacionChange) propOnConfirmacionChange(texto);
    limpiarError('confirmacion');
  };

  const handleToggleAceptaDatos = () => {
    if (estaBloqueado) return;
    const nuevoValor = !valorAceptaDatos;
    setInternalAceptaDatos(nuevoValor);
    if (propOnAceptaDatosChange) propOnAceptaDatosChange(nuevoValor);
    limpiarError('aceptaDatos');
  };

  const handleSubmit = () => {
    if (estaBloqueado) return;

    // Validación local estricta reutilizando la política común de @ojoalgasto/shared
    const datosParaValidar: DatosRegistro = {
      nombre: valorNombre.trim(),
      correo: valorCorreo.trim(),
      password: valorPassword,
      confirmacion: valorConfirmacion,
      aceptaDatos: valorAceptaDatos,
    };

    const nuevosErrores = validarRegistro(datosParaValidar);

    if (Object.keys(nuevosErrores).length > 0) {
      setErroresLimpiados({});
      setInternalErrores(nuevosErrores);
      return;
    }

    setInternalErrores({});
    if (onSubmit) {
      void onSubmit(datosParaValidar);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoiding}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        testID={testID}
      >
        <View style={styles.card}>
          <Text style={styles.titulo} testID="registro-titulo">
            Registro de Cuenta
          </Text>
          <Text style={styles.subtitulo}>
            Crea tu cuenta para comenzar a organizar tus suscripciones.
          </Text>

          {/* Error general del servidor o de red */}
          {errorGeneral && (
            <View
              style={styles.errorGeneralBox}
              testID="registro-error-general"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.errorGeneralText}>{errorGeneral}</Text>
            </View>
          )}

          {/* Campo: Nombre completo */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Nombre completo</Text>
            <TextInput
              testID="input-nombre"
              style={[styles.input, erroresActivos.nombre && styles.inputErrorBorder]}
              value={valorNombre}
              onChangeText={handleNombreChange}
              placeholder="Cómo quieres que te llamemos"
              placeholderTextColor="#94a3b8"
              autoCapitalize="words"
              autoComplete="name"
              editable={!estaBloqueado}
              returnKeyType="next"
              onSubmitEditing={() => inputCorreoRef.current?.focus()}
              accessibilityLabel="Nombre completo"
              accessibilityHint="Ingresa tu nombre para identificarte en la aplicación"
            />
            {erroresActivos.nombre && (
              <Text
                style={styles.errorCampoText}
                testID="error-nombre"
                accessibilityRole="alert"
              >
                {erroresActivos.nombre}
              </Text>
            )}
          </View>

          {/* Campo: Correo electrónico */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Correo electrónico</Text>
            <TextInput
              ref={inputCorreoRef}
              testID="input-correo"
              style={[styles.input, erroresActivos.correo && styles.inputErrorBorder]}
              value={valorCorreo}
              onChangeText={handleCorreoChange}
              placeholder="tu@correo.cl"
              placeholderTextColor="#94a3b8"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!estaBloqueado}
              returnKeyType="next"
              onSubmitEditing={() => inputPasswordRef.current?.focus()}
              accessibilityLabel="Correo electrónico"
              accessibilityHint="Ingresa una dirección de correo válida"
            />
            {erroresActivos.correo && (
              <Text
                style={styles.errorCampoText}
                testID="error-correo"
                accessibilityRole="alert"
              >
                {erroresActivos.correo}
              </Text>
            )}
          </View>

          {/* Campo: Contraseña */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Contraseña</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                ref={inputPasswordRef}
                testID="input-password"
                style={[
                  styles.input,
                  styles.passwordInput,
                  erroresActivos.password && styles.inputErrorBorder,
                ]}
                value={valorPassword}
                onChangeText={handlePasswordChange}
                placeholder="Mínimo 8 caracteres"
                placeholderTextColor="#94a3b8"
                secureTextEntry={!mostrarPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                autoCorrect={false}
                editable={!estaBloqueado}
                returnKeyType="next"
                onSubmitEditing={() => inputConfirmacionRef.current?.focus()}
                accessibilityLabel="Contraseña"
                accessibilityHint="Mínimo 8 caracteres, con al menos una letra y un número"
              />
              <Pressable
                testID="toggle-password"
                style={styles.eyeButton}
                onPress={() => setMostrarPassword((prev) => !prev)}
                accessibilityRole="button"
                accessibilityLabel={
                  mostrarPassword ? 'Ocultar contraseña' : 'Ver contraseña'
                }
                disabled={estaBloqueado}
              >
                <Text style={styles.eyeButtonText}>
                  {mostrarPassword ? 'Ocultar' : 'Ver'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.ayudaText}>
              Al menos 8 caracteres, con una letra y un número.
            </Text>
            {erroresActivos.password && (
              <Text
                style={styles.errorCampoText}
                testID="error-password"
                accessibilityRole="alert"
              >
                {erroresActivos.password}
              </Text>
            )}
          </View>

          {/* Campo: Repite la contraseña */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Confirmar contraseña</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                ref={inputConfirmacionRef}
                testID="input-confirmacion"
                style={[
                  styles.input,
                  styles.passwordInput,
                  erroresActivos.confirmacion && styles.inputErrorBorder,
                ]}
                value={valorConfirmacion}
                onChangeText={handleConfirmacionChange}
                placeholder="La misma de arriba"
                placeholderTextColor="#94a3b8"
                secureTextEntry={!mostrarConfirmacion}
                autoCapitalize="none"
                autoComplete="new-password"
                autoCorrect={false}
                editable={!estaBloqueado}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                accessibilityLabel="Confirmar contraseña"
                accessibilityHint="Vuelve a escribir la misma contraseña"
              />
              <Pressable
                testID="toggle-confirmacion"
                style={styles.eyeButton}
                onPress={() => setMostrarConfirmacion((prev) => !prev)}
                accessibilityRole="button"
                accessibilityLabel={
                  mostrarConfirmacion
                    ? 'Ocultar confirmación de contraseña'
                    : 'Ver confirmación de contraseña'
                }
                disabled={estaBloqueado}
              >
                <Text style={styles.eyeButtonText}>
                  {mostrarConfirmacion ? 'Ocultar' : 'Ver'}
                </Text>
              </Pressable>
            </View>
            {erroresActivos.confirmacion && (
              <Text
                style={styles.errorCampoText}
                testID="error-confirmacion"
                accessibilityRole="alert"
              >
                {erroresActivos.confirmacion}
              </Text>
            )}
          </View>

          {/* Campo: Consentimiento de tratamiento de datos */}
          <View style={styles.consentimientoContainer}>
            <Pressable
              testID="checkbox-acepta-datos"
              style={styles.checkboxFila}
              onPress={handleToggleAceptaDatos}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: valorAceptaDatos }}
              accessibilityLabel="Acepto los términos y condiciones y el uso de mis datos para calcular mi gasto"
              disabled={estaBloqueado}
            >
              <View
                style={[
                  styles.checkboxCaja,
                  valorAceptaDatos && styles.checkboxCajaMarcada,
                  erroresActivos.aceptaDatos && styles.checkboxErrorBorder,
                ]}
              >
                {valorAceptaDatos && <Text style={styles.checkboxTilde}>✓</Text>}
              </View>
              <Text style={styles.consentimientoTexto}>
                Acepto los términos y condiciones y el uso de mis datos para
                calcular mi gasto.
              </Text>
            </Pressable>
            {erroresActivos.aceptaDatos && (
              <Text
                style={styles.errorCampoText}
                testID="error-acepta-datos"
                accessibilityRole="alert"
              >
                {erroresActivos.aceptaDatos}
              </Text>
            )}
          </View>

          {/* Botón de acción principal: Crear cuenta */}
          <NavButton
            testID="registro-submit"
            title={cargando ? 'Creando cuenta…' : 'Crear Cuenta'}
            variant="primary"
            loading={cargando}
            disabled={estaBloqueado}
            onPress={handleSubmit}
          />

          <View style={styles.divider} />

          {/* Navegación pública alternativa */}
          <View style={styles.linksContainer}>
            <NavButton
              testID="go-login"
              title="Ya tengo cuenta (Iniciar sesión)"
              variant="secondary"
              disabled={estaBloqueado}
              onPress={onNavegarLogin ?? (() => {})}
            />
            <NavButton
              testID="go-back"
              title="Volver"
              variant="secondary"
              disabled={estaBloqueado}
              onPress={onVolver ?? (() => {})}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export interface RegistroScreenPropsContainer {
  navigation?: AuthScreenProps<'Registro'>['navigation'];
  route?: Partial<AuthScreenProps<'Registro'>['route']> & {
    params?: {
      codigoOrganizacion?: string | null;
      [key: string]: unknown;
    };
  };
  /** Función para inyectar cliente de registro en pruebas (por defecto shared register) */
  onRegisterApi?: (payload: RegisterPayload) => Promise<RegisterResponse>;
  /** Callback ejecutado tras crear exitosamente la cuenta (desbloquea SE-13) */
  onRegistroExitoso?: (respuesta: RegisterResponse) => void;
  /** Código de organización opcional si el flujo lo incluye */
  codigoOrganizacion?: string | null;
  /** Sobrescribe onSubmit para pruebas personalizadas o arnés de navegación */
  onSubmit?: (datos: DatosRegistro) => void | Promise<void>;
  /** Permite forzar el estado cargando en pruebas de interfaz */
  cargando?: boolean;
  /** Permite inyectar un error general en pruebas de interfaz */
  errorGeneral?: string | null;
  /** Identificador para pruebas automatizadas */
  testID?: string;
}

/**
 * Contenedor de pantalla conectado a React Navigation y al backend de Auth (SE-11 / SE-12).
 * Conecta con register de @ojoalgasto/shared, mapea errores de DRF y previene envíos duplicados.
 */
export default function RegistroScreen({
  navigation,
  route,
  onRegisterApi = register,
  onRegistroExitoso,
  codigoOrganizacion,
  onSubmit: propOnSubmit,
  cargando: propCargando,
  errorGeneral: propErrorGeneral,
  testID = 'screen-registro',
}: RegistroScreenPropsContainer & Partial<AuthScreenProps<'Registro'>>) {
  const [cargandoInterno, setCargandoInterno] = useState(false);
  const [erroresServidor, setErroresServidor] = useState<ErroresRegistro>({});
  const [errorGeneralInterno, setErrorGeneralInterno] = useState<string | null>(null);

  const estaCargando = propCargando !== undefined ? propCargando : cargandoInterno;
  const errorGeneral = propErrorGeneral !== undefined ? propErrorGeneral : errorGeneralInterno;

  const handleLimpiarError = (campo: CampoRegistro) => {
    setErroresServidor((prev) => {
      if (!prev[campo]) return prev;
      const copia = { ...prev };
      delete copia[campo];
      return copia;
    });
  };

  const handleRegistro = async (datos: DatosRegistro) => {
    // Criterio de aceptación SE-12: Registro válido crea cuenta una sola vez
    // Bloquea de inmediato si ya hay una petición en curso
    if (estaCargando) {
      return;
    }

    if (propOnSubmit) {
      await propOnSubmit(datos);
      return;
    }

    setCargandoInterno(true);
    setErrorGeneralInterno(null);
    setErroresServidor({});

    try {
      const routeParams = route?.params as
        | { codigoOrganizacion?: string | null }
        | undefined;
      const codigoOrg =
        codigoOrganizacion !== undefined
          ? codigoOrganizacion
          : routeParams?.codigoOrganizacion ?? undefined;

      const respuesta = await onRegisterApi({
        nombre: datos.nombre.trim(),
        correo: datos.correo.trim(),
        password: datos.password,
        aceptaDatos: datos.aceptaDatos,
        codigoOrganizacion: codigoOrg,
      });

      // Éxito: notificar al callback (desbloquea SE-13) o continuar a Login
      if (onRegistroExitoso) {
        onRegistroExitoso(respuesta);
      } else {
        navigation?.navigate('Login');
      }
    } catch (err: unknown) {
      // Criterio de aceptación SE-12: Rechazo API no navega a éxito y conserva errores útiles
      if (err instanceof AuthError) {
        if (err.campos) {
          const { porCampo, general } = erroresRegistroDesdeServidor(err.campos);
          setErroresServidor(porCampo);
          if (general.length > 0) {
            setErrorGeneralInterno(general.join(' '));
          }
        } else {
          setErrorGeneralInterno(err.message);
        }
      } else if (esErrorDeRed(err)) {
        setErrorGeneralInterno(
          adaptarErrorRed(err) ?? MENSAJE_ERROR_RED
        );
      } else {
        setErrorGeneralInterno(
          err instanceof Error
            ? err.message
            : 'No fue posible completar el registro. Intenta de nuevo.'
        );
      }
    } finally {
      setCargandoInterno(false);
    }
  };

  return (
    <RegistroForm
      testID={testID}
      cargando={estaCargando}
      errores={erroresServidor}
      errorGeneral={errorGeneral}
      onLimpiarError={handleLimpiarError}
      onSubmit={handleRegistro}
      onNavegarLogin={() => navigation?.navigate('Login')}
      onVolver={() => navigation?.goBack()}
    />
  );
}

