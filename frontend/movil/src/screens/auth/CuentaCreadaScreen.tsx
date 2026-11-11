import React, { useEffect } from 'react';
import { BackHandler, Text, View } from 'react-native';
import type { RegisterResponse } from '@ojoalgasto/shared';
import { NavButton } from '../components/NavButton';
import type { AuthScreenProps } from '../../navigation/types';
import styles from './CuentaCreadaScreen.styles';

/**
 * Datos requeridos para la confirmación de cuenta creada.
 * Se deriva directamente de RegisterResponse de @ojoalgasto/shared sin duplicar tipos.
 */
export type DatosCuentaConfirmada = Pick<RegisterResponse, 'nombre' | 'email'>;

export interface CuentaCreadaProps {
  /** Datos del usuario y cuenta devueltos por el backend */
  cuenta: DatosCuentaConfirmada;
  /** Callback al pulsar botón principal para avanzar a Iniciar Sesión */
  onContinuarLogin: () => void;
  /** Callback alternativo al pulsar volver o retroceder */
  onVolver?: () => void;
  /** Identificador para pruebas automatizadas */
  testID?: string;
}

/**
 * Componente presentacional puro de confirmación de cuenta creada (SE-13).
 *
 * Criterio de arquitectura:
 * - Desacoplado de la red y del contexto de sesión.
 * - NO genera sesiones ficticias ni almacena tokens falsos: el usuario
 *   debe iniciar sesión formalmente con sus credenciales en LoginScreen.
 */
export function CuentaCreadaView({
  cuenta,
  onContinuarLogin,
  onVolver,
  testID = 'pantalla-cuenta-creada',
}: CuentaCreadaProps) {
  const nombreUsuario = cuenta.nombre?.trim() || 'Usuario';
  const correoUsuario = cuenta.email?.trim() || '';

  return (
    <View
      style={styles.pantalla}
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.tarjeta}>
        {/* Ícono de confirmación exitosa */}
        <View style={styles.iconoContenedor} testID="cuenta-creada-icono">
          <Text style={styles.iconoTexto}>✓</Text>
        </View>

        {/* Encabezado y felicitación */}
        <Text style={styles.titulo} testID="cuenta-creada-titulo">
          ¡Cuenta creada exitosamente!
        </Text>

        <Text style={styles.subtitulo} testID="cuenta-creada-nombre">
          Bienvenido/a, <Text style={styles.nombreResaltado}>{nombreUsuario}</Text>.
        </Text>

        {/* Resumen del correo asociado */}
        <View style={styles.cajaInfo}>
          <Text style={styles.etiquetaInfo}>Correo registrado</Text>
          <Text style={styles.valorCorreo} testID="cuenta-creada-email">
            {correoUsuario}
          </Text>
        </View>

        {/* Instrucciones del siguiente paso: no hay sesión ficticia */}
        <View style={styles.cajaAviso}>
          <Text style={styles.avisoTexto}>
            Tu cuenta ya está lista. Para comenzar a registrar tus suscripciones y
            calcular tus gastos, inicia sesión con tu correo y contraseña.
          </Text>
        </View>

        <View style={styles.divider} />

        {/* Acciones principales de navegación hacia Login */}
        <View style={styles.accionesContainer}>
          <NavButton
            testID="btn-continuar-login"
            title="Continuar a Iniciar Sesión"
            variant="primary"
            onPress={onContinuarLogin}
            accessibilityLabel="Continuar a Iniciar Sesión"
            accessibilityHint="Navega a la pantalla de acceso para ingresar con tus credenciales"
          />

          <NavButton
            testID="btn-volver-login"
            title="Volver"
            variant="secondary"
            onPress={onVolver ?? onContinuarLogin}
            accessibilityLabel="Volver a Iniciar Sesión"
            accessibilityHint="Regresa a la pantalla de acceso"
          />
        </View>
      </View>
    </View>
  );
}

export interface CuentaCreadaScreenPropsContainer {
  navigation?: {
    navigate: (pantalla: any, params?: any) => void;
    goBack?: () => void;
  };
  route?: {
    params?: DatosCuentaConfirmada;
  };
  cuenta?: DatosCuentaConfirmada;
  onContinuarLogin?: () => void;
  onVolver?: () => void;
  testID?: string;
}

/**
 * Pantalla contenedora de Cuenta Creada conectada a React Navigation (SE-13).
 * Intercepta el botón físico de retroceso de Android (BackHandler) para
 * garantizar que 'Atrás' conduzca a Login y nunca reenvíe el formulario de registro.
 */
export default function CuentaCreadaScreen({
  navigation,
  route,
  cuenta: propCuenta,
  onContinuarLogin,
  onVolver,
  testID,
}: CuentaCreadaScreenPropsContainer) {
  const datosCuenta: DatosCuentaConfirmada = propCuenta ?? route?.params ?? {
    nombre: 'Usuario',
    email: '',
  };

  const handleIrALogin = () => {
    if (onContinuarLogin) {
      onContinuarLogin();
    } else {
      navigation?.navigate('Login');
    }
  };

  const handleVolver = () => {
    if (onVolver) {
      onVolver();
    } else {
      navigation?.navigate('Login');
    }
  };

  // Criterio de aceptación SE-13: Atrás no reenvía el formulario ni duplica registro
  // Intercepta el botón físico de Android para asegurar que retroceda a Login
  useEffect(() => {
    const subscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      handleVolver();
      return true; // Previene el retroceso por defecto al formulario previo
    });
    return () => subscripcion.remove();
  }, [navigation, onVolver]);

  return (
    <CuentaCreadaView
      testID={testID}
      cuenta={datosCuenta}
      onContinuarLogin={handleIrALogin}
      onVolver={handleVolver}
    />
  );
}
