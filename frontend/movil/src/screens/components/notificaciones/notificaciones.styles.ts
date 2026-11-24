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
  scrollContenido: {
    paddingBottom: 32,
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
  subtitulo: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  seccion: {
    marginTop: 12,
    marginBottom: 8,
  },
  tituloSeccion: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  tarjeta: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    gap: 12,
  },
  filaSinBorde: {
    borderBottomWidth: 0,
  },
  textoContenedor: {
    flex: 1,
    gap: 4,
  },
  etiqueta: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  detalle: {
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 18,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#450a0a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  badgeTexto: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fca5a5',
  },
  nota: {
    fontSize: 12,
    color: '#f59e0b',
    marginTop: 2,
  },
  alerta: {
    fontSize: 12,
    color: '#f87171',
    marginTop: 2,
    fontWeight: '500',
  },
  switchContenedor: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  estadoDispositivoContenedor: {
    paddingHorizontal: 4,
    marginTop: 8,
    marginBottom: 4,
  },
  textoEstadoDispositivo: {
    fontSize: 13,
    color: '#94a3b8',
  },
  pushHabilitado: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  pushInhabilitado: {
    color: '#f87171',
    fontWeight: '700',
  },
  ajustesContenedor: {
    marginTop: 8,
  },
  botonAjustes: {
    marginTop: 4,
  },
  alertaContenedor: {
    backgroundColor: '#451a03',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#78350f',
    marginTop: 10,
  },
  alertaTexto: {
    color: '#fef3c7',
    fontSize: 13,
    lineHeight: 18,
  },
  errorGuardadoContenedor: {
    backgroundColor: '#450a0a',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    marginTop: 12,
  },
  errorGuardadoTexto: {
    color: '#fecaca',
    fontSize: 13,
  },
  pie: {
    marginTop: 16,
    gap: 12,
  },
  estadoPendiente: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f59e0b',
  },
  estadoGuardado: {
    fontSize: 13,
    color: '#64748b',
  },
  acciones: {
    flexDirection: 'row',
    gap: 8,
  },
  botonAccion: {
    flex: 1,
  },
});
