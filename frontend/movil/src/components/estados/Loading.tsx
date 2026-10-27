import { ActivityIndicator, Text, View } from 'react-native';
import { COLORES_ESTADOS, estilos } from './estilos';
import { TEXTOS_ESTADOS } from './textos';

export interface LoadingProps {
  /** Texto que lee el lector de pantalla y se muestra debajo del indicador. */
  mensaje?: string;
}

export function Loading({ mensaje = TEXTOS_ESTADOS.cargando }: LoadingProps) {
  return (
    <View style={estilos.caja} accessible accessibilityRole="progressbar" accessibilityLabel={mensaje} accessibilityLiveRegion="polite">
      <ActivityIndicator color={COLORES_ESTADOS.acento} />
      <Text style={estilos.texto}>{mensaje}</Text>
    </View>
  );
}
