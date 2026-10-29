import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { login, AuthError } from '@ojoalgasto/shared';
import { useAuth } from '../../../context/AuthContext';
import { esErrorDeRed, adaptarErrorRed } from '../../services/clienteHttp';
import { NavButton } from '../components/NavButton';
import type { AuthScreenProps } from '../../navigation/types';

export interface LoginFormProps {
  /** Correo controlado (opcional) */
  correo?: string;
  /** Manejador de cambio de correo (opcional) */
  onCorreoChange?: (correo: string) => void;
  /** Contraseña controlada (opcional) */
  password?: string;
  /** Manejador de cambio de contraseña (opcional) */
  onPasswordChange?: (password: string) => void;
  /** Estado de carga externo (ej. durante llamada a API) */
  loading?: boolean;
  /** Mensaje de error para renderizado accesible */
  error?: string | null;
  /** Callback al solicitar envío de credenciales válidas */
  onSubmit?: (credenciales: { correo: string; password: string }) => void | Promise<void>;
  /** Navegación a pantalla de registro */
  onNavigateRegistro?: () => void;
  /** Navegación a pantalla de recuperación de contraseña */
  onNavigateRecuperar?: () => void;
  /** Navegación a pantalla de verificación de correo */
  onNavigateVerificar?: () => void;
  /** Bloqueo de interacción total */
  disabled?: boolean;
  /** Identificador de prueba */
  testID?: string;
}

/**
 * Componente presentacional puro de formulario de acceso (SE-09).
 * Desacoplado de la navegación y la sesión para facilitar pruebas y conexión limpia con Auth (SE-10).
 */
export function LoginForm({
  correo: propCorreo,
  onCorreoChange: propOnCorreoChange,
  password: propPassword,
  onPasswordChange: propOnPasswordChange,
  loading = false,
  error,
  onSubmit,
  onNavigateRegistro,
  onNavigateRecuperar,
  onNavigateVerificar,
  disabled = false,
  testID = 'screen-login',
}: LoginFormProps) {
  const [internalCorreo, setInternalCorreo] = useState('');
  const [internalPassword, setInternalPassword] = useState('');
  const [internalError, setInternalError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const passwordInputRef = useRef<TextInput>(null);

  const correoValue = propCorreo !== undefined ? propCorreo : internalCorreo;
  const passwordValue = propPassword !== undefined ? propPassword : internalPassword;
  const activeError = error || internalError;
  const isBloqueado = Boolean(disabled || loading);

  const handleCorreoChange = (texto: string) => {
    setInternalCorreo(texto);
    if (propOnCorreoChange) propOnCorreoChange(texto);
    if (internalError) setInternalError(null);
  };

  const handlePasswordChange = (texto: string) => {
    setInternalPassword(texto);
    if (propOnPasswordChange) propOnPasswordChange(texto);
    if (internalError) setInternalError(null);
  };

  const handleFormSubmit = () => {
    if (isBloqueado) return;

    if (!correoValue.trim()) {
      setInternalError('Ingresa tu correo electrónico.');
      return;
    }
    if (!passwordValue) {
      setInternalError('Ingresa tu contraseña.');
      return;
    }

    setInternalError(null);
    if (onSubmit) {
      onSubmit({ correo: correoValue.trim(), password: passwordValue });
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
          <Text style={styles.titulo}>Bienvenido de nuevo</Text>
          <Text style={styles.subtitulo}>Entra para ver cómo van tus suscripciones.</Text>

          {/* Área de error accesible y estable para evitar saltos bruscos */}
          <View
            style={styles.feedbackContainer}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {activeError ? (
              <View style={styles.errorBox} testID="login-error">
                <Text style={styles.errorText} testID="login-error-text">
                  {activeError}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Correo electrónico</Text>
            <TextInput
              testID="input-correo"
              style={[styles.input, Boolean(activeError) && styles.inputErrorBorder]}
              value={correoValue}
              onChangeText={handleCorreoChange}
              placeholder="tu@correo.cl"
              placeholderTextColor="#94a3b8"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              accessibilityLabel="Correo electrónico"
              accessibilityHint="Ingresa tu correo registrado en Ojo al Gasto"
              editable={!isBloqueado}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Contraseña</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                ref={passwordInputRef}
                testID="input-password"
                style={[
                  styles.input,
                  styles.passwordInput,
                  Boolean(activeError) && styles.inputErrorBorder,
                ]}
                value={passwordValue}
                onChangeText={handlePasswordChange}
                placeholder="Tu contraseña"
                placeholderTextColor="#94a3b8"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                textContentType="password"
                returnKeyType="done"
                onSubmitEditing={handleFormSubmit}
                accessibilityLabel="Contraseña"
                accessibilityHint="Ingresa tu contraseña secreta"
                editable={!isBloqueado}
              />
              <Pressable
                testID="toggle-password"
                style={styles.eyeButton}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                accessibilityHint="Alterna la visibilidad de los caracteres de la contraseña"
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                disabled={isBloqueado}
              >
                <Text style={styles.eyeButtonText}>{showPassword ? 'Ocultar' : 'Ver'}</Text>
              </Pressable>
            </View>
          </View>

          <NavButton
            testID="login-submit"
            title={loading ? 'Ingresando…' : 'Iniciar sesión'}
            onPress={handleFormSubmit}
            disabled={isBloqueado}
            loading={loading}
            accessibilityLabel={loading ? 'Iniciando sesión en curso' : 'Iniciar sesión'}
            accessibilityHint="Envía tus credenciales para acceder a la aplicación"
          />

          <View style={styles.divider} />

          <View style={styles.linksContainer}>
            <NavButton
              testID="go-registro"
              title="¿No tienes cuenta? Crea una"
              variant="secondary"
              onPress={() => onNavigateRegistro?.()}
              disabled={isBloqueado}
              accessibilityHint="Navega a la pantalla para crear una cuenta nueva"
            />
            <NavButton
              testID="go-recuperar"
              title="¿Olvidaste tu contraseña?"
              variant="secondary"
              onPress={() => onNavigateRecuperar?.()}
              disabled={isBloqueado}
              accessibilityHint="Navega a la pantalla para restablecer tu contraseña"
            />
            <NavButton
              testID="go-verificar"
              title="Verificar correo"
              variant="secondary"
              onPress={() => onNavigateVerificar?.()}
              disabled={isBloqueado}
              accessibilityHint="Navega a la pantalla de verificación de correo electrónico"
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Pantalla contenedora de Iniciar Sesión conectada a navegación y contexto de sesión.
 */
export default function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const { iniciarSesion } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (credenciales: { correo: string; password: string }) => {
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await login({ correo: credenciales.correo, password: credenciales.password });
      await iniciarSesion({ access_token: res.access_token, refresh_token: res.refresh_token });
    } catch (err: unknown) {
      if (err instanceof AuthError && err.status === 401) {
        setError('Usuario o contraseña inválidos');
      } else if (err instanceof AuthError) {
        setError(err.message);
      } else if (esErrorDeRed(err)) {
        setError(
          adaptarErrorRed(err) ??
            'No se pudo conectar con el servidor. Intenta de nuevo en un momento.'
        );
      } else {
        setError(
          err instanceof Error ? err.message : 'No se pudo iniciar sesión. Intenta de nuevo.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginForm
      loading={loading}
      error={error}
      onCorreoChange={() => {
        if (error) setError(null);
      }}
      onPasswordChange={() => {
        if (error) setError(null);
      }}
      onSubmit={handleLogin}
      onNavigateRegistro={() => navigation.navigate('Registro')}
      onNavigateRecuperar={() => navigation.navigate('RecuperarContrasena')}
      onNavigateVerificar={() => navigation.navigate('VerificarCorreo')}
    />
  );
}

const styles = StyleSheet.create({
  keyboardAvoiding: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  container: {
    flexGrow: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    // Sombra suave para elevación accesible
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  titulo: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitulo: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 16,
  },
  feedbackContainer: {
    minHeight: 0,
    marginBottom: 8,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 18,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
    minHeight: 46,
  },
  inputErrorBorder: {
    borderColor: '#f87171',
    backgroundColor: '#fffafb',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  passwordInput: {
    flex: 1,
    paddingRight: 64,
  },
  eyeButton: {
    position: 'absolute',
    right: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  eyeButtonText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 20,
  },
  linksContainer: {
    gap: 10,
  },
});
