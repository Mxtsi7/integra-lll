import { StyleSheet } from 'react-native';

/**
 * Módulo de estilos para la pantalla de confirmación de Cuenta Creada (SE-13).
 * Sigue los principios de código limpio de React Native StyleSheet:
 * tipado estricto, alto rendimiento y separación modular de responsabilidades.
 */
export const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  tarjeta: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  iconoContenedor: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#f0fdf4',
    borderWidth: 2,
    borderColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconoTexto: {
    fontSize: 32,
    color: '#16a34a',
    fontWeight: 'bold',
    lineHeight: 36,
  },
  titulo: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitulo: {
    fontSize: 15,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 22,
  },
  nombreResaltado: {
    fontWeight: '700',
    color: '#0f172a',
  },
  cajaInfo: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '100%',
    marginBottom: 16,
  },
  etiquetaInfo: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  valorCorreo: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0284c7',
  },
  cajaAviso: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: '100%',
    marginBottom: 24,
  },
  avisoTexto: {
    fontSize: 13,
    color: '#1e40af',
    textAlign: 'center',
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    width: '100%',
    marginBottom: 18,
  },
  accionesContainer: {
    width: '100%',
    gap: 10,
  },
});

export default styles;
