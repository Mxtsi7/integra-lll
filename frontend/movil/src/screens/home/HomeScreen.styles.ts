import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  contenedor: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 12,
  },
  titulo: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
  },
  usuarioTexto: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  resumenCaja: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  resumenEtiqueta: {
    fontSize: 12,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  resumenTotal: {
    fontSize: 20,
    fontWeight: '700',
    color: '#38bdf8',
    marginTop: 4,
  },
  resumenSubtitulo: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  accionesBarra: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  botonAccion: {
    flex: 1,
  },
  listaContainer: {
    paddingBottom: 24,
  },
  tarjeta: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  tarjetaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tarjetaHeaderIzq: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTexto: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  infoNombre: {
    flex: 1,
  },
  nombreTexto: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  categoriaTexto: {
    fontSize: 12,
    color: '#94a3b8',
    textTransform: 'capitalize',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeTexto: {
    fontSize: 11,
    fontWeight: '600',
  },
  tarjetaCuerpo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  montoTexto: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  frecuenciaTexto: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  cobroTexto: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'right',
  },
});
