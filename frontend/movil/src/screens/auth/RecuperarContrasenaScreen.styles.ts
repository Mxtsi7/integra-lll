import { StyleSheet } from 'react-native';

/**
 * Estilos modulares para la pantalla de Recuperar Contraseña (SE-14).
 * Sigue la misma paleta y lineamientos de accesibilidad de Login y Registro.
 */
export const styles = StyleSheet.create({
  keyboardAvoiding: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  container: {
    flexGrow: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    gap: 16,
  },
  badgeContainer: {
    alignItems: 'center',
    marginBottom: 4,
  },
  badgeSuccess: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#86efac',
  },
  badgeIcon: {
    fontSize: 28,
    color: '#16a34a',
    fontWeight: 'bold',
  },
  titulo: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0f172a',
    textAlign: 'center',
  },
  subtitulo: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
  },
  resultadoBox: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  resultadoTexto: {
    fontSize: 14,
    color: '#166534',
    textAlign: 'center',
    lineHeight: 22,
  },
  emailDestacado: {
    fontWeight: '700',
    color: '#14532d',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  errorText: {
    fontSize: 13,
    color: '#dc2626',
    lineHeight: 18,
    textAlign: 'center',
  },
  fieldContainer: {
    width: '100%',
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
  },
  inputError: {
    borderColor: '#ef4444',
    backgroundColor: '#fff5f5',
  },
  fieldErrorText: {
    fontSize: 12,
    color: '#dc2626',
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 4,
  },
  linksContainer: {
    width: '100%',
    gap: 10,
  },
});

export default styles;
