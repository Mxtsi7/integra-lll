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
