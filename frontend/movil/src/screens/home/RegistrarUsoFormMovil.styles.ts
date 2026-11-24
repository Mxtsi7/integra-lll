import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  contenedor: {
    width: '100%',
  },
  campoGrupo: {
    marginBottom: 16,
  },
  label: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 15,
  },
  inputError: {
    borderColor: '#ef4444',
  },
  errorTexto: {
    color: '#fca5a5',
    fontSize: 12,
    marginTop: 4,
  },
  errorGeneralBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorGeneralText: {
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 18,
  },
  confirmacionBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  confirmacionTexto: {
    color: '#6ee7b7',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  accionesFila: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  boton: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  botonPrimario: {
    backgroundColor: '#38bdf8',
    flex: 1,
  },
  botonPrimarioTexto: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
  },
  botonSecundario: {
    backgroundColor: '#334155',
    flex: 1,
  },
  botonSecundarioTexto: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  botonDeshabilitado: {
    opacity: 0.6,
  },
  cargandoFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});

export default styles;
