import { Pressable, Text, View } from 'react-native';
import { estilos } from './estilos';

export interface EmptyStateProps {
  titulo: string;
  descripcion?: string;
  /** Acción opcional (p. ej. "Agregar suscripción"). Sin acción, solo informa. */
  accion?: {
    etiqueta: string;
    onPress: () => void;
    variante?: 'primario' | 'porDefecto';
    testID?: string;
  };
  testID?: string;
}

export function EmptyState({ titulo, descripcion, accion, testID }: EmptyStateProps) {
  const esPrimario = accion?.variante === 'primario';

  return (
    <View style={estilos.caja} testID={testID}>
      <Text style={estilos.titulo} accessibilityRole="header">
        {titulo}
      </Text>
      {descripcion ? <Text style={estilos.texto}>{descripcion}</Text> : null}
      {accion ? (
        <Pressable
          testID={accion.testID}
          style={[estilos.boton, esPrimario && estilos.botonPrimario]}
          onPress={accion.onPress}
          accessibilityRole="button"
          accessibilityLabel={accion.etiqueta}
        >
          <Text style={[estilos.botonTexto, esPrimario && estilos.botonTextoPrimario]}>
            {accion.etiqueta}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
