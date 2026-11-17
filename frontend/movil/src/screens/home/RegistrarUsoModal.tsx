import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import {
  RegistrarUsoFormMovil,
  type RegistrarUsoFormMovilProps,
} from './RegistrarUsoFormMovil';

export interface RegistrarUsoModalProps extends RegistrarUsoFormMovilProps {
  visible: boolean;
}

/**
 * Modal accesible para registrar minutos de uso en una suscripción (SE-28).
 */
export function RegistrarUsoModal({
  visible,
  nombreSuscripcion,
  onCancelar,
  ...formProps
}: RegistrarUsoModalProps) {
  return (
    <Modal
      testID="modal-registrar-uso"
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancelar}
    >
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityRole="alert">
          <Text
            testID="titulo-modal-registrar-uso"
            style={styles.titulo}
            accessibilityRole="header"
          >
            {nombreSuscripcion
              ? `Registrar uso en ${nombreSuscripcion}`
              : 'Registrar minutos de uso'}
          </Text>
          <Text style={styles.descripcion}>
            Ingresa los minutos de uso para recalcular el costo por hora y mantener actualizadas tus métricas mensuales.
          </Text>

          <RegistrarUsoFormMovil
            nombreSuscripcion={nombreSuscripcion}
            onCancelar={onCancelar}
            {...formProps}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 440,
    borderWidth: 1,
    borderColor: '#334155',
  },
  titulo: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  descripcion: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
});
