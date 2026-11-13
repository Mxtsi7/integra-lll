import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NavButton } from '../NavButton';
import { COLORES_VERIFICACION as C } from './estilos';
import { ReenviarEnlace } from './ReenviarEnlace';
import type { EstadoVerificacion } from './reglasVerificacion';
import { useVerificarCorreo } from './useVerificarCorreo';

const TEXTOS: Record<Exclude<EstadoVerificacion['tipo'], 'verificando' | 'error'>, { titulo: string; detalle: string }> = {
  verificado: { titulo: 'Correo verificado', detalle: 'Tu correo quedó confirmado. Ya puedes seguir usando la app.' },
  vencido: { titulo: 'El enlace venció', detalle: 'Los enlaces de verificación duran poco tiempo. Pide uno nuevo.' },
  usado: { titulo: 'El enlace ya se usó', detalle: 'Si ya verificaste tu correo no necesitas hacer nada más. Si no, pide un enlace nuevo.' },
  invalido: { titulo: 'El enlace no es válido', detalle: 'Puede estar incompleto o ser de otra cuenta. Pide un enlace nuevo.' },
  correo_no_disponible: { titulo: 'No pudimos verificar este correo', detalle: 'Este correo no está disponible para verificar. Pide un enlace nuevo.' },
};

export interface VerificarCorreoContenidoProps {
  /** El token que llegó en el enlace `ojoalgasto://verificar-correo?token=...`. */
  token: string | undefined;
  haySesion: boolean;
  onIrALogin: () => void;
  /** Se llama solo después de que el backend confirmó. Con sesión, la pantalla relee el perfil. */
  onVerificado?: () => void;
  /** Solo en pruebas. */
  onConfirmar?: (token: string) => Promise<void>;
  /** Solo en pruebas. */
  onReenviar?: () => Promise<void>;
}

export function VerificarCorreoContenido({ token, haySesion, onIrALogin, onVerificado, onConfirmar, onReenviar }: VerificarCorreoContenidoProps) {
  const { estado, reintentar } = useVerificarCorreo({ token, onConfirmar, onVerificado });

  if (estado.tipo === 'verificando') {
    return (
      <Text testID="verificando" style={styles.texto} accessibilityRole="progressbar">
        Estamos confirmando tu enlace…
      </Text>
    );
  }

  if (estado.tipo === 'error') {
    return (
      <View testID="verificacion-error" style={styles.contenedor}>
        <Text style={styles.error} accessibilityRole="alert">
          {estado.mensaje}
        </Text>
        <NavButton testID="reintentar-verificacion" title="Reintentar" onPress={() => void reintentar()} />
      </View>
    );
  }

  const { titulo, detalle } = TEXTOS[estado.tipo];
  const puedeReenviar = estado.tipo !== 'verificado';

  return (
    <View testID={`verificacion-${estado.tipo}`} style={styles.contenedor}>
      <Text style={styles.titulo} accessibilityRole="header">
        {titulo}
      </Text>
      <Text style={styles.texto}>{detalle}</Text>
      {puedeReenviar ? <ReenviarEnlace haySesion={haySesion} onIrALogin={onIrALogin} onReenviar={onReenviar} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: 12 },
  titulo: { color: C.tinta, fontSize: 20, fontWeight: '700' },
  texto: { color: C.tinta2, fontSize: 14 },
  error: { color: C.error, fontSize: 14 },
});
