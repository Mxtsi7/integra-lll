import { normalizarDominio } from './dominio.js';

const estado = document.querySelector('#estado');
async function mostrarEstado() {
  const { configuracion, observacion } = await chrome.storage.session.get(['configuracion', 'observacion']);
  document.querySelector('#dominios').value = configuracion?.dominios.join('\n') ?? '';
  estado.textContent = `${observacion?.estado ?? 'sin_consentimiento'} ${observacion?.dominio ?? ''}`;
}
document.querySelector('#configuracion').addEventListener('submit', async evento => {
  evento.preventDefault();
  const dominios = [...new Set(document.querySelector('#dominios').value.split(/\r?\n/).map(normalizarDominio))];
  if (!dominios.length || dominios.includes(null) || dominios.length > 20) {
    estado.textContent = 'Indica entre 1 y 20 dominios exactos, sin rutas ni comodines.';
    return;
  }
  try {
    const concedido = await chrome.permissions.request({ origins: dominios.map(dominio => `https://${dominio}/*`) });
    if (!concedido) { estado.textContent = 'Permiso denegado. No se activó la captura.'; return; }
    const respuesta = await chrome.runtime.sendMessage({ tipo: 'guardar', configuracion: { consentimiento: true, dominios } });
    if (!respuesta?.ok) throw new Error('No se pudo guardar');
    estado.textContent = 'Dominios autorizados. Vuelve a abrir este panel para consultar el estado.';
  } catch { estado.textContent = 'No se pudo autorizar. Inténtalo nuevamente.'; }
});
document.querySelector('#retirar').addEventListener('click', async () => {
  try {
    const respuesta = await chrome.runtime.sendMessage({ tipo: 'retirar' });
    if (!respuesta?.ok) throw new Error('No se pudo retirar');
    document.querySelector('#consentimiento').checked = false;
    await mostrarEstado();
  } catch { estado.textContent = 'No se pudo completar la retirada. Deshabilita la extensión y vuelve a intentarlo.'; }
});
mostrarEstado().catch(() => { estado.textContent = 'No se pudo leer el estado de la sesión.'; });
