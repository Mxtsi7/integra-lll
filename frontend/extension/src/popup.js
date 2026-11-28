import { normalizarDominio, leerAsociaciones } from './dominio.js';
import { resumirMinutos } from './medicion.js';

const estado = document.querySelector('#estado');
const captura = document.querySelector('#observacion');
const autorizar = document.querySelector('#autorizar');
let generacion = 0;
let preparacion = null;
let revisionObservacion = 0;
let revisionMedicion = 0;
autorizar.disabled = true;
function mostrarObservacion(observacion) {
  captura.textContent = `${observacion?.estado ?? 'sin_consentimiento'} ${observacion?.dominio ?? ''}`.trim();
}
async function mostrarEstado(generacionEsperada = generacion) {
  const revisionInicial = revisionObservacion;
  const revisionInicialMedicion = revisionMedicion;
  const { configuracion, observacion, medicion } = await chrome.storage.session.get(['configuracion', 'observacion', 'medicion']);
  if (generacionEsperada !== generacion) return;
  document.querySelector('#dominios').value = configuracion?.dominios.join('\n') ?? '';
  document.querySelector('#asociaciones').value = Object.entries(configuracion?.asociaciones ?? {}).map(([dominio, id]) => `${dominio}=${id}`).join('\n');
  if (revisionInicialMedicion === revisionMedicion) document.querySelector('#minutos').textContent = JSON.stringify(resumirMinutos(medicion), null, 2);
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
    const asociaciones = leerAsociaciones(document.querySelector('#asociaciones').value, dominios);
    const registrado = await chrome.runtime.sendMessage({ tipo: 'iniciar_autorizacion', intentoId, dominios, asociaciones });
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
document.querySelector('#asociaciones').addEventListener('input', prepararAutorizacion);
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
    if (!respuesta?.ok) throw new Error(respuesta?.error ?? 'No se pudo guardar');
    estado.textContent = 'Dominios autorizados. El estado de captura se actualiza automáticamente.';
  } catch (error) {
    await chrome.runtime.sendMessage({ tipo: 'cancelar_autorizacion', intentoId }).catch(() => {});
    if (actual === generacion) estado.textContent = error.message;
  }
});
document.querySelector('#retirar').addEventListener('click', async () => {
  const actual = ++generacion;
  preparacion = null;
  autorizar.disabled = true;
  try {
    const respuesta = await chrome.runtime.sendMessage({ tipo: 'retirar' });
    if (actual !== generacion) return;
    if (!respuesta?.ok) throw new Error(respuesta?.error ?? 'No se pudo retirar');
    document.querySelector('#consentimiento').checked = false;
    estado.textContent = 'Consentimiento retirado y pendientes descartados.';
    await mostrarEstado(actual);
  } catch (error) {
    if (actual === generacion) estado.textContent = error.message;
  }
});
// Suscribir antes de leer el snapshot para no perder cambios mientras se abre el panel.
chrome.storage.onChanged.addListener((cambios, area) => {
  if (area !== 'session') return;
  if (Object.hasOwn(cambios, 'sincronizacion')) mostrarSincronizacion(cambios.sincronizacion.newValue);
  if (Object.hasOwn(cambios, 'observacion')) {
    ++revisionObservacion;
    mostrarObservacion(cambios.observacion.newValue);
  }
  if (Object.hasOwn(cambios, 'medicion')) {
    ++revisionMedicion;
    document.querySelector('#minutos').textContent = JSON.stringify(resumirMinutos(cambios.medicion.newValue), null, 2);
  }
});
mostrarEstado().catch(() => { estado.textContent = 'No se pudo leer el estado de la sesión.'; });

function mostrarSincronizacion(valores = []) {
  document.querySelector('#sincronizacion').textContent = valores.map(e =>
    'Captura: ' + e.fase + '. Pendientes: ' + e.pendientes + '. Última sincronización: ' +
    (e.ultimoEnvio ? new Date(e.ultimoEnvio).toLocaleString('es-CL') : 'Sin envíos confirmados') +
    (e.accionPendiente ? '. Falta confirmar ' + e.accionPendiente + ' con el servidor.' : '') +
    (e.error ? '. ' + e.error : '')).join('\n');
}
let suscripciones = [];
function mostrarAsociaciones() {
  const valores = document.querySelector('#asociaciones').value.split(/\r?\n/).filter(Boolean);
  document.querySelector('#lista-asociaciones').textContent = valores.map(valor => {
    const [dominio, id] = valor.split('=');
    return dominio + ': ' + (suscripciones.find(s => s.id === id)?.nombre ?? 'Suscripción asociada');
  }).join('; ');
}
function opciones(selector, valores) {
  const select = document.querySelector(selector);
  select.replaceChildren(...valores.map(({ id, nombre }) => {
    const opcion = document.createElement('option'); opcion.value = id; opcion.textContent = nombre; return opcion;
  }));
}
document.querySelector('#dominios').addEventListener('change', () => {
  const dominios = document.querySelector('#dominios').value.split(/\r?\n/).map(normalizarDominio).filter(Boolean);
  opciones('#dominio-asociado', dominios.map(d => ({ id: d, nombre: d })));
});
document.querySelector('#asociar').addEventListener('click', () => {
  const dominio = document.querySelector('#dominio-asociado').value;
  const id = document.querySelector('#suscripcion').value;
  if (!dominio || !id) { estado.textContent = 'Inicia sesión y elige un dominio y su suscripción.'; return; }
  const restantes = document.querySelector('#asociaciones').value.split(/\r?\n/).filter(v => v && !v.startsWith(dominio + '='));
  document.querySelector('#asociaciones').value = [...restantes, dominio + '=' + id].join('\n');
  mostrarAsociaciones(); void prepararAutorizacion();
});
let revisionConexion = 0;
document.querySelector('#servidor').addEventListener('input', async () => {
  const revision = ++revisionConexion;
  document.querySelector('#ingresar').disabled = true;
  try {
    const respuesta = await chrome.runtime.sendMessage({ tipo: 'preparar_conexion', urlBase: document.querySelector('#servidor').value });
    if (revision === revisionConexion) document.querySelector('#ingresar').disabled = !respuesta?.ok;
  } catch { /* Una URL incompleta se corrige mientras se escribe. */ }
});
async function cargarCuenta() {
  const respuesta = await chrome.runtime.sendMessage({ tipo: 'estado_cuenta' });
  if (!respuesta?.ok) throw new Error(respuesta?.error ?? 'No se pudo consultar la cuenta.');
  document.querySelector('#acceso').hidden = respuesta.conectado;
  document.querySelector('#salir').hidden = !respuesta.conectado;
  document.querySelector('#cuenta').textContent = respuesta.conectado ? 'Sesión conectada' : 'Inicia sesión para sincronizar';
  suscripciones = respuesta.suscripciones ?? [];
  opciones('#suscripcion', suscripciones);
  mostrarAsociaciones();
  const datos = await chrome.storage.session.get('sincronizacion'); mostrarSincronizacion(datos.sincronizacion);
}
document.querySelector('#acceso').addEventListener('submit', async evento => {
  evento.preventDefault();
  const ingresar = document.querySelector('#ingresar'); ingresar.disabled = true;
  try {
    const url = new URL(document.querySelector('#servidor').value);
    // El permiso se solicita en el gesto; el servidor se registró antes al escribir.
    if (!await chrome.permissions.request({ origins: [url.origin + '/*'] })) throw new Error('Permiso de servidor denegado.');
    const respuesta = await chrome.runtime.sendMessage({ tipo: 'login', urlBase: url.href,
      correo: document.querySelector('#correo').value, password: document.querySelector('#password').value });
    document.querySelector('#password').value = '';
    if (!respuesta?.ok) throw new Error(respuesta?.error ?? 'No se pudo iniciar sesión.');
    await cargarCuenta(); estado.textContent = 'Sesión iniciada. Elige dominios y suscripciones para autorizar.';
  } catch (error) { estado.textContent = error.message; }
  finally { ingresar.disabled = false; }
});
for (const tipo of ['pausar', 'reanudar', 'sincronizar', 'salir']) {
  document.querySelector('#' + tipo).addEventListener('click', async () => {
    try {
      const respuesta = await chrome.runtime.sendMessage({ tipo });
      if (!respuesta?.ok) throw new Error(respuesta?.error ?? 'No se pudo completar.');
      estado.textContent = tipo === 'salir' ? 'Sesión cerrada. Captura detenida.' : 'Cambio aplicado.';
      await cargarCuenta();
    } catch (error) { estado.textContent = error.message; }
  });
}
void cargarCuenta().catch(() => {});
