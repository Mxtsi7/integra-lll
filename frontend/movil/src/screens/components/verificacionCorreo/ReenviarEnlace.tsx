import React, { useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { reenviarVerificacion } from '@ojoalgasto/shared';
import { NavButton } from '../NavButton';
import { COLORES_VERIFICACION as C } from './estilos';
import { mensajeDeErrorDeReenvio } from './reglasVerificacion';

export interface ReenviarEnlaceProps {
  /** El reenvío exige sesión. Sin sesión se ofrece iniciar sesión. */
  haySesion: boolean;
  onIrALogin: () => void;
  /** Solo en pruebas. */
  onReenviar?: () => Promise<void>;
}

/** "Reenviar enlace": pide un correo de verificación nuevo para la cuenta con sesión. */
export function ReenviarEnlace({ haySesion, onIrALogin, onReenviar = reenviarVerificacion }: ReenviarEnlaceProps) {
  const [estaEnviando, setEstaEnviando] = useState(false);
  const [yaSeEnvio, setYaSeEnvio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const envioEnCurso = useRef(false); // candado contra doble toque

  if (!haySesion) {
    return <NavButton testID="reenviar-iniciar-sesion" title="Inicia sesión para pedir un enlace nuevo" onPress={onIrALogin} />;
  }
  if (yaSeEnvio) {
    return (
      <Text testID="reenvio-enviado" style={styles.texto} accessibilityLiveRegion="polite">
        Te enviamos un enlace nuevo. Revisa tu correo y úsalo apenas llegue.
      </Text>
    );
  }

  async function reenviar() {
    if (envioEnCurso.current) return;
    envioEnCurso.current = true;
    setEstaEnviando(true);
    setError(null);
    try {
      await onReenviar();
      setYaSeEnvio(true);
    } catch (fallo) {
      setError(mensajeDeErrorDeReenvio(fallo));
    } finally {
      envioEnCurso.current = false;
      setEstaEnviando(false);
    }
  }

  return (
    <>
      {error ? (
        <Text testID="error-reenvio" style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <NavButton testID="reenviar-enlace" title="Reenviar enlace" loading={estaEnviando} onPress={() => void reenviar()} />
    </>
  );
}

const styles = StyleSheet.create({
  texto: { color: C.tinta2, fontSize: 14 },
  error: { color: C.error, fontSize: 14 },
});
