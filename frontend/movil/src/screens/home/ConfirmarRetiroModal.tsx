import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { NavButton } from '../components/NavButton';

export interface ConfirmarRetiroModalProps {
  visible: boolean;
  nombreSuscripcion: string;
  onConfirmar: () => void;
  onCancelar: () => void;
  isDeleting?: boolean;
  error?: string | null;
}

/**
 * Modal accesible de confirmación para retirar suscripciones (SE-26).
 *
 * Distingue explícitamente entre:
 * 1. Retirar el registro de seguimiento en Ojo al Gasto (panel/listado).
 * 2. Cancelar el servicio comercial con el proveedor externo.
 */
export function ConfirmarRetiroModal({
  visible,
  nombreSuscripcion,
  onConfirmar,
  onCancelar,
  isDeleting = false,
  error = null,
}: ConfirmarRetiroModalProps) {
  return (
    <Modal
      testID="modal-confirmar-retiro"
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={isDeleting ? undefined : onCancelar}
    >
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityRole="alert">
          <Text testID="titulo-confirmar-retiro" style={styles.titulo}>
            ¿Retirar {nombreSuscripcion}?
          </Text>

          <Text testID="mensaje-retiro-registro" style={styles.mensaje}>
            Se retirará <Text style={styles.negrita}>{nombreSuscripcion}</Text> de tu panel de seguimiento. Esta acción no se puede deshacer.
          </Text>

          <View style={styles.cajaAviso}>
            <Text testID="aviso-distincion-cancelar" style={styles.avisoTexto}>
              ⚠️ <Text style={styles.avisoNegrita}>Importante:</Text> Retirar este registro de la aplicación NO cancela el cobro con el proveedor externo. Para que dejen de cobrarte, debes cancelar el servicio directamente con {nombreSuscripcion}.
            </Text>
          </View>

          {error ? (
            <Text testID="error-retiro" accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <View style={styles.acciones}>
            <NavButton
              testID="btn-cancelar-retiro"
              title="Cancelar"
              variant="secondary"
              onPress={onCancelar}
              disabled={isDeleting}
              style={styles.boton}
            />
            <NavButton
              testID="btn-confirmar-retiro"
              title={isDeleting ? 'Retirando…' : 'Retirar Suscripción'}
              variant="danger"
              onPress={onConfirmar}
              loading={isDeleting}
              disabled={isDeleting}
              style={styles.boton}
            />
          </View>
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
    maxWidth: 420,
    borderWidth: 1,
    borderColor: '#334155',
  },
  titulo: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  mensaje: {
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 14,
  },
  negrita: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  cajaAviso: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  avisoTexto: {
    color: '#fde68a',
    fontSize: 13,
    lineHeight: 18,
  },
  avisoNegrita: {
    fontWeight: '700',
    color: '#fbbf24',
  },
  error: {
    color: '#fca5a5',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    marginBottom: 16,
  },
  acciones: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  boton: {
    flex: 1,
  },
});
