import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  titulo: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 8,
  },
  mensaje: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
    marginBottom: 20,
  },
  accionesFila: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  boton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  botonSecundario: {
    backgroundColor: '#334155',
  },
  botonSecundarioTexto: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
  botonPeligro: {
    backgroundColor: '#dc2626',
  },
  botonPeligroTexto: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default styles;
