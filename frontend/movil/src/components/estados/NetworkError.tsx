import { Pressable, Text, View } from 'react-native';
import { estilos } from './estilos';
import { TEXTOS_ESTADOS } from './textos';

export interface NetworkErrorProps {
  /** Vuelve a pedir los datos. Obligatorio: todo error ofrece el mismo reintento. */
  onReintentar: () => void;
  /** Solo si la pantalla necesita un texto distinto; por defecto el común. */
  mensaje?: string;
  /** Mientras reintenta, el botón se deshabilita para evitar peticiones repetidas. */
  reintentando?: boolean;
}

export function NetworkError({ onReintentar, mensaje = TEXTOS_ESTADOS.errorRed, reintentando = false }: NetworkErrorProps) {
  return (
    <View style={estilos.caja} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <Text style={estilos.texto}>{mensaje}</Text>
      <Pressable
        style={[estilos.boton, estilos.botonPrimario, reintentando && estilos.botonOff]}
        onPress={onReintentar}
        disabled={reintentando}
        accessibilityRole="button"
        accessibilityLabel={TEXTOS_ESTADOS.reintentar}
        accessibilityState={{ disabled: reintentando, busy: reintentando }}
      >
        <Text style={[estilos.botonTexto, estilos.botonTextoPrimario]}>
          {reintentando ? TEXTOS_ESTADOS.reintentando : TEXTOS_ESTADOS.reintentar}
        </Text>
      </Pressable>
    </View>
  );
}
