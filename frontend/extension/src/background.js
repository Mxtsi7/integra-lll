import { UMBRAL_INACTIVIDAD_SEGUNDOS } from './observador.js';
import { crearControlador } from './controlador.js';

const controlador = crearControlador(chrome);
function actualizar(senal) {
  controlador.actualizar(senal).catch(() => console.warn('No se pudo actualizar el estado del recolector'));
}
chrome.runtime.onMessage.addListener((mensaje, emisor, responder) => {
  if (emisor.id !== chrome.runtime.id) return false;
  let operacion;
  if (mensaje.tipo === 'iniciar_autorizacion') operacion = controlador.iniciarAutorizacion(mensaje.intentoId, mensaje.dominios);
  else if (mensaje.tipo === 'cancelar_autorizacion') operacion = controlador.cancelarAutorizacion(mensaje.intentoId);
  else if (mensaje.tipo === 'guardar') operacion = controlador.guardar(mensaje.configuracion, mensaje.intentoId);
  else if (mensaje.tipo === 'retirar') operacion = controlador.retirar();
  else return false;
  operacion.then(resultado => responder(resultado ?? { ok: true }), () => responder({ ok: false }));
  return true;
});
chrome.tabs.onActivated.addListener(() => actualizar());
chrome.tabs.onUpdated.addListener((_id, cambios, pestana) => {
  if (pestana.active) actualizar();
});
chrome.tabs.onRemoved.addListener(() => actualizar());
let ultimaActividad;
chrome.windows.onFocusChanged.addListener(id => actualizar(id === chrome.windows.WINDOW_ID_NONE || id === -1
  ? { estado: ultimaActividad === 'locked' ? 'bloqueado' : 'sin_foco' } : undefined));
chrome.idle.onStateChanged.addListener(actividad => {
  ultimaActividad = actividad;
  actualizar(actividad === 'active' ? undefined : { estado: actividad === 'locked' ? 'bloqueado' : 'inactivo' });
});
chrome.idle.setDetectionInterval(UMBRAL_INACTIVIDAD_SEGUNDOS);

chrome.permissions.onAdded.addListener(() => {
  controlador.limpiarPermisos().catch(() => console.warn('No se pudieron retirar permisos sobrantes'));
});
chrome.permissions.onRemoved.addListener(() => actualizar());
chrome.storage.onChanged.addListener((cambios, area) => {
  if (area === 'session' && cambios.configuracion) actualizar();
});
chrome.runtime.onStartup.addListener(() => actualizar());
chrome.runtime.onInstalled.addListener(() => actualizar());
