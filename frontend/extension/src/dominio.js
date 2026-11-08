export function normalizarDominio(entrada) {
  if (typeof entrada !== 'string') return null;
  const dominio = entrada.trim().toLowerCase().replace(/\.$/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(dominio)) return null;
  return dominio.length <= 253 ? dominio : null;
}

export function dominioAutorizado(direccion, dominios) {
  try {
    const url = new URL(direccion);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    const dominio = normalizarDominio(url.hostname);
    return dominios.includes(dominio) ? dominio : null;
  } catch { return null; } // Una pestaña interna o en carga puede no tener URL.
}

export function leerAsociaciones(texto, dominios) {
  const asociaciones = {};
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const linea of texto.split(/\r?\n/).filter(linea => linea.trim())) {
    const partes = linea.split('=');
    const dominio = normalizarDominio(partes[0]);
    const id = partes[1]?.trim();
    if (partes.length !== 2 || !dominios.includes(dominio) || !uuid.test(id ?? '') || Object.hasOwn(asociaciones, dominio)) {
      throw new Error('Cada asociación requiere un dominio autorizado único y un UUID de suscripción.');
    }
    asociaciones[dominio] = id.toLowerCase();
  }
  return asociaciones;
}
