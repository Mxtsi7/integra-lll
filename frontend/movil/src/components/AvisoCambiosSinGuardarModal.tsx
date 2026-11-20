import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { styles } from './AvisoCambiosSinGuardarModal.styles';

export interface AvisoCambiosSinGuardarModalProps {
  visible: boolean;
  onSeguirEditando: () => void;
  onDescartar: () => void;
  titulo?: string;
  mensaje?: string;
  testID?: string;
}

/**
 * Diálogo modal accesible para advertir cambios sin guardar en móvil (SE-31).
 * Presenta opciones de "Seguir editando" (conserva el formulario intacto)
 * o "Descartar cambios" (abandona la pantalla y descarta los datos modificados).
 */
export function AvisoCambiosSinGuardarModal({
  visible,
  onSeguirEditando,
  onDescartar,
  titulo = 'Cambios sin guardar',
  mensaje = 'Tienes cambios sin guardar. Si sales ahora, se perderán.',
  testID = 'modal-aviso-cambios-sin-guardar',
}: AvisoCambiosSinGuardarModalProps) {
  return (
    <Modal
      testID={testID}
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onSeguirEditando}
    >
      <View style={styles.overlay}>
        <View
          style={styles.card}
          accessibilityRole="alert"
          testID="aviso-cambios-sin-guardar"
        >
          <Text
            style={styles.titulo}
            accessibilityRole="header"
            testID="titulo-aviso-cambios-sin-guardar"
          >
            {titulo}
          </Text>
          <Text
            style={styles.mensaje}
            testID="mensaje-aviso-cambios-sin-guardar"
          >
            {mensaje}
          </Text>

          <View style={styles.accionesFila}>
            <Pressable
              testID="btn-seguir-editando"
              accessibilityRole="button"
              accessibilityLabel="Seguir editando"
              style={[styles.boton, styles.botonSecundario]}
              onPress={onSeguirEditando}
            >
              <Text style={styles.botonSecundarioTexto}>Seguir editando</Text>
            </Pressable>

            <Pressable
              testID="btn-descartar-cambios"
              accessibilityRole="button"
              accessibilityLabel="Descartar cambios"
              style={[styles.boton, styles.botonPeligro]}
              onPress={onDescartar}
            >
              <Text style={styles.botonPeligroTexto}>Descartar cambios</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default AvisoCambiosSinGuardarModal;
