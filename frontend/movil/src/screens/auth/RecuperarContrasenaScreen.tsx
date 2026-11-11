import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AuthError,
  solicitarRecuperacion,
  validarCorreo,
} from '@ojoalgasto/shared';
import { esErrorDeRed, adaptarErrorRed, MENSAJE_ERROR_RED } from '../../services/clienteHttp';
import { NavButton } from '../components/NavButton';
import type { AuthScreenProps } from '../../navigation/types';
import styles from './RecuperarContrasenaScreen.styles';

export interface RecuperarContrasenaConfirmacionProps {
  /** Correo al que se envió la solicitud */
  email: string;
  /** Permite volver al formulario para ingresar otro correo */
  onUsarOtroCorreo: () => void;
  /** Navega a la pantalla de Login */
  onNavegarLogin: () => void;
  /** Identificador para pruebas automatizadas */
  testID?: string;
}

/**
 * Vista de confirmación neutra para recuperación de contraseña (SE-14 / MX-02).
 * No revela si la cuenta existe o no en la base de datos (anti-enumeración).
 */
export function RecuperarContrasenaConfirmacionView({
  email,
  onUsarOtroCorreo,
  onNavegarLogin,
  testID = 'pantalla-recuperar-confirmacion',
}: RecuperarContrasenaConfirmacionProps) {
  return (
    <View
      style={styles.card}
      testID={testID}
      role="region"
      aria-label="Confirmación de recuperación de contraseña"
    >
      <View style={styles.badgeContainer}>
        <View style={styles.badgeSuccess}>
          <Text style={styles.badgeIcon}>✓</Text>
        </View>
      </View>

      <Text style={styles.titulo} testID="recuperar-confirmacion-titulo">
        Revisa tu correo
      </Text>

      {/* Criterio de Aceptación: Solicitud genera feedback sin revelar existencia de cuenta */}
      <View style={styles.resultadoBox}>
        <Text style={styles.resultadoTexto} role="status" testID="recuperar-confirmacion-texto">
          Si hay una cuenta con{' '}
          <Text style={styles.emailDestacado} testID="recuperar-confirmacion-email">
            {email.trim()}
          </Text>
          , te enviamos un enlace para crear una contraseña nueva. Vence en 60 minutos. Si no llega,
          revisa la carpeta de spam.
        </Text>
      </View>

      <View style={styles.linksContainer}>
        <NavButton
          testID="btn-usar-otro-correo"
          title="Usar otro correo"
          variant="secondary"
          onPress={onUsarOtroCorreo}
        />
        <NavButton
          testID="go-login"
          title="Volver a Iniciar Sesión"
          variant="secondary"
          onPress={onNavegarLogin}
        />
      </View>
    </View>
  );
}

export interface RecuperarContrasenaFormProps {
  /** Correo controlado */
  correo: string;
  /** Callback al cambiar el correo */
  onCorreoChange: (correo: string) => void;
  /** Error específico del campo correo */
  errorCorreo?: string | null;
  /** Error general de red o servidor */
  errorGeneral?: string | null;
  /** Estado de carga u ocupado */
  cargando?: boolean;
  /** Callback al presionar enviar */
  onSubmit: () => void | Promise<void>;
  /** Callback para navegar a Login */
  onNavegarLogin: () => void;
  /** Callback para retroceder */
  onVolver: () => void;
  /** Identificador de pruebas */
  testID?: string;
}

/**
 * Componente presentacional del formulario de recuperación de contraseña.
 */
export function RecuperarContrasenaForm({
  correo,
  onCorreoChange,
  errorCorreo,
  errorGeneral,
  cargando = false,
  onSubmit,
  onNavegarLogin,
  onVolver,
  testID = 'screen-recuperar-contrasena',
}: RecuperarContrasenaFormProps) {
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.titulo} testID="recuperar-titulo">
        Recuperar Contraseña
      </Text>
      <Text style={styles.subtitulo} testID="recuperar-subtitulo">
        Te mandamos un enlace para crear una contraseña nueva.
      </Text>

      {errorGeneral ? (
        <View style={styles.errorBox} testID="recuperar-error-general" role="alert">
          <Text style={styles.errorText}>{errorGeneral}</Text>
        </View>
      ) : null}

      <View style={styles.fieldContainer}>
        <Text style={styles.label}>Correo electrónico</Text>
        <TextInput
          testID="input-correo"
          style={[styles.input, Boolean(errorCorreo) && styles.inputError]}
          placeholder="tu@correo.cl"
          placeholderTextColor="#94a3b8"
          value={correo}
          onChangeText={onCorreoChange}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          editable={!cargando}
          accessibilityLabel="Correo electrónico"
          accessibilityHint="Ingresa el correo asociado a tu cuenta para recibir el enlace de recuperación"
          aria-invalid={Boolean(errorCorreo)}
          aria-describedby={errorCorreo ? 'error-correo' : undefined}
        />
        {errorCorreo ? (
          <Text
            style={styles.fieldErrorText}
            testID="error-correo"
            role="alert"
            nativeID="error-correo"
          >
            {errorCorreo}
          </Text>
        ) : null}
      </View>

      <NavButton
        testID="recuperar-submit"
        title={cargando ? 'Enviando…' : 'Enviar enlace'}
        onPress={onSubmit}
        disabled={cargando}
        loading={cargando}
        accessibilityLabel={cargando ? 'Enviando enlace en curso' : 'Enviar enlace'}
        accessibilityHint="Solicita el enlace de recuperación de contraseña"
      />

      <View style={styles.divider} />

      <View style={styles.linksContainer}>
        <NavButton
          testID="go-login"
          title="Volver a Iniciar Sesión"
          variant="secondary"
          disabled={cargando}
          onPress={onNavegarLogin}
        />
        <NavButton
          testID="go-back"
          title="Volver"
          variant="secondary"
          disabled={cargando}
          onPress={onVolver}
        />
      </View>
    </View>
  );
}

export interface RecuperarContrasenaScreenPropsContainer {
  navigation?: {
    navigate: (pantalla: any, params?: any) => void;
    goBack?: () => void;
  };
  route?: any;
  /** Función inyectable para solicitar recuperación (por defecto shared) */
  onSolicitarRecuperacionApi?: (correo: string) => Promise<{ detail: string }>;
  /** Callback opcional ejecutado al completar exitosamente la solicitud */
  onSolicitudExitosa?: (email: string) => void;
  /** Permite forzar el estado de confirmación en pruebas */
  enviadoInicial?: boolean;
  /** Correo inicial */
  correoInicial?: string;
  testID?: string;
}

/**
 * Pantalla de Solicitud de Recuperación de Contraseña conectada a React Navigation y a la API (SE-14).
 * Maneja validación de correo, protección contra envíos dobles, feedback neutro y errores de red.
 */
export default function RecuperarContrasenaScreen({
  navigation,
  onSolicitarRecuperacionApi = solicitarRecuperacion,
  onSolicitudExitosa,
  enviadoInicial = false,
  correoInicial = '',
  testID,
}: RecuperarContrasenaScreenPropsContainer & Partial<AuthScreenProps<'RecuperarContrasena'>>) {
  const [correo, setCorreo] = useState(correoInicial);
  const [errorCorreo, setErrorCorreo] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [enviado, setEnviado] = useState(enviadoInicial);
  const [correoConfirmado, setCorreoConfirmado] = useState(correoInicial);

  const peticionEnVueloRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Interceptar retroceso físico de Android si está visible la confirmación
  useEffect(() => {
    if (!enviado) return;
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      setEnviado(false);
      return true;
    });
    return () => suscripcion.remove();
  }, [enviado]);

  const handleCorreoChange = (texto: string) => {
    setCorreo(texto);
    if (errorCorreo) setErrorCorreo(null);
    if (errorGeneral) setErrorGeneral(null);
  };

  const handleSubmit = async () => {
    if (peticionEnVueloRef.current || cargando) return;

    // Validación previa del correo según política común de shared
    const errorValidacion = validarCorreo(correo);
    if (errorValidacion) {
      setErrorCorreo(errorValidacion);
      setErrorGeneral(null);
      return;
    }

    peticionEnVueloRef.current = true;
    setCargando(true);
    setErrorCorreo(null);
    setErrorGeneral(null);

    const emailLimpio = correo.trim();

    try {
      await onSolicitarRecuperacionApi(emailLimpio);
      if (!isMountedRef.current) return;

      setCorreoConfirmado(emailLimpio);
      setEnviado(true);
      if (onSolicitudExitosa) {
        onSolicitudExitosa(emailLimpio);
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;

      // Errores de validación de campo de DRF (HTTP 400)
      if (err instanceof AuthError) {
        const errorCampo = err.campos?.email?.[0];
        if (errorCampo) {
          setErrorCorreo(errorCampo);
        } else {
          setErrorGeneral(err.message);
        }
      } else if (esErrorDeRed(err)) {
        // Criterio de Aceptación: Caída de red termina la espera y permite reintentar
        setErrorGeneral(adaptarErrorRed(err) ?? MENSAJE_ERROR_RED);
      } else {
        setErrorGeneral(
          err instanceof Error
            ? err.message
            : 'No pudimos procesar la solicitud. Intenta de nuevo.'
        );
      }
    } finally {
      peticionEnVueloRef.current = false;
      if (isMountedRef.current) {
        setCargando(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoiding}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {enviado ? (
          <RecuperarContrasenaConfirmacionView
            email={correoConfirmado}
            onUsarOtroCorreo={() => setEnviado(false)}
            onNavegarLogin={() => navigation?.navigate('Login')}
          />
        ) : (
          <RecuperarContrasenaForm
            testID={testID}
            correo={correo}
            onCorreoChange={handleCorreoChange}
            errorCorreo={errorCorreo}
            errorGeneral={errorGeneral}
            cargando={cargando}
            onSubmit={handleSubmit}
            onNavegarLogin={() => navigation?.navigate('Login')}
            onVolver={() => navigation?.goBack()}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
