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
import {
  validarRegistro,
  type CampoRegistro,
  type DatosRegistro,
  type ErroresRegistro,
} from '@ojoalgasto/shared';
import { NavButton } from '../components/NavButton';
import type { AuthScreenProps } from '../../navigation/types';

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
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false);

  // Referencias a los campos para navegación accesible con teclado
  const inputCorreoRef = useRef<TextInput>(null);
  const inputPasswordRef = useRef<TextInput>(null);
  const inputConfirmacionRef = useRef<TextInput>(null);

  // Resolución de valores (controlados externamente o internos)
  const valorNombre = propNombre !== undefined ? propNombre : internalNombre;
  const valorCorreo = propCorreo !== undefined ? propCorreo : internalCorreo;
  const valorPassword = propPassword !== undefined ? propPassword : internalPassword;
  const valorConfirmacion =
    propConfirmacion !== undefined ? propConfirmacion : internalConfirmacion;
  const valorAceptaDatos =
    propAceptaDatos !== undefined ? propAceptaDatos : internalAceptaDatos;
  const erroresActivos = propErrores !== undefined ? propErrores : internalErrores;

  const estaBloqueado = Boolean(deshabilitado || cargando);

  // Limpieza individual de error al editar un campo
  const limpiarError = (campo: CampoRegistro) => {
    if (propErrores) return;
    setInternalErrores((actuales) => {
      if (!actuales[campo]) return actuales;
      const copia = { ...actuales };
      delete copia[campo];
      return copia;
    });
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
  onSubmit?: (datos: DatosRegistro) => void | Promise<void>;
  cargando?: boolean;
  errorGeneral?: string | null;
}

/**
 * Contenedor de pantalla conectado a React Navigation (SE-11 / SE-12).
 * Gestiona el ruteo hacia Login y el retroceso a pantallas anteriores.
 */
export default function RegistroScreen({
  navigation,
  onSubmit,
  cargando,
  errorGeneral,
}: RegistroScreenPropsContainer & Partial<AuthScreenProps<'Registro'>>) {
  return (
    <RegistroForm
      testID="screen-registro"
      cargando={cargando}
      errorGeneral={errorGeneral}
      onSubmit={onSubmit}
      onNavegarLogin={() => navigation?.navigate('Login')}
      onVolver={() => navigation?.goBack()}
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
    paddingHorizontal: 20,
    paddingVertical: 32,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    marginBottom: 20,
    lineHeight: 20,
  },
  errorGeneralBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  errorGeneralText: {
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
  ayudaText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    lineHeight: 16,
  },
  consentimientoContainer: {
    marginBottom: 20,
  },
  checkboxFila: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkboxCaja: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxCajaMarcada: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  checkboxErrorBorder: {
    borderColor: '#f87171',
  },
  checkboxTilde: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 16,
  },
  consentimientoTexto: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
  },
  errorCampoText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
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
