import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  keyboardAvoiding: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    paddingBottom: 48,
  },
  header: {
    marginBottom: 20,
  },
  titulo: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitulo: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e2e8f0',
    marginBottom: 6,
  },
  ayuda: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#ffffff',
    minHeight: 46,
  },
  inputError: {
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  errorTexto: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  errorGeneralBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorGeneralText: {
    color: '#fecaca',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 18,
  },
  opcionesContenedor: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipActivo: {
    borderColor: '#38bdf8',
    backgroundColor: '#0369a1',
  },
  chipTexto: {
    fontSize: 13,
    fontWeight: '500',
    color: '#94a3b8',
  },
  chipTextoActivo: {
    color: '#ffffff',
    fontWeight: '600',
  },
  casillaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#64748b',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  checkboxActivo: {
    borderColor: '#38bdf8',
    backgroundColor: '#0284c7',
  },
  checkboxCheck: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    lineHeight: 14,
  },
  casillaTexto: {
    fontSize: 14,
    color: '#e2e8f0',
    fontWeight: '500',
  },
  acciones: {
    flexDirection: 'column',
    gap: 12,
    marginTop: 8,
  },
  botonGuardar: {
    backgroundColor: '#38bdf8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  botonGuardarTexto: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
  },
  botonDeshabilitado: {
    opacity: 0.5,
  },
});

export default styles;
