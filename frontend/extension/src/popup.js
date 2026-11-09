import { normalizarDominio } from './dominio.js';

const estado = document.querySelector('#estado');
const captura = document.querySelector('#observacion');
const autorizar = document.querySelector('#autorizar');
let generacion = 0;
let preparacion = null;
let revisionObservacion = 0;
autorizar.disabled = true;
function mostrarObservacion(observacion) {
  captura.textContent = `${observacion?.estado ?? 'sin_consentimiento'} ${observacion?.dominio ?? ''}`.trim();
}
async function mostrarEstado(generacionEsperada = generacion) {
  const revisionInicial = revisionObservacion;
  const { configuracion, observacion } = await chrome.storage.session.get(['configuracion', 'observacion']);
  if (generacionEsperada !== generacion) return;
  document.querySelector('#dominios').value = configuracion?.dominios.join('\n') ?? '';
  if (revisionInicial === revisionObservacion) mostrarObservacion(observacion);
}
// Registrar al editar deja el gesto de Autorizar disponible para la petición nativa.
async function prepararAutorizacion() {
  const actual = ++generacion;
  preparacion = null;
  autorizar.disabled = true;
  if (!document.querySelector('#consentimiento').checked) return;
  const dominios = [...new Set(document.querySelector('#dominios').value.split(/\r?\n/).map(normalizarDominio))];
  if (!dominios.length || dominios.includes(null) || dominios.length > 20) {
    estado.textContent = 'Indica entre 1 y 20 dominios exactos, sin rutas ni comodines.';
    return;
  }
  const intentoId = crypto.randomUUID();
  try {
    const registrado = await chrome.runtime.sendMessage({ tipo: 'iniciar_autorizacion', intentoId, dominios });
    if (actual !== generacion) {
      await chrome.runtime.sendMessage({ tipo: 'cancelar_autorizacion', intentoId });
      return;
    }
    if (!registrado?.ok) throw new Error('No se pudo preparar');
    preparacion = { intentoId, dominios, generacion: actual };
    autorizar.disabled = false;
    estado.textContent = 'Revisa los dominios y pulsa Autorizar dominios.';
  } catch {
    if (actual === generacion) estado.textContent = 'No se pudo preparar. Edita los dominios para intentarlo nuevamente.';
  }
}
document.querySelector('#dominios').addEventListener('input', prepararAutorizacion);
document.querySelector('#consentimiento').addEventListener('change', prepararAutorizacion);

document.querySelector('#configuracion').addEventListener('submit', async evento => {
  evento.preventDefault();
  if (!preparacion || !document.querySelector('#consentimiento').checked) return;
  const { intentoId, dominios, generacion: actual } = preparacion;
  preparacion = null;
  autorizar.disabled = true;
  try {
    // El acuse llegó antes de habilitar el botón: ninguna limpieza previa sigue en vuelo.
    const concedido = await chrome.permissions.request({ origins: dominios.map(dominio => `https://${dominio}/*`) });
    if (actual !== generacion || !concedido) {
      await chrome.runtime.sendMessage({ tipo: 'cancelar_autorizacion', intentoId });
      if (actual === generacion) estado.textContent = 'Permiso denegado. Edita los dominios para volver a intentar.';
      return;
    }
    const respuesta = await chrome.runtime.sendMessage({ tipo: 'guardar', intentoId, configuracion: { consentimiento: true } });
    if (actual !== generacion) return;
    if (respuesta?.cancelado) { estado.textContent = 'Autorización cancelada. Acepta de nuevo para activar.'; return; }
    if (!respuesta?.ok) throw new Error('No se pudo guardar');
    estado.textContent = 'Dominios autorizados. El estado de captura se actualiza automáticamente.';
  } catch {
    await chrome.runtime.sendMessage({ tipo: 'cancelar_autorizacion', intentoId }).catch(() => {});
    if (actual === generacion) estado.textContent = 'No se pudo autorizar. Edita los dominios para volver a intentar.';
  }
});
document.querySelector('#retirar').addEventListener('click', async () => {
  const actual = ++generacion;
  preparacion = null;
  autorizar.disabled = true;
  try {
    const respuesta = await chrome.runtime.sendMessage({ tipo: 'retirar' });
    if (actual !== generacion) return;
    if (!respuesta?.ok) throw new Error('No se pudo retirar');
    document.querySelector('#consentimiento').checked = false;
    await mostrarEstado(actual);
  } catch {
    if (actual === generacion) estado.textContent = 'No se pudo completar la retirada. Deshabilita la extensión y vuelve a intentarlo.';
  }
});
// Suscribir antes de leer el snapshot para no perder cambios mientras se abre el panel.
chrome.storage.onChanged.addListener((cambios, area) => {
  if (area !== 'session' || !Object.hasOwn(cambios, 'observacion')) return;
  ++revisionObservacion;
  mostrarObservacion(cambios.observacion.newValue);
});
mostrarEstado().catch(() => { estado.textContent = 'No se pudo leer el estado de la sesión.'; });
