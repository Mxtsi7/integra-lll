import { Pressable, Text, View } from 'react-native';
import { estilos } from './estilos';

export interface EmptyStateProps {
  titulo: string;
  descripcion?: string;
  /** Acción opcional (p. ej. "Agregar suscripción"). Sin acción, solo informa. */
  accion?: { etiqueta: string; onPress: () => void };
}

export function EmptyState({ titulo, descripcion, accion }: EmptyStateProps) {
  return (
    <View style={estilos.caja}>
      <Text style={estilos.titulo} accessibilityRole="header">
        {titulo}
      </Text>
      {descripcion ? <Text style={estilos.texto}>{descripcion}</Text> : null}
      {accion ? (
        <Pressable style={estilos.boton} onPress={accion.onPress} accessibilityRole="button" accessibilityLabel={accion.etiqueta}>
          <Text style={estilos.botonTexto}>{accion.etiqueta}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
